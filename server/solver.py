"""Simulation settings: what a document's `simulation` object means and the OpenModelica call it becomes.

The limits are shared with the workbench through `lib/gradara/solver-settings.json`;
the labels and help text live in `lib/gradara/solver-docs.ts`. Absent fields mean
the defaults, so a document without settings runs exactly as before they existed.
"""
import json
import math
import re
from functools import lru_cache

from .paths import ROOT

# Engine-specific realization of each solver. OpenModelica 1.27 deprecates the old
# fixed-step `rungekutta` method in favor of GBODE with constant step control, and a
# GBODE fixed step equals the output interval (its initial step size is ignored).
METHODS: dict[str, tuple[str, tuple[str, ...]]] = {
    'dassl': ('dassl', ()),
    'esdirk': ('gbode', ('-gbm=esdirk4',)),
    'backwardEuler': ('gbode', ('-gbm=impl_euler', '-gbctrl=const')),
    'rk4': ('gbode', ('-gbm=rungekutta', '-gbctrl=const')),
}


@lru_cache(maxsize=1)
def limits() -> dict:
    return json.loads((ROOT/'lib'/'gradara'/'solver-settings.json').read_text(encoding='utf-8'))


def solver_ids() -> tuple[str, ...]:
    return tuple(limits()['solvers'])


def is_fixed(solver: str) -> bool:
    return bool(limits()['solvers'][solver]['fixed'])


def steps_for(duration: float, spacing: float) -> int:
    """Whole intervals that cover `duration` with no interval longer than `spacing`."""
    return max(1, math.ceil(duration / spacing - 1e-9))


def effective(duration: float, settings) -> dict:
    """The settings that apply to a run, defaults filled in and fields of the other solver type dropped.

    `points` is the number of output intervals OpenModelica is asked for; with a
    fixed-step solver it is also the number of steps.
    """
    data = settings.model_dump(exclude_none=True) if settings is not None and hasattr(settings, 'model_dump') else dict(settings or {})
    defaults = limits()['defaults']
    solver = data.get('solver') or defaults['solver']
    out: dict = {'solver': solver}
    if is_fixed(solver):
        step = data.get('step')
        out['points'] = steps_for(duration, step) if step else defaults['points']
        out['step'] = duration / out['points']
        out['tolerance'] = defaults['tolerance']
    else:
        out['tolerance'] = data.get('tolerance', defaults['tolerance'])
        interval = data.get('outputInterval')
        out['points'] = steps_for(duration, interval) if interval else defaults['points']
        if data.get('maxStep'):
            out['maxStep'] = data['maxStep']
    return out


def is_default(duration: float, settings) -> bool:
    return effective(duration, settings) == effective(duration, None)


def simflags(run: dict) -> str:
    flags = list(METHODS[run['solver']][1])
    if run.get('maxStep'):
        flags.append(f'-maxStepSize={run["maxStep"]!r}')
    return ' '.join(flags)


def simulate_expression(duration: float, settings) -> str:
    """The `simulate(...)` call for a run. Every value comes from validated numbers or fixed names."""
    run = effective(duration, settings)
    method = METHODS[run['solver']][0]
    flags = simflags(run)
    return (f'simulate(Gradara.System, startTime=0, stopTime={float(duration)!r}, numberOfIntervals={run["points"]}, '
            f'tolerance={float(run["tolerance"])!r}, method="{method}", outputFormat="csv", fileNamePrefix="simulation"'
            + (f', simflags="{flags}"' if flags else '') + ')')


def number(value: float) -> str:
    """A short Modelica literal: 1e-6, 0.0001, 2.5e-5."""
    return re.sub(r'e([+-])0*(\d)', r'e\1\2', f'{value:g}')


def experiment_annotation(duration: float, settings) -> str:
    """The model's experiment annotation; for default settings exactly what Gradara always emitted."""
    run = effective(duration, settings)
    parts = [f'StartTime=0, StopTime={duration}, Tolerance={number(run["tolerance"])}']
    if is_default(duration, settings):
        return f'experiment({parts[0]})'
    parts.append(f'Interval={duration / run["points"]!r}')
    method = METHODS[run['solver']][0]
    flags = [f's="{method}"'] + [f'{f.split("=")[0].lstrip("-")}="{f.split("=")[1]}"' for f in simflags(run).split()]
    return f'experiment({", ".join(parts)}), __OpenModelica_simulationFlags({", ".join(flags)})'


def problems(duration: float, settings) -> list[tuple[str, str, str]]:
    """(field, message, hint) for settings that cannot run with this stop time."""
    if settings is None:
        return []
    out = []
    cap = limits()['maxPoints']
    solver = settings.solver or limits()['defaults']['solver']
    if is_fixed(solver):
        if settings.step:
            if settings.step > duration:
                out.append(('step', f'The step size ({settings.step:g} s) is longer than the stop time ({duration:g} s).',
                            'Use a step shorter than the stop time.'))
            elif steps_for(duration, settings.step) > cap:
                out.append(('step', f'A {settings.step:g} s step takes {steps_for(duration, settings.step):,} steps; '
                            f'the limit is {cap:,}.', f'Use a step of at least {duration / cap:.3g} s, or a shorter stop time.'))
    else:
        if settings.outputInterval:
            if settings.outputInterval > duration:
                out.append(('outputInterval', f'The output interval ({settings.outputInterval:g} s) is longer than the stop time ({duration:g} s).',
                            'Use an interval shorter than the stop time, or Auto.'))
            elif steps_for(duration, settings.outputInterval) > cap:
                out.append(('outputInterval', f'A {settings.outputInterval:g} s output interval records '
                            f'{steps_for(duration, settings.outputInterval):,} points; the limit is {cap:,}.',
                            f'Use an interval of at least {duration / cap:.3g} s, or Auto.'))
    return out


def describe(run: dict) -> str:
    """Short text for logs and run reports, as `rk4 · step 1e-05 s`."""
    if is_fixed(run['solver']):
        return f'{run["solver"]} · step {run["step"]:.3g} s'
    text = f'{run["solver"]} · tolerance {run["tolerance"]:g}'
    return text + (f' · max step {run["maxStep"]:g} s' if run.get('maxStep') else '')
