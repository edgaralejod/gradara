"""Where a running simulation is, read from its job folder while the engine works.

OpenModelica leaves the same trail with every backend (the folder is the one the
native, bundled, VM, and Docker engines all write to): the generated C sources and
makefile appear when translation ends, the executable when the C compiler is done,
and the result file when the simulation starts, which then grows row by row. The
time in the last complete row says how far the simulation has got.
"""
from pathlib import Path

# The order the workbench shows them in.
PHASES = ('preparing', 'translating', 'compiling', 'starting', 'simulating', 'reading')
TAIL = 1 << 16


def last_time(path: Path) -> float | None:
    """Simulation time of the last complete row of a growing CSV result, or None before the first row."""
    try:
        with path.open('rb') as file:
            size = file.seek(0, 2)
            window = TAIL
            while True:
                start = max(0, size - window)
                file.seek(start)
                text = file.read(size - start)
                end = text.rfind(b'\n')
                begin = text.rfind(b'\n', 0, end) if end > 0 else -1
                if begin >= 0 or start == 0:
                    break
                window *= 4  # one row is longer than the window
                if window > 1 << 26:
                    return None
    except OSError:
        return None
    if end <= 0:
        return None
    row = text[begin + 1:end]
    try:
        return float(row.split(b',', 1)[0])
    except ValueError:
        return None  # the header


def stage(folder: Path, duration: float) -> dict:
    """{phase, and while simulating: time, fraction} for a run folder."""
    result = folder/'simulation_res.csv'
    if result.exists():
        time = last_time(result)
        if time is None:
            return {'phase': 'simulating', 'time': 0.0, 'fraction': 0.0}
        return {'phase': 'simulating', 'time': min(time, duration), 'fraction': max(0.0, min(1.0, time / duration))}
    if (folder/'simulation').exists() or (folder/'simulation.exe').exists():
        return {'phase': 'starting'}
    if (folder/'simulation.makefile').exists():
        return {'phase': 'compiling'}
    if (folder/'model.mo').exists():
        return {'phase': 'translating'}
    return {'phase': 'preparing'}


def message(progress: dict) -> str:
    """The same stage in words, for job.progress."""
    phase = progress['phase']
    if phase == 'simulating':
        return f'Simulating · {progress.get("fraction", 0) * 100:.0f}%'
    return {'preparing': 'Checking the model', 'translating': 'Translating the model to equations',
            'compiling': 'Compiling the simulation', 'starting': 'Starting the simulation',
            'reading': 'Reading the results'}[phase]
