# SPDX-License-Identifier: Apache-2.0
"""A compact, deterministic summary of stored runs: the numbers a person reads off the plots.

The Run summary in the Data Inspector shows it, and Explain results sends it
to the AI instead of the samples. Everything here is computed from the full
stored data on this computer, so the same runs, signals and window always give
the same digest. Definitions (all over the chosen window, linear between samples):

* mean and RMS are time-weighted (trapezoidal), so uneven solver steps do not bias them;
* the steady value is the time-weighted mean over the last 10 % of the window,
  and the ripple is the peak-to-peak there;
* a signal has settled once it stays within a band around the steady value:
  2 % of the step from the initial value, widened to cover the ripple;
* overshoot is how far the signal passes the steady value, as a percentage of the step;
* a step is a jump of at least 20 % of the signal's range within 0.01 % of the window
  (more than six of them are reported once, as switching);
* a clip is a stretch of at least 2 % of the window held at the signal's
  maximum (or minimum) that the signal later leaves.
"""
from __future__ import annotations

import bisect
import math
from typing import Literal

from pydantic import Field, model_validator

from .model_agent import Strict
from .run_store import RunUnavailable, load_full, model_of

MAX_RUNS = 3
MAX_SIGNALS = 12
DEFAULT_SIGNALS = 8
ENVELOPE_BUDGET = 900    # envelope points across every signal of every run
LABELS = 'ABC'


class DigestRequest(Strict):
    modelId: str = Field(min_length=1, max_length=120)
    # The runs on show; the first is the one the question is about.
    runIds: list[str] = Field(min_length=1, max_length=MAX_RUNS)
    # The run the others are compared with; defaults to the last one listed (the oldest shown).
    baseline: str | None = Field(default=None, max_length=40)
    # Series keys, normally the signals plotted on the active plot. Empty: logged signals first.
    signals: list[str] = Field(default_factory=list, max_length=MAX_SIGNALS)
    window: tuple[float, float] | None = None

    @model_validator(mode='after')
    def check(self):
        if len(set(self.runIds)) != len(self.runIds):
            raise ValueError('A run is listed twice.')
        if self.baseline is not None and self.baseline not in self.runIds:
            raise ValueError('The baseline must be one of the runs.')
        if self.window is not None:
            a, b = self.window
            if not (math.isfinite(a) and math.isfinite(b) and b > a):
                raise ValueError('The time window must run forward.')
        return self


def sig(x: float, digits: int = 5) -> float:
    """``x`` to a few significant digits, so the digest stays short and stable."""
    if x == 0 or not math.isfinite(x):
        return 0.0 if x == 0 else x
    return float(f'{x:.{digits}g}')


# ---------------------------------------------------------------- sampling


def value_at(time: list[float], values: list[float], t: float) -> float:
    """Linear interpolation, held at the ends. At an event (two samples at one time) the later value wins."""
    if not time:
        raise ValueError('No samples.')
    if t <= time[0]:
        return values[0]
    if t >= time[-1]:
        return values[-1]
    j = bisect.bisect_right(time, t) - 1
    if time[j] == t or time[j + 1] == time[j]:
        return values[j]
    w = (t - time[j]) / (time[j + 1] - time[j])
    return values[j] + w * (values[j + 1] - values[j])


def window_of(time: list[float], values: list[float], t0: float, t1: float) -> tuple[list[float], list[float]]:
    """The samples inside [t0, t1], with interpolated end points so metrics cover exactly the window."""
    t0, t1 = max(t0, time[0]), min(t1, time[-1])
    if t1 < t0:
        t1 = t0
    lo = bisect.bisect_right(time, t0)
    hi = bisect.bisect_left(time, t1)
    ts = [t0] + time[lo:hi] + [t1]
    vs = [value_at(time, values, t0)] + values[lo:hi] + [value_at(time, values, t1)]
    return ts, vs


