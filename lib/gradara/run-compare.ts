import type { SimulationResult } from './api';
import { sample } from './compare';

/**
 * Quantitative comparison of two stored runs of one model: which signals
 * differ, by how much, and where. Signals are matched by their stable series
 * key (block and port identity), so a renamed block still lines up.
 *
 * The tolerance follows the Simulink Data Inspector's definition. Without a
 * time tolerance, a compared sample passes when it is within
 * max(absolute, relative × |baseline|) of the baseline. With a time tolerance,
 * the baseline's minimum and maximum over [t − time, t + time] widen the band
 * first, so a small shift of an edge is not reported as a large difference.
 */
export type Tolerance = { absolute: number; relative: number; time: number };
export const exactTolerance: Tolerance = { absolute: 0, relative: 0, time: 0 };

export type SignalStatus = 'out' | 'within' | 'compared-only' | 'baseline-only';
export type SignalSummary = {
  key: string;
  name: string;
  unit: string;
  status: SignalStatus;
  /** Largest |compared − baseline| and when it happens; 0 for an unmatched signal. */
  maxDifference: number;
  maxAt: number;
  /** Separate stretches of time outside the tolerance. */
  regions: number;
};
export type RunComparison = {
  /** Every sample time of either run, up to the shorter run's stop time. */
  time: number[];
  duration: number;
  /** The runs have different stop times; only the shared part is compared. */
  truncated: boolean;
  signals: SignalSummary[];
  out: number;
  within: number;
  unmatched: number;
};
export type SignalDetail = {
  baseline: number[];
  compared: number[];
  /** compared − baseline */
  difference: number[];
  /** The tolerance band around zero difference: lower ≤ difference ≤ upper passes. */
  lower: number[];
  upper: number[];
  /** Time spans outside the tolerance. */
  regions: [number, number][];
  maxDifference: number;
  maxAt: number;
};

/** Both runs' sample times merged in order without repeats, up to `end`. */
export function unionTime(a: number[], b: number[], end: number): number[] {
  const out: number[] = [];
  let i = 0,
    j = 0;
  while (i < a.length || j < b.length) {
    const t =
      j >= b.length || (i < a.length && a[i] <= b[j]) ? a[i++] : b[j++];
    if (t > end) break;
    if (!out.length || t > out[out.length - 1]) out.push(t);
  }
  return out;
}

function resample(time: number[], values: number[], grid: number[]) {
  let at = 0;
  return grid.map((t) => {
    const r = sample(time, values, t, at);
    at = r.index;
    return r.value;
  });
}

const margin = (value: number, tolerance: Tolerance) =>
  Math.max(tolerance.absolute, tolerance.relative * Math.abs(value));

/** Lowest and highest allowed value at each grid time, from the baseline. */
export function toleranceBounds(
  grid: number[],
  baseline: number[],
  tolerance: Tolerance,
): { lower: number[]; upper: number[] } {
  const n = grid.length;
  const lower = Array.from({ length: n }, () => 0),
    upper = Array.from({ length: n }, () => 0);
  if (!(tolerance.time > 0)) {
    for (let i = 0; i < n; i++) {
      const m = margin(baseline[i], tolerance);
      lower[i] = baseline[i] - m;
      upper[i] = baseline[i] + m;
    }
    return { lower, upper };
  }
  // Sliding window over [t − time, t + time]; each deque holds candidate indices in order.
  const lows: number[] = [],
    highs: number[] = [];
  let lowHead = 0,
    highHead = 0,
    next = 0;
  for (let i = 0; i < n; i++) {
    while (next < n && grid[next] <= grid[i] + tolerance.time) {
      while (lows.length > lowHead && baseline[lows[lows.length - 1]] >= baseline[next]) lows.pop();
      while (highs.length > highHead && baseline[highs[highs.length - 1]] <= baseline[next]) highs.pop();
      lows.push(next);
      highs.push(next);
      next++;
    }
    while (grid[lows[lowHead]] < grid[i] - tolerance.time) lowHead++;
    while (grid[highs[highHead]] < grid[i] - tolerance.time) highHead++;
    const lo = baseline[lows[lowHead]],
      hi = baseline[highs[highHead]];
    lower[i] = lo - margin(lo, tolerance);
    upper[i] = hi + margin(hi, tolerance);
  }
  return { lower, upper };
}

