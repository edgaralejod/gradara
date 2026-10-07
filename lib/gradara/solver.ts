// SPDX-License-Identifier: Apache-2.0
/**
 * Simulation settings: defaults, limits, and what a model's settings mean for
 * a run. The service applies the same rules (server/solver.py); both read
 * lib/gradara/solver-settings.json, and tests/fixtures/solver-cases.json holds
 * them to the same answers. Labels and help text are in solver-docs.ts.
 */
import shared from './solver-settings.json';

export type SolverId = 'dassl' | 'esdirk' | 'backwardEuler' | 'rk4';

/** A model's `simulation` object. Absent fields use the defaults. */
export type SimulationSettings = {
  solver?: SolverId;
  /** Variable step: allowed error per step. */
  tolerance?: number;
  /** Variable step: longest step, in seconds; absent means the solver decides. */
  maxStep?: number;
  /** Variable step: spacing of recorded points, in seconds; absent means stop time / 6000. */
  outputInterval?: number;
  /** Fixed step: the step (and output interval), in seconds; absent means stop time / 6000. */
  step?: number;
};

/** The settings a run used, defaults filled in (`result.simulation`). */
export type EffectiveSettings = {
  solver: SolverId;
  tolerance: number;
  /** Output intervals requested; with a fixed step, also the number of steps. */
  points: number;
  /** Fixed step only: the step after fitting a whole number of steps into the stop time. */
  step?: number;
  maxStep?: number;
};

export const SOLVER_IDS = Object.keys(shared.solvers) as SolverId[];
export const DEFAULTS = shared.defaults as { solver: SolverId; tolerance: number; points: number };
export const TOLERANCE = shared.tolerance;
/** Most output points (or fixed steps) one run may request. */
export const MAX_POINTS = shared.maxPoints;
/** Above this many points a run is allowed but its data is large. */
export const LARGE_POINTS = 50000;
/** A maximum step that forces more steps than this makes runs slow (a 1e-4 s step over an hour took minutes). */
export const SLOW_STEPS = 1000000;

export type SettingsField = 'tolerance' | 'maxStep' | 'outputInterval' | 'step';

export function isFixed(solver: SolverId): boolean {
  return shared.solvers[solver].fixed;
}

export function isSolverId(value: unknown): value is SolverId {
  return typeof value === 'string' && SOLVER_IDS.includes(value as SolverId);
}

/** Whole intervals that cover `duration` with no interval longer than `spacing`. */
export function stepsFor(duration: number, spacing: number): number {
  return Math.max(1, Math.ceil(duration / spacing - 1e-9));
}

export function effective(duration: number, settings?: SimulationSettings): EffectiveSettings {
  const solver = settings?.solver ?? DEFAULTS.solver;
  if (isFixed(solver)) {
    const points = settings?.step ? stepsFor(duration, settings.step) : DEFAULTS.points;
    return { solver, points, step: duration / points, tolerance: DEFAULTS.tolerance };
  }
  const out: EffectiveSettings = {
    solver,
    tolerance: settings?.tolerance ?? DEFAULTS.tolerance,
    points: settings?.outputInterval ? stepsFor(duration, settings.outputInterval) : DEFAULTS.points,
  };
  if (settings?.maxStep) out.maxStep = settings.maxStep;
  return out;
}

function same(a: EffectiveSettings, b: EffectiveSettings) {
  return (
    a.solver === b.solver &&
    a.tolerance === b.tolerance &&
    a.points === b.points &&
    a.step === b.step &&
    a.maxStep === b.maxStep
  );
}

export function isDefault(duration: number, settings?: SimulationSettings): boolean {
  return same(effective(duration, settings), effective(duration));
}

/** The settings that change a run, for staleness checks: fields of the other solver type are left out. */
export function signature(duration: number, settings?: SimulationSettings) {
  const run = effective(duration, settings);
  return isDefault(duration, settings) ? undefined : run;
}

/** Settings minus empty fields; undefined when nothing is set. */
export function cleanSettings(settings: SimulationSettings): SimulationSettings | undefined {
  const out: SimulationSettings = {};
  for (const [key, value] of Object.entries(settings) as [keyof SimulationSettings, unknown][])
    if (value !== undefined && value !== null) (out as Record<string, unknown>)[key] = value;
  return Object.keys(out).length ? out : undefined;
}

/** Seconds for people: 1.7 µs, 250 ms, 14.4 s. */
export function formatSeconds(value: number): string {
  const abs = Math.abs(value);
  const [scale, unit] =
    abs === 0 || abs >= 1 ? [1, 's'] : abs >= 1e-3 ? [1e3, 'ms'] : abs >= 1e-6 ? [1e6, 'µs'] : [1e9, 'ns'];
  return `${Number((value * scale).toPrecision(3))} ${unit}`;
}

/** 1e-6 rather than 0.000001; 2.5e-7. */
export function formatTolerance(value: number): string {
  const [mantissa, power] = value.toExponential().split('e');
  return `${Number(mantissa)}e${Number(power)}`;
}

export function formatCount(value: number): string {
  return value.toLocaleString('en-US');
}

/** Problems that keep a run from starting (the service checks the same rules). */
export function settingsProblems(
  duration: number,
  settings?: SimulationSettings,
): { field: SettingsField; message: string }[] {
  if (!settings) return [];
  const out: { field: SettingsField; message: string }[] = [];
  const solver = settings.solver ?? DEFAULTS.solver;
  const check = (field: SettingsField, spacing: number | undefined, what: string) => {
    if (!spacing) return;
    if (spacing > duration)
      out.push({ field, message: `The ${what} is longer than the stop time (${formatSeconds(duration)}).` });
    else if (stepsFor(duration, spacing) > MAX_POINTS)
      out.push({
        field,
        message: `That is ${formatCount(stepsFor(duration, spacing))} points; the limit is ${formatCount(MAX_POINTS)}. Use at least ${formatSeconds(duration / MAX_POINTS)}.`,
      });
  };
  if (isFixed(solver)) check('step', settings.step, 'step size');
  else check('outputInterval', settings.outputInterval, 'output interval');
  return out;
}

/** What the current values mean for the run, as one line under the settings. */
export function consequence(
  duration: number,
  settings?: SimulationSettings,
): { text: string; warning?: string } {
  const run = effective(duration, settings);
  const spacing = duration / run.points;
  const text = isFixed(run.solver)
    ? `${formatCount(run.points)} steps of ${formatSeconds(spacing)}`
    : `Records ${formatCount(run.points + 1)} points, one every ${formatSeconds(spacing)}, plus events`;
  const problem = settingsProblems(duration, settings)[0];
  if (problem) return { text, warning: problem.message };
  if (run.points > LARGE_POINTS)
    return { text, warning: 'That is a lot of data: expect a slower run and larger result files.' };
  if (isFixed(run.solver) && run.points < 100)
    return { text, warning: 'Fewer than 100 steps: the result will be coarse.' };
  if (run.maxStep !== undefined && duration / run.maxStep > SLOW_STEPS)
    return {
      text,
      warning: `At least ${formatCount(Math.round(duration / run.maxStep))} steps: expect a slow run, possibly past the time limit.`,
    };
  return { text };
}