def integral(ts: list[float], vs: list[float]) -> float:
    return sum((b - a) * (p + q) for a, b, p, q in zip(ts, ts[1:], vs, vs[1:])) / 2


def mean(ts: list[float], vs: list[float]) -> float:
    span = ts[-1] - ts[0]
    return integral(ts, vs) / span if span > 0 else vs[-1]


def rms(ts: list[float], vs: list[float]) -> float:
    span = ts[-1] - ts[0]
    if span <= 0:
        return abs(vs[-1])
    # Exact for a linear segment: the integral of (a + (b-a)s)^2 over s in [0, 1] is (a² + ab + b²)/3.
    total = sum((b - a) * (p * p + p * q + q * q) for a, b, p, q in zip(ts, ts[1:], vs, vs[1:])) / 3
    return math.sqrt(max(0.0, total / span))


def crossings(ts: list[float], vs: list[float], level: float) -> list[float]:
    """Times the signal passes through ``level`` (touching without crossing does not count)."""
    out = []
    side = 0
    for t, v in zip(ts, vs):
        now = (v > level) - (v < level)
        if now and side and now != side:
            out.append(t)
        if now:
            side = now
    return out


# ---------------------------------------------------------------- metrics


def statistics(ts: list[float], vs: list[float]) -> dict:
    """Plain statistics over one window of one signal (unrounded)."""
    i_min = vs.index(min(vs))
    i_max = vs.index(max(vs))
    return {'min': vs[i_min], 'tMin': ts[i_min], 'max': vs[i_max], 'tMax': ts[i_max],
            'mean': mean(ts, vs), 'rms': rms(ts, vs), 'initial': vs[0], 'final': vs[-1],
            'peakToPeak': vs[i_max] - vs[i_min]}


def steady_state(ts: list[float], vs: list[float]) -> dict:
    """Steady value, ripple, settling time and overshoot (see the module notes). Times are absolute."""
    start, end = ts[0], ts[-1]
    tail_t, tail_v = window_of(ts, vs, end - (end - start) * 0.1, end)
    final = mean(tail_t, tail_v)
    ripple = max(tail_v) - min(tail_v)
    step = final - vs[0]
    scale = max(abs(final), max(abs(v) for v in vs), 1e-300)
    band = max(0.02 * abs(step), 0.55 * ripple, 1e-9 * scale)
    lo, hi = final - band, final + band
    last = next((i for i in range(len(vs) - 1, -1, -1) if not lo <= vs[i] <= hi), None)
    if last is None:
        settling = start
    elif last >= len(vs) - 1 or ts[last + 1] >= end:
        settling = None
    else:
        settling = ts[last + 1]
    overshoot = None
    if abs(step) > 2 * band:
        beyond = (max(vs) - final) if step > 0 else (final - min(vs))
        overshoot = max(0.0, beyond) / abs(step) * 100
    return {'value': final, 'ripple': ripple, 'band': band, 'settlingTime': settling,
            'overshootPercent': overshoot}


