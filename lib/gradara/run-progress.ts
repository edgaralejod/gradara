// SPDX-License-Identifier: Apache-2.0
/**
 * A running simulation's progress as the workbench shows it. The service
 * reports each stage of the run in the job's `stage` (server/run_progress.py);
 * this file turns stages into steps, a fraction, and an estimate of the time
 * left. Pure functions, so they are tested without a browser.
 */
import { formatSeconds } from './solver';

export type RunPhase =
  | 'preparing'
  | 'translating'
  | 'compiling'
  | 'starting'
  | 'simulating'
  | 'reading';

/** One report from the service: the phase and, while simulating, how far it has got. */
export type RunStage = {
  phase: RunPhase;
  /** Simulated time reached, in seconds (simulating only). */
  time?: number;
  /** time / stop time, from 0 to 1 (simulating only). */
  fraction?: number;
};

/** What the workbench keeps about the run on show. */
export type RunTrack = {
  stage: RunStage;
  stopTime: number;
  /** Shown above the bar when several runs go in turn (Run all configurations). */
  label?: string;
  /** Client clock (ms) when the run was submitted. */
  startedAt: number;
  /** Client clock (ms) of the first report in the simulating phase. */
  simulatingSince?: number;
  /** Fraction at simulatingSince, so the estimate counts only progress made since. */
  fractionAtStart?: number;
};

export const STEPS = [
  { id: 'translate', label: 'Translate', phases: ['preparing', 'translating'] },
  { id: 'compile', label: 'Compile', phases: ['compiling', 'starting'] },
  { id: 'simulate', label: 'Simulate', phases: ['simulating'] },
  { id: 'results', label: 'Results', phases: ['reading'] },
] as const satisfies readonly { id: string; label: string; phases: readonly RunPhase[] }[];

const LABELS: Record<RunPhase, string> = {
  preparing: 'Checking the model',
  translating: 'Translating the model to equations',
  compiling: 'Compiling the simulation',
  starting: 'Starting the simulation',
  simulating: 'Simulating',
  reading: 'Reading the results',
};

export function phaseLabel(phase: RunPhase): string {
  return LABELS[phase];
}

/** Index of the step a phase belongs to (0 to 3). */
export function stepIndex(phase: RunPhase): number {
  return STEPS.findIndex((s) => (s.phases as readonly RunPhase[]).includes(phase));
}

/** A new run, before the service has said anything. */
export function startTrack(stopTime: number, label?: string, now = Date.now()): RunTrack {
  return { stage: { phase: 'preparing' }, stopTime, startedAt: now, ...(label ? { label } : {}) };
}

/** Fold a report into the track. Phases only move forward; a late report of an earlier phase is ignored. */
export function advance(track: RunTrack, stage: RunStage, now = Date.now()): RunTrack {
  const before = stepIndex(track.stage.phase);
  const after = stepIndex(stage.phase);
  if (after < before) return track;
  if (
    stage.phase === 'simulating' &&
    track.stage.phase === 'simulating' &&
    (stage.fraction ?? 0) < (track.stage.fraction ?? 0)
  )
    return track;
  const next: RunTrack = { ...track, stage };
  if (stage.phase === 'simulating' && track.simulatingSince === undefined) {
    next.simulatingSince = now;
    next.fractionAtStart = stage.fraction ?? 0;
  }
  return next;
}

/**
 * Seconds of simulation left, from the rate since simulating began; undefined
 * until there is enough to go on (a few percent and a second and a half).
 */
export function secondsLeft(track: RunTrack, now: number): number | undefined {
  const { stage, simulatingSince, fractionAtStart = 0 } = track;
  if (stage.phase !== 'simulating' || simulatingSince === undefined) return undefined;
  const done = (stage.fraction ?? 0) - fractionAtStart;
  const spent = (now - simulatingSince) / 1000;
  if (done < 0.03 || spent < 1.5) return undefined;
  return ((1 - (stage.fraction ?? 0)) * spent) / done;
}

/** "about 12 s left", "about 3 min left", "almost done". */
export function leftText(seconds: number | undefined): string {
  if (seconds === undefined) return '';
  if (seconds < 2) return 'almost done';
  if (seconds < 60) return `about ${Math.round(seconds)} s left`;
  if (seconds < 3600) return `about ${Math.round(seconds / 60)} min left`;
  return `about ${(seconds / 3600).toFixed(1)} h left`;
}

/** "0:07", "1:05": time since the run was submitted. */
export function elapsedText(track: RunTrack, now: number): string {
  const s = Math.max(0, Math.floor((now - track.startedAt) / 1000));
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
}

/** "1.68 s of 4 s", in the stop time's units. */
export function simulatedText(track: RunTrack): string {
  if (track.stage.phase !== 'simulating' && track.stage.phase !== 'reading') return '';
  const time = track.stage.phase === 'reading' ? track.stopTime : (track.stage.time ?? 0);
  return `${formatSeconds(time)} of ${formatSeconds(track.stopTime)}`;
}

/** The bar: a fraction while simulating (full while reading), or undefined for an indeterminate bar. */
export function barFraction(track: RunTrack): number | undefined {
  if (track.stage.phase === 'simulating') return track.stage.fraction ?? 0;
  return undefined;
}

/** "Simulating · 42%" for the status bar and the Run button's title. */
export function statusText(track: RunTrack): string {
  const { phase, fraction } = track.stage;
  const base = phase === 'simulating' ? `Simulating · ${Math.floor((fraction ?? 0) * 100)}%` : phaseLabel(phase);
  return track.label ? `${track.label} · ${base}` : base;
}
