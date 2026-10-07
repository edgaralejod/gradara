import type { EffectiveSettings } from './solver';
import type { SimulationResult } from './api';

/** One stored run of the model, as `GET /api/results` lists it. */
export type StoredRun = {
  id: string;
  /** What the user called it; empty when unnamed. */
  name: string;
  finished: number;
  duration: number;
  samples: number;
  signals: number;
  projectRevision: number;
  modelHash: string;
  engine: string;
  /** The solver settings the run used; absent on runs from before 0.6.9 (the defaults). */
  simulation?: EffectiveSettings;
};

/** Runs shown together: enough to compare, few enough to read. */
export const maxOpenRuns = 3;

/** Colours offered for a run, most distinct first. */
export const runPalette = [
  '#237db3',
  '#d2691e',
  '#2e9e6f',
  '#9656a3',
  '#c2415d',
  '#7f8f2a',
];

/** Dash patterns that tell signals apart when colour already means "which run". */
export const signalDashes: number[][] = [[], [7, 4], [2, 3], [9, 3, 2, 3]];

/** A signal placed on a plot: on every open run that has it, or only on some. */
export type Assignment = { key: string; runs?: string[] };

/** Accept assignments saved before runs existed (bare signal keys). */
export function normalizeAssignments(raw: unknown): Assignment[] | null {
  if (!Array.isArray(raw)) return null;
  const out: Assignment[] = [];
  for (const item of raw) {
    if (typeof item === 'string') out.push({ key: item });
    else if (
      item &&
      typeof item === 'object' &&
      typeof (item as Assignment).key === 'string' &&
      ((item as Assignment).runs === undefined ||
        (Array.isArray((item as Assignment).runs) &&
          (item as Assignment).runs!.every((r) => typeof r === 'string')))
    )
      out.push({
        key: (item as Assignment).key,
        ...((item as Assignment).runs ? { runs: (item as Assignment).runs } : {}),
      });
    else return null;
  }
  return out;
}

/** The open runs a placed signal is drawn for. */
export function runsFor(a: Assignment, open: string[]): string[] {
  return a.runs ? open.filter((id) => a.runs!.includes(id)) : open;
}

/** Is this run's copy of the signal on the plot? */
export function isAssigned(
  list: Assignment[],
  key: string,
  run: string,
  open: string[],
): boolean {
  const a = list.find((x) => x.key === key);
  return !!a && runsFor(a, open).includes(run);
}

/**
 * Tick or untick one run's copy of a signal. Ticking a signal that is not yet
 * on the plot puts it on every open run that has it, so choosing it once
 * overlays the runs; unticking it in one run hides it there only.
 */
export function toggleAssignment(
  list: Assignment[],
  key: string,
  run: string,
  checked: boolean,
  open: string[],
): Assignment[] {
  const at = list.findIndex((x) => x.key === key);
  const current = at < 0 ? null : list[at];
  const replace = (a: Assignment | null) =>
    a === null
      ? list.filter((_, i) => i !== at)
      : at < 0
        ? [...list, a]
        : list.map((x, i) => (i === at ? a : x));
  if (checked) {
    if (!current) return replace({ key });
    if (!current.runs) return list;
    const runs = [...new Set([...current.runs, run])];
    return replace(open.every((id) => runs.includes(id)) ? { key } : { key, runs });
  }
  if (!current) return list;
  const rest = runsFor(current, open).filter((id) => id !== run);
  return replace(rest.length ? { key, runs: rest } : null);
}

/** Drop a signal from the plot on every run. */
export function removeAssignment(list: Assignment[], key: string): Assignment[] {
  return list.filter((x) => x.key !== key);
}

/** Pick a palette colour no open run uses yet, else the next in turn. */
export function freeColor(used: string[]): string {
  return (
    runPalette.find((c) => !used.includes(c)) ??
    runPalette[used.length % runPalette.length]
  );
}

/** The runs to show: the latest run first (unless hidden), then those the user opened. */
export function openRuns(
  latestId: string,
  latestHidden: boolean,
  chosen: string[],
  known: string[],
): string[] {
  const order = new Map(known.map((id, i) => [id, i]));
  const rest = chosen.filter((id) => id !== latestId && order.has(id));
  rest.sort((a, b) => order.get(a)! - order.get(b)!);
  return [...(latestHidden ? [] : [latestId]), ...rest].slice(0, maxOpenRuns);
}

/** A run's label: its name, else when it finished (the time alone for today's runs). */
export function runTitle(run: StoredRun, now = new Date()): string {
  if (run.name) return run.name;
  const when = new Date(run.finished);
  const today = when.toDateString() === now.toDateString();
  return when.toLocaleString(undefined, {
    ...(today ? {} : { month: 'short', day: 'numeric' }),
    hour: 'numeric',
    minute: '2-digit',
    second: '2-digit',
  });
}

export type RunTrace = {
  key: string;
  name: string;
  unit: string;
  blockId: string;
  netId?: string;
  color: string;
  dash?: number[];
  /** This run's own sample times. */
  time: number[];
  values: number[];
  run: string;
  /** The plot's own key for the signal. */
  signal: string;
};

/**
 * The lines a plot draws: each placed signal, once per open run that has it.
 * One run keeps one colour per signal as before; several runs colour by run
 * and tell signals apart by dash pattern.
 */
export function plotTraces(
  assignments: Assignment[],
  open: { id: string; color: string; data: SimulationResult }[],
  signalColor: (run: string, key: string) => string,
): RunTrace[] {
  const several = open.length > 1;
  const ids = open.map((r) => r.id);
  const out: RunTrace[] = [];
  assignments.forEach((a, n) => {
    for (const id of runsFor(a, ids)) {
      const run = open.find((r) => r.id === id)!;
      const s = run.data.series.find((x) => x.key === a.key);
      if (!s) continue;
      out.push({
        ...s,
        key: `${id}::${s.key}`,
        color: several ? run.color : signalColor(id, s.key),
        dash: several ? signalDashes[n % signalDashes.length] : undefined,
        time: run.data.time,
        run: id,
        signal: a.key,
      });
    }
  });
  return out;
}