def events(ts: list[float], vs: list[float], stats: dict, steady: dict) -> list[dict]:
    """Start-up transients, steps and clipped stretches of one signal in one window."""
    span = ts[-1] - ts[0]
    found: list[dict] = []
    rng = stats['peakToPeak']
    if span <= 0 or rng <= 1e-12 * max(1.0, abs(stats['max'])):
        return found
    settle = steady['settlingTime']
    if settle is None:
        found.append({'kind': 'not settled', 't0': ts[0], 't1': ts[-1],
                      'detail': 'Does not stay within its steady band before the end of the window.'})
    elif settle > ts[0] + 0.01 * span:
        found.append({'kind': 'transient', 't0': ts[0], 't1': settle,
                      'detail': 'Start-up transient until the signal settles.'})
    short, big = span * 1e-4, 0.2 * rng
    jumps = [(abs(q - p), i) for i, (a, b, p, q) in enumerate(zip(ts, ts[1:], vs, vs[1:]))
             if b - a <= short and abs(q - p) >= big]
    if len(jumps) > 6:
        # Many jumps are switching (PWM, a square wave), not separate steps.
        first, last = min(i for _, i in jumps), max(i for _, i in jumps)
        found.append({'kind': 'switching', 't0': ts[first], 't1': ts[last + 1],
                      'detail': f'Switches {len(jumps)} times.'})
    else:
        for _, i in sorted(jumps, reverse=True)[:3]:
            found.append({'kind': 'step', 't0': ts[i], 't1': ts[i + 1],
                          'detail': f'Jumps from {sig(vs[i])} to {sig(vs[i + 1])}.'})
    tol = 1e-6 * rng
    for extreme, name in ((stats['max'], 'maximum'), (stats['min'], 'minimum')):
        at = [i for i, v in enumerate(vs) if abs(v - extreme) <= tol]
        # Consecutive sample indices held at the extreme form one stretch.
        stretches: list[tuple[int, int]] = []
        for i in at:
            if stretches and i == stretches[-1][1] + 1:
                stretches[-1] = (stretches[-1][0], i)
            else:
                stretches.append((i, i))
        held, t0, t1 = max(((ts[b] - ts[a], ts[a], ts[b]) for a, b in stretches), default=(0.0, 0.0, 0.0))
        leaves_later = abs(vs[-1] - extreme) > 0.01 * rng
        # A waveform that returns to its extreme again and again (PWM, a square wave) is not clipped.
        if held >= 0.02 * span and leaves_later and len(stretches) <= 2:
            found.append({'kind': 'clipped', 't0': t0, 't1': t1,
                          'detail': f'Held at its {name} {sig(extreme)} before leaving it.'})
    return found


def envelope(ts: list[float], vs: list[float], points: int) -> list[list[float]]:
    """[bucket start, minimum, maximum] over equal time buckets: the waveform's shape, peaks kept."""
    start, end = ts[0], ts[-1]
    if end <= start:
        return [[sig(start), sig(vs[-1]), sig(vs[-1])]]
    width = (end - start) / points
    # Each bucket starts with the interpolated values at its edges, then takes its samples in one pass.
    edges = [value_at(ts, vs, start + k * width) for k in range(points + 1)]
    low = [min(edges[k], edges[k + 1]) for k in range(points)]
    high = [max(edges[k], edges[k + 1]) for k in range(points)]
    last = points - 1
    for t, v in zip(ts, vs):
        k = min(last, int((t - start) / width))
        if v < low[k]:
            low[k] = v
        if v > high[k]:
            high[k] = v
    return [[sig(start + k * width), sig(low[k]), sig(high[k])] for k in range(points)]


def resample(time: list[float], values: list[float], grid: list[float]) -> list[float]:
    """``values`` read at every time of the sorted ``grid`` in one forward pass (as value_at does)."""
    if time is grid or time == grid:
        return list(values)
    out, j, n = [], 0, len(time)
    for t in grid:
        while j + 1 < n and time[j + 1] <= t:
            j += 1
        if t <= time[0]:
            out.append(values[0])
        elif j + 1 >= n or time[j] == t or time[j + 1] == time[j]:
            out.append(values[j])
        else:
            w = (t - time[j]) / (time[j + 1] - time[j])
            out.append(values[j] + w * (values[j + 1] - values[j]))
    return out


def difference(base_t: list[float], base_v: list[float], other_t: list[float], other_v: list[float],
               t0: float, t1: float) -> dict:
    """Largest |other − base| over the window and when, plus the RMS difference, on the union of both grids."""
    if base_t is other_t or base_t == other_t:
        grid, a = window_of(base_t, base_v, t0, t1)
        b = window_of(other_t, other_v, t0, t1)[1]
    else:
        grid = sorted({t for t in base_t if t0 <= t <= t1} | {t for t in other_t if t0 <= t <= t1} | {t0, t1})
        a, b = resample(base_t, base_v, grid), resample(other_t, other_v, grid)
    diff = [q - p for p, q in zip(a, b)]
    largest = max(diff, key=abs)
    i = diff.index(largest)
    return {'maxAbsDifference': abs(largest), 'at': grid[i], 'signedAtMax': largest, 'rmsDifference': rms(grid, diff)}


