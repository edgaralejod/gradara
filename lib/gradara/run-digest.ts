// SPDX-License-Identifier: Apache-2.0
/** The run digest (POST /api/results/digest), as the Run summary shows it. */

export type DigestStats = {
  min: number;
  tMin: number;
  max: number;
  tMax: number;
  mean: number;
  rms: number;
  initial: number;
  final: number;
  peakToPeak: number;
};

export type DigestSignal = {
  /** Run label: A, B, C in the order the runs were given. */
  run: string;
  key: string;
  name: string;
  unit: string;
  logged: boolean;
  stats: DigestStats;
  steady: {
    value?: number;
    ripple?: number;
    band?: number;
    settlingTime?: number;
    overshootPercent?: number;
  };
  zeroCrossings: number;
  crossingsOfSteady: number;
  envelope: [number, number, number][];
};

export type DigestEvent = {
  run: string;
  signal: string;
  kind: 'transient' | 'not settled' | 'step' | 'switching' | 'clipped';
  t0: number;
  t1: number;
  detail: string;
};

export type RunDigest = {
  window: [number, number];
  wholeRun: boolean;
  runs: {
    label: string;
    id: string;
    name: string;
    finished: number | null;
    stopTime: number;
    samples: number;
    baseline: boolean;
  }[];
  signals: DigestSignal[];
  missing: { signal: string; run: string }[];
  events: DigestEvent[];
  comparison: {
    signal: string;
    run: string;
    baseline: string;
    maxAbsDifference: number;
    at: number;
    signedAtMax: number;
    rmsDifference: number;
  }[];
  parameters: {
    run: string;
    baseline: string;
    block: string;
    parameter?: string;
    from?: number;
    to?: number;
    unit?: string;
    change?: 'added' | 'removed';
  }[];
  warnings: string[];
  availableSignals: { key: string; name: string; unit: string; logged: boolean }[];
};

/** Group the digest's rows by signal, keeping the order the signals were asked for. */
export function bySignal(digest: RunDigest): { key: string; name: string; unit: string; rows: DigestSignal[] }[] {
  const groups = new Map<string, { key: string; name: string; unit: string; rows: DigestSignal[] }>();
  for (const row of digest.signals) {
    const group = groups.get(row.key) ?? { key: row.key, name: row.name, unit: row.unit, rows: [] };
    group.rows.push(row);
    groups.set(row.key, group);
  }
  return [...groups.values()];
}