function compareSeries(
  grid: number[],
  baseline: number[],
  compared: number[],
  tolerance: Tolerance,
): SignalDetail {
  const { lower, upper } = toleranceBounds(grid, baseline, tolerance);
  const difference = Array.from({ length: grid.length }, () => 0);
  const regions: [number, number][] = [];
  let maxDifference = 0,
    maxAt = grid[0] ?? 0,
    open = -1;
  for (let i = 0; i < grid.length; i++) {
    const d = compared[i] - baseline[i];
    difference[i] = d;
    if (Math.abs(d) > maxDifference) {
      maxDifference = Math.abs(d);
      maxAt = grid[i];
    }
    const outside = compared[i] > upper[i] || compared[i] < lower[i];
    if (outside && open < 0) open = i;
    if (!outside && open >= 0) {
      regions.push([grid[open], grid[i - 1]]);
      open = -1;
    }
    // The plot draws the band around the difference, so express it relative to the baseline.
    lower[i] -= baseline[i];
    upper[i] -= baseline[i];
  }
  if (open >= 0) regions.push([grid[open], grid[grid.length - 1]]);
  return { baseline, compared, difference, lower, upper, regions, maxDifference, maxAt };
}

const rank: Record<SignalStatus, number> = { out: 0, within: 1, 'compared-only': 2, 'baseline-only': 3 };

/** Compare every signal the two runs share; signals in only one run are listed as unmatched. */
export function compareRuns(
  baseline: SimulationResult,
  compared: SimulationResult,
  tolerance: Tolerance,
): RunComparison {
  const duration = Math.min(baseline.duration, compared.duration);
  const time = unionTime(baseline.time, compared.time, duration * (1 + 1e-12));
  const theirs = new Map(compared.series.map((s) => [s.key, s]));
  const seen = new Set<string>();
  const signals: SignalSummary[] = [];
  for (const b of baseline.series) {
    const c = theirs.get(b.key);
    seen.add(b.key);
    if (!c) {
      signals.push({ key: b.key, name: b.name, unit: b.unit, status: 'baseline-only', maxDifference: 0, maxAt: 0, regions: 0 });
      continue;
    }
    const detail = compareSeries(
      time,
      resample(baseline.time, b.values, time),
      resample(compared.time, c.values, time),
      tolerance,
    );
    signals.push({
      key: b.key,
      // The compared run is usually the newer one, so its name is the current one.
      name: c.name,
      unit: c.unit,
      status: detail.regions.length ? 'out' : 'within',
      maxDifference: detail.maxDifference,
      maxAt: detail.maxAt,
      regions: detail.regions.length,
    });
  }
  for (const c of compared.series)
    if (!seen.has(c.key))
      signals.push({ key: c.key, name: c.name, unit: c.unit, status: 'compared-only', maxDifference: 0, maxAt: 0, regions: 0 });
  signals.sort(
    (a, b) =>
      rank[a.status] - rank[b.status] ||
      b.maxDifference - a.maxDifference ||
      a.name.localeCompare(b.name),
  );
  const count = (status: SignalStatus) => signals.filter((s) => s.status === status).length;
  return {
    time,
    duration,
    truncated: baseline.duration !== compared.duration,
    signals,
    out: count('out'),
    within: count('within'),
    unmatched: count('compared-only') + count('baseline-only'),
  };
}

/** The traces for one matched signal, on the comparison's time grid. */
export function signalDetail(
  comparison: RunComparison,
  baseline: SimulationResult,
  compared: SimulationResult,
  key: string,
  tolerance: Tolerance,
): SignalDetail | null {
  const b = baseline.series.find((s) => s.key === key),
    c = compared.series.find((s) => s.key === key);
  if (!b || !c) return null;
  return compareSeries(
    comparison.time,
    resample(baseline.time, b.values, comparison.time),
    resample(compared.time, c.values, comparison.time),
    tolerance,
  );
}

/** A tolerance typed by the user: a finite number that is not negative, else 0. */
export function toleranceValue(text: string): number {
  const value = Number(text);
  return text.trim() && Number.isFinite(value) && value > 0 ? value : 0;
}