def parameter_differences(before: dict, after: dict) -> list[dict]:
    """Parameters that differ between two model snapshots (top level), as in the Data Inspector."""
    out = []
    old = {b['id']: b for b in before.get('blocks', [])}
    new = {b['id']: b for b in after.get('blocks', [])}
    for ident, block in new.items():
        name = block['definition'].get('name', ident)
        if ident not in old:
            out.append({'block': name, 'change': 'added'})
            continue
        was = {p['id']: p for p in old[ident]['definition'].get('parameters', [])}
        for p in block['definition'].get('parameters', []):
            q = was.get(p['id'])
            if q is not None and q.get('value') != p.get('value'):
                out.append({'block': name, 'parameter': p.get('name', p['id']), 'from': q.get('value'),
                            'to': p.get('value'), 'unit': p.get('unit', '')})
    for ident, block in old.items():
        if ident not in new:
            out.append({'block': block['definition'].get('name', ident), 'change': 'removed'})
    if before.get('duration') != after.get('duration'):
        out.append({'block': 'Model', 'parameter': 'Stop time', 'from': before.get('duration'),
                    'to': after.get('duration'), 'unit': 's'})
    return out


# ---------------------------------------------------------------- digest


def load_runs(request: DigestRequest, loader=load_full) -> list[dict]:
    runs = []
    for run_id in request.runIds:
        try:
            run = loader(run_id)
        except (RunUnavailable, OSError, ValueError, KeyError) as exc:
            raise RunUnavailable(f'Run {run_id} cannot be read: {exc}') from exc
        if model_of(run) != request.modelId:
            raise RunUnavailable('A requested run belongs to another model.')
        runs.append(run)
    return runs


def chosen_signals(request: DigestRequest, runs: list[dict]) -> list[str]:
    if request.signals:
        return list(dict.fromkeys(request.signals))
    first = runs[0]['series']
    logged = [s['key'] for s in first if s.get('netId')]
    rest = [s['key'] for s in first if not s.get('netId')]
    return (logged + rest)[:DEFAULT_SIGNALS]


def window_for(request: DigestRequest, runs: list[dict]) -> tuple[float, float]:
    end = min(run['time'][-1] for run in runs if run['time'])
    start = max(run['time'][0] for run in runs if run['time'])
    if request.window is None:
        return start, end
    a, b = request.window
    a, b = max(a, start), min(b, end)
    if b <= a:
        raise ValueError('The time window lies outside the runs.')
    return a, b


def round_dict(data: dict) -> dict:
    return {k: (sig(v) if isinstance(v, float) else v) for k, v in data.items()}


