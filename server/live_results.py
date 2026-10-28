# SPDX-License-Identifier: Apache-2.0
"""Results of a running simulation, read from its growing result file.

The engine writes `simulation_res.csv` row by row into the run folder (every
backend writes to the same folder, see server/run_progress.py). While the run
lasts, the workbench asks for what is new since the rows it has; this module
reads from where the previous answer stopped, keeps only complete rows, picks
the columns Results shows (the same series `engine.recorded_series` lists for
the finished run, so keys, names, and units match), and sends each new stretch
as a min/max envelope. The finished result replaces it in the workbench.

The stream is a preview. Rows with a non-finite value are left out (the
finished run still fails on them), and a very large burst of rows is read at a
stride before the envelope is taken, so a narrow spike inside it can be missed.
"""
from __future__ import annotations

import csv
import io
import math
import threading
from collections import OrderedDict
from dataclasses import dataclass, field
from pathlib import Path

# Time bins per answer; each bin sends two points (its minimum and maximum, in order).
BINS = 400
# Most rows × series parsed per answer before the rows are read at a stride.
WORK = 2_000_000
# Most bytes read per answer; the rest waits for the next request.
READ_LIMIT = 32 * 1024 * 1024
# Most points per answer across all series (a model that records thousands of physical variables gets fewer bins).
POINTS = 200_000


class _Recorder(dict):
    """A row that remembers which columns were read from it."""

    def __init__(self, *args):
        super().__init__(*args)
        self.read: set[str] = set()

    def __getitem__(self, key):
        self.read.add(key)
        return super().__getitem__(key)


@dataclass
class _Run:
    project: object
    folder: Path
    duration: float
    lock: threading.Lock = field(default_factory=threading.Lock)
    header: list[str] | None = None
    start: int = 0  # byte offset of the first data row
    index: tuple | None = None  # engine.init_index
    variables: list | None = None
    picked: dict[str, int] | None = None  # CSV column → position
    meta: list[dict] | None = None
    broken: str = ''
    # Rows sent so far → byte offset after them; a client asking from one of these resumes there.
    cursors: OrderedDict = field(default_factory=OrderedDict)


_RUNS: dict[str, _Run] = {}
_GUARD = threading.Lock()


def register(job_id: str, project, folder: Path) -> None:
    with _GUARD:
        _RUNS[job_id] = _Run(project, folder, float(project.duration))


def unregister(job_id: str) -> None:
    with _GUARD:
        _RUNS.pop(job_id, None)


def _header(run: _Run) -> bool:
    """Read the header row once it is complete."""
    path = run.folder/'simulation_res.csv'
    try:
        with path.open('rb') as file:
            line = file.readline()
    except OSError:
        return False
    if not line.endswith(b'\n'):
        return False
    run.header = next(csv.reader(io.StringIO(line.decode('utf-8', errors='replace'))))
    run.start = len(line)
    return True


def _columns(run: _Run) -> None:
    """Which CSV columns the shown series read, and the series' names and units."""
    from .engine import _variables, init_index, recorded_series, result_columns
    run.index = init_index(run.folder)
    run.variables = _variables(run.folder) if getattr(run.project, 'logPhysical', False) else []
    probe = _Recorder({name: 0.0 for name in run.header})
    try:
        series = recorded_series(run.project, run.folder, result_columns(run.folder, [probe], run.index),
                                 run.variables, check_finite=False)
    except Exception as exc:  # a logged signal missing from the output: the finished run reports it
        run.broken = str(exc)
        run.meta = []
        run.picked = {}
        return
    wanted = {'time'} | probe.read
    run.picked = {name: i for i, name in enumerate(run.header) if name in wanted}
    run.meta = [{k: v for k, v in s.items() if k != 'values'} for s in series]


