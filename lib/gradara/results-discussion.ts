// SPDX-License-Identifier: Apache-2.0
/** Explain results: the answer the service returns, and how the card words it. */

export type Metric =
  | 'min'
  | 'max'
  | 'mean'
  | 'rms'
  | 'final'
  | 'initial'
  | 'peakToPeak'
  | 'valueAt'
  | 'settlingTime'
  | 'overshootPercent'
  | 'steadyValue'
  | 'ripple'
  | 'tMax'
  | 'tMin';

export type Evidence = {
  /** Run label: A is the run asked about, then B and C. */
  run: string;
  signal: string;
  metric: Metric;
  t0: number | null;
  t1: number | null;
  at: number | null;
  /** Recomputed by Gradara from the stored data. */
  value: number;
  checked: true;
};

export type ResultsAnswer = {
  explanation: string;
  findings: { text: string; evidence: Evidence[] }[];
  causes: {
    text: string;
    kind: 'measured' | 'hypothesis';
    blockIds: string[];
    evidence: Evidence[];
  }[];
  nextSteps: string[];
  missing: string[];
  changePrompt: string | null;
  /** Claims Gradara removed because their numbers did not match the data. */
  removed: number;
};

export type ExplainResult = {
  answer: ResultsAnswer;
  measurements: Record<string, unknown>[];
  window: [number, number];
  /** Run IDs by label. */
  runs: Record<string, string>;
  signals: Record<string, { name: string; unit: string }>;
  provider: string;
  credits?: number;
};

/** One question and its answer in a results discussion. */
export type ResultsTurn = { question: string; result: ExplainResult };

const TIME_METRICS = new Set<Metric>(['tMax', 'tMin', 'settlingTime']);

export const metricLabels: Record<Metric, string> = {
  min: 'minimum',
  max: 'maximum',
  mean: 'mean',
  rms: 'RMS',
  final: 'final value',
  initial: 'initial value',
  peakToPeak: 'peak-to-peak',
  valueAt: 'value',
  settlingTime: 'settles at',
  overshootPercent: 'overshoot',
  steadyValue: 'steady value',
  ripple: 'ripple',
  tMax: 'maximum at',
  tMin: 'minimum at',
};

/** A number for an engineer: four significant digits, no exponent for everyday sizes. */
export function formatNumber(value: number): string {
  if (!Number.isFinite(value)) return String(value);
  if (value === 0) return '0';
  const size = Math.abs(value);
  if (size >= 1e-3 && size < 1e6) return String(Number(value.toPrecision(4)));
  return value.toExponential(3).replace(/\.?0+e/, 'e');
}

/** "maximum 12.54 A", "settles at 0.31 s", "overshoot 25.4 %". */
export function evidenceText(evidence: Evidence, unit: string): string {
  const label = metricLabels[evidence.metric] ?? evidence.metric;
  const value = formatNumber(evidence.value);
  if (TIME_METRICS.has(evidence.metric)) return `${label} ${value} s`;
  if (evidence.metric === 'overshootPercent') return `${label} ${value} %`;
  const at =
    evidence.metric === 'valueAt' && evidence.at !== null
      ? ` at ${formatNumber(evidence.at)} s`
      : '';
  return `${label}${at} ${value}${unit ? ` ${unit}` : ''}`;
}

/** Where on the plot an evidence item points: a window, or one instant. */
export function evidenceTarget(
  evidence: Evidence,
  window: [number, number],
): { window?: [number, number]; at?: number } {
  if (evidence.metric === 'valueAt' && evidence.at !== null)
    return { at: evidence.at };
  if (TIME_METRICS.has(evidence.metric)) return { at: evidence.value };
  const t0 = evidence.t0 ?? window[0];
  const t1 = evidence.t1 ?? window[1];
  return { window: [t0, t1] };
}

/** The answer as plain text, sent back as an earlier turn when the user asks a follow-up. */
export function answerText(answer: ResultsAnswer): string {
  const lines = [answer.explanation];
  for (const f of answer.findings)
    lines.push(
      `- ${f.text}${f.evidence.length ? ` [${f.evidence.map((e) => `${e.run} ${e.signal} ${e.metric}=${formatNumber(e.value)}`).join('; ')}]` : ''}`,
    );
  for (const c of answer.causes) lines.push(`- ${c.kind}: ${c.text}`);
  if (answer.missing.length) lines.push(`Not recorded: ${answer.missing.join('; ')}`);
  return lines.join('\n').slice(0, 3000);
}