def digest(request: DigestRequest, loader=load_full) -> dict:
    runs = load_runs(request, loader)
    t0, t1 = window_for(request, runs)
    keys = chosen_signals(request, runs)
    whole = request.window is None
    labels = {run['id']: LABELS[i] for i, run in enumerate(runs)}
    baseline = request.baseline or runs[-1]['id']
    per_run = len(runs) * max(1, len(keys))
    points = max(20, min(120, ENVELOPE_BUDGET // per_run))
    out_runs = []
    for run in runs:
        out_runs.append({'label': labels[run['id']], 'id': run['id'], 'name': run.get('name') or '',
                         'finished': run.get('finished'), 'stopTime': run['duration'], 'samples': run['samples'],
                         'baseline': run['id'] == baseline and len(runs) > 1})
    signals, missing, all_events = [], [], []
    for key in keys:
        for run in runs:
            series = next((s for s in run['series'] if s['key'] == key), None)
            if series is None:
                missing.append({'signal': key, 'run': labels[run['id']]})
                continue
            ts, vs = window_of(run['time'], series['values'], t0, t1)
            stats = statistics(ts, vs)
            steady = steady_state(ts, vs)
            found = events(ts, vs, stats, steady)
            signals.append({
                'run': labels[run['id']], 'key': key, 'name': series['name'], 'unit': series.get('unit', ''),
                'logged': bool(series.get('netId')),
                'stats': round_dict(stats),
                'steady': round_dict({k: v for k, v in steady.items() if v is not None}),
                'zeroCrossings': len(crossings(ts, vs, 0.0)),
                'crossingsOfSteady': len(crossings(ts, vs, steady['value'])),
                'envelope': envelope(ts, vs, points),
            })
            all_events += [{'run': labels[run['id']], 'signal': key, **round_dict(e)} for e in found]
    comparison, parameters = [], []
    base = next(r for r in runs if r['id'] == baseline)
    for run in runs:
        if run is base:
            continue
        parameters += [{'run': labels[run['id']], 'baseline': labels[baseline], **p}
                       for p in parameter_differences(base.get('snapshot', {}), run.get('snapshot', {}))]
        for key in keys:
            a = next((s for s in base['series'] if s['key'] == key), None)
            b = next((s for s in run['series'] if s['key'] == key), None)
            if a is None or b is None:
                continue
            d = difference(base['time'], a['values'], run['time'], b['values'], t0, t1)
            comparison.append({'signal': key, 'run': labels[run['id']], 'baseline': labels[baseline], **round_dict(d)})
    problems = [p.get('message', '') for p in (runs[0].get('problems') or [])][:10]
    available = [{'key': s['key'], 'name': s['name'], 'unit': s.get('unit', ''), 'logged': bool(s.get('netId'))}
                 for s in runs[0]['series']][:60]
    return {
        'window': [sig(t0), sig(t1)], 'wholeRun': whole,
        'runs': out_runs, 'signals': signals, 'missing': missing, 'events': all_events[:40],
        'comparison': comparison, 'parameters': parameters[:40], 'warnings': problems,
        'availableSignals': available,
    }


# ---------------------------------------------------------------- measurements

Metric = Literal['min', 'max', 'mean', 'rms', 'final', 'initial', 'peakToPeak', 'valueAt',
                 'settlingTime', 'overshootPercent', 'steadyValue', 'ripple', 'tMax', 'tMin']


def measure(time: list[float], values: list[float], metric: str, t0: float, t1: float, at: float | None = None) -> float | None:
    """One metric of one signal over [t0, t1], computed exactly as the digest does."""
    if metric == 'valueAt':
        return value_at(time, values, at if at is not None else t1)
    ts, vs = window_of(time, values, t0, t1)
    if metric in ('settlingTime', 'overshootPercent', 'steadyValue', 'ripple'):
        steady = steady_state(ts, vs)
        return {'settlingTime': steady['settlingTime'], 'overshootPercent': steady['overshootPercent'],
                'steadyValue': steady['value'], 'ripple': steady['ripple']}[metric]
    return statistics(ts, vs)[metric]


def correlation(time: list[float], a: list[float], other_time: list[float], b: list[float], t0: float, t1: float) -> float | None:
    """Pearson correlation of two signals over [t0, t1] on the union of their grids, time-weighted."""
    grid = sorted({t for t in time + other_time if t0 <= t <= t1} | {t0, t1})
    if len(grid) < 3:
        return None
    x, y = resample(time, a, grid), resample(other_time, b, grid)
    mx, my = mean(grid, x), mean(grid, y)
    cov = mean(grid, [(p - mx) * (q - my) for p, q in zip(x, y)])
    vx = mean(grid, [(p - mx) ** 2 for p in x])
    vy = mean(grid, [(q - my) ** 2 for q in y])
    if vx <= 0 or vy <= 0:
        return None
    return max(-1.0, min(1.0, cov / math.sqrt(vx * vy)))