def _rows(run: _Run, data: bytes) -> list[dict]:
    """Parse complete lines, keeping the picked columns, at a stride when there are many."""
    lines = data.split(b'\n')
    if lines and not lines[-1]:
        lines.pop()
    width = max(1, len(run.meta or []))
    stride = max(1, math.ceil(len(lines) * width / WORK))
    keep = lines[::stride]
    if stride > 1 and keep[-1] is not lines[-1]:
        keep.append(lines[-1])  # always end on the newest row
    last = max(run.picked.values()) + 1
    out = []
    for line in keep:
        fields = line.split(b',', last)
        try:
            row = {name: float(fields[i]) for name, i in run.picked.items()}
        except (IndexError, ValueError):
            continue
        if all(math.isfinite(v) for v in row.values()) and row['time'] <= run.duration * (1 + 1e-12) + 1e-12:
            out.append(row)
    return out


def envelope(times: list[float], columns: list[list[float]], bins: int) -> tuple[list[float], list[list[float]]]:
    """At most two points per bin: each series' minimum and maximum in the order they occur,
    at the bin's first and last time. Short stretches pass through unchanged."""
    n = len(times)
    if n <= 2 * bins:
        return times, columns
    size = math.ceil(n / bins)
    out_t: list[float] = []
    out_c: list[list[float]] = [[] for _ in columns]
    for a in range(0, n, size):
        b = min(n, a + size)
        out_t += [times[a], times[b - 1]]
        for values, out in zip(columns, out_c):
            part = values[a:b]
            lo = min(range(len(part)), key=part.__getitem__)
            hi = max(range(len(part)), key=part.__getitem__)
            out += [part[lo], part[hi]] if lo <= hi else [part[hi], part[lo]]
    return out_t, out_c


def read(job_id: str, after: int) -> dict:
    """What is new in a running job's results since the client's `after` rows.

    `{done: true}` once the run has ended (the job's result takes over). Otherwise
    `{row, time, series: [{key, values}], fraction}`, with `meta` (the series'
    names, units, and owners) on the first answer, and `reset: true` when the
    client's cursor was unknown and the stream starts again from the first row.
    """
    with _GUARD:
        run = _RUNS.get(job_id)
    if run is None:
        return {'done': True}
    with run.lock:
        if run.header is None and not _header(run):
            return {'row': 0, 'time': [], 'series': [], 'fraction': 0.0, 'pending': True}
        if run.meta is None:
            _columns(run)
        if run.broken or not run.meta:
            return {'row': 0, 'time': [], 'series': [], 'fraction': 0.0, 'meta': [], 'unavailable': run.broken or 'nothing is logged'}
        reset = after not in run.cursors and after != 0
        if reset:
            after = 0
        offset = run.cursors.get(after, run.start)
        path = run.folder/'simulation_res.csv'
        try:
            with path.open('rb') as file:
                file.seek(offset)
                data = file.read(READ_LIMIT)
        except OSError:
            return {'done': True}
        end = data.rfind(b'\n')
        data = data[:end + 1] if end >= 0 else b''
        lines = data.count(b'\n')
        rows = _rows(run, data) if lines else []
        total = after + lines
        run.cursors[total] = offset + len(data)
        while len(run.cursors) > 16:
            run.cursors.popitem(last=False)
        answer = {'row': total, 'reset': reset}
        if after == 0:
            answer['meta'] = run.meta
        if not rows:
            return answer | {'time': [], 'series': []}  # nothing new: the client keeps its fraction
        from .engine import recorded_series, result_columns
        series = recorded_series(run.project, run.folder, result_columns(run.folder, rows, run.index),
                                 run.variables, check_finite=False)
        bins = max(16, min(BINS, POINTS // (2 * max(1, len(series)))))
        times, columns = envelope([r['time'] for r in rows], [s['values'] for s in series], bins)
        fraction = max(0.0, min(1.0, times[-1] / run.duration)) if run.duration > 0 else 0.0
        return answer | {'time': times, 'series': [{'key': s['key'], 'values': c} for s, c in zip(series, columns)],
                         'fraction': fraction}
