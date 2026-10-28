/**
 * Live results: the Data Inspector's view of a run that is still going.
 *
 * The service sends what the running simulation has recorded since the rows
 * the client has (GET /api/runs/{id}/live, server/live_results.py), as a
 * min/max envelope. This file merges those answers into a preview result the
 * inspector draws like any other, and keeps it small: past `cap` points the
 * oldest stretch is halved again, keeping each pair's extremes. The finished
 * result, with the same ID, replaces the preview.
 */
import { api, type SimulationResult } from './api';
import { effective } from './solver';
import type { Project } from './model';

type SeriesMeta = Omit<SimulationResult['series'][number], 'values'>;

export type LiveChunk = {
  done?: boolean;
  pending?: boolean;
  /** Nothing can stream (nothing logged, or a logged signal is missing); the finished run says why. */
  unavailable?: string;
  row?: number;
  reset?: boolean;
  meta?: SeriesMeta[];
  time?: number[];
  series?: { key: string; values: number[] }[];
  fraction?: number;
};

export type LiveState = {
  row: number;
  meta: SeriesMeta[];
  time: number[];
  values: Record<string, number[]>;
  fraction: number;
};

/** Most points kept per series while the run lasts. */
export const LIVE_CAP = 4000;

/** Halve a stretch of points, keeping each group's minimum and maximum in order. */
export function halve(time: number[], columns: number[][]): [number[], number[][]] {
  const t: number[] = [];
  const out = columns.map(() => [] as number[]);
  for (let a = 0; a < time.length; a += 4) {
    const b = Math.min(time.length, a + 4);
    if (b - a <= 2) {
      for (let i = a; i < b; i++) {
        t.push(time[i]);
        columns.forEach((c, k) => out[k].push(c[i]));
      }
      continue;
    }
    t.push(time[a], time[b - 1]);
    columns.forEach((c, k) => {
      let lo = a,
        hi = a;
      for (let i = a; i < b; i++) {
        if (c[i] < c[lo]) lo = i;
        if (c[i] > c[hi]) hi = i;
      }
      out[k].push(...(lo <= hi ? [c[lo], c[hi]] : [c[hi], c[lo]]));
    });
  }
  return [t, out];
}

/** Merge one answer into the state; `null` while there is nothing to show yet. */
export function appendLive(
  state: LiveState | null,
  chunk: LiveChunk,
  cap = LIVE_CAP,
): LiveState | null {
  if (chunk.done || chunk.pending || chunk.unavailable || chunk.row === undefined)
    return state;
  const base: LiveState | null =
    chunk.reset || !state
      ? chunk.meta
        ? { row: 0, meta: chunk.meta, time: [], values: {}, fraction: 0 }
        : null
      : state;
  if (!base) return state;
  let time = base.time.concat(chunk.time ?? []);
  const keys = base.meta.map((m) => m.key);
  const sent = new Map((chunk.series ?? []).map((s) => [s.key, s.values]));
  let columns = keys.map((k) => (base.values[k] ?? []).concat(sent.get(k) ?? []));
  while (time.length > cap) {
    // Halve the older half, so the newest stretch stays at the resolution it arrived in.
    const split = Math.floor(time.length / 2);
    const [t, c] = halve(time.slice(0, split), columns.map((col) => col.slice(0, split)));
    time = t.concat(time.slice(split));
    columns = columns.map((col, k) => c[k].concat(col.slice(split)));
  }
  return {
    row: chunk.row,
    meta: base.meta,
    time,
    values: Object.fromEntries(keys.map((k, i) => [k, columns[i]])),
    fraction: chunk.fraction ?? base.fraction,
  };
}

/** The preview as a result the inspector can draw. */
export function liveResult(id: string, snapshot: Project, state: LiveState): SimulationResult {
  return {
    id,
    snapshot,
    engine: '',
    projectKey: '',
    modelHash: '',
    projectRevision: snapshot.revision,
    duration: snapshot.duration,
    simulation: effective(snapshot.duration, snapshot.simulation),
    elapsed: 0,
    time: state.time,
    samples: state.row,
    series: state.meta.map((m) => ({ ...m, values: state.values[m.key] ?? [] })),
    diagnostics: '',
    live: { fraction: state.fraction },
  };
}

/**
 * Follow a running job's results until it ends or `signal` aborts, calling
 * `onUpdate` with each new preview. Errors are retried quietly: the stream is
 * a convenience, and the job's own result is what counts.
 */
export async function followLive(
  id: string,
  snapshot: Project,
  signal: AbortSignal,
  onUpdate: (result: SimulationResult) => void,
  interval = 350,
) {
  let state: LiveState | null = null;
  const pause = () =>
    new Promise<void>((resolve) => {
      const timer = setTimeout(resolve, interval);
      signal.addEventListener('abort', () => {
        clearTimeout(timer);
        resolve();
      }, { once: true });
    });
  while (!signal.aborted) {
    let chunk: LiveChunk;
    try {
      chunk = await api<LiveChunk>(`/runs/${id}/live?after=${state?.row ?? 0}`, { signal });
    } catch {
      if (signal.aborted) return;
      await pause();
      continue;
    }
    if (chunk.done || chunk.unavailable) return;
    const next = appendLive(state, chunk);
    if (next && next !== state && (chunk.time?.length || chunk.reset || !state)) {
      state = next;
      if (state.time.length) onUpdate(liveResult(id, snapshot, state));
    } else if (next) state = next;
    await pause();
  }
}
