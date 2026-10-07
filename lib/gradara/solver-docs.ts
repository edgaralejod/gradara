// SPDX-License-Identifier: Apache-2.0
/**
 * The words for simulation settings, in one place: the inspector's labels and
 * one-liners, each field's help popover, the Simulation settings help dialog,
 * and docs/SOLVER.md (written from this file by `npm run docs:solver`) all read
 * from here, so the app and the docs say the same thing.
 */
import {
  DEFAULTS,
  MAX_POINTS,
  TOLERANCE,
  formatCount,
  formatSeconds,
  formatTolerance,
  isFixed,
  type EffectiveSettings,
  type SettingsField,
  type SolverId,
} from './solver';

export type SolverText = {
  name: string;
  /** One line under the menu for the chosen solver. */
  whenToUse: string;
  /** The help popover and the guide. */
  detail: string;
};

export const SOLVERS: Record<SolverId, SolverText> = {
  dassl: {
    name: 'DASSL',
    whenToUse: 'Start here. Handles stiff models, switching, and physical networks.',
    detail:
      'An implicit multistep method (BDF, orders 1 to 5) that picks its own step and order to keep the error within the tolerance, and stops exactly at every event. It suits almost every model.',
  },
  esdirk: {
    name: 'Implicit Runge-Kutta',
    whenToUse: 'Try it when a model that switches often runs slowly.',
    detail:
      'An implicit single-step method (ESDIRK, order 4) with its own step control. After every event DASSL restarts at low order with small steps; a single-step method does not need to, so models that switch thousands of times often finish sooner.',
  },
  backwardEuler: {
    name: 'Backward Euler',
    whenToUse: 'A fixed step that stays stable on stiff models, at modest accuracy.',
    detail:
      'Every step has the same length. Implicit and first order: it stays stable with a large step, but its error shrinks only in proportion to the step. Use it when you need a fixed step on a model with fast and slow parts.',
  },
  rk4: {
    name: 'Runge-Kutta 4',
    whenToUse: 'An accurate fixed step for smooth models without very fast parts.',
    detail:
      'The classic fourth-order explicit method at a constant step. Accurate for its step, but a step longer than about the fastest time constant in the model makes values grow without bound.',
  },
};

export type FieldText = {
  label: string;
  unit?: string;
  /** Shown under the field at all times. */
  line: string;
  /** The help popover. */
  help: string[];
  /** Where the default comes from, for the guide's table. */
  defaultText: string;
  /** Which solvers use the field. */
  appliesTo: 'variable' | 'fixed';
};

export const FIELDS: Record<SettingsField, FieldText> = {
  tolerance: {
    label: 'Tolerance',
    line: 'Error allowed in each step. Smaller is more accurate and slower.',
    help: [
      `The relative error the solver accepts in each step; it is also used as the absolute error. ${formatTolerance(DEFAULTS.tolerance)} suits almost every model. The choices run from ${formatTolerance(TOLERANCE.max)} to ${formatTolerance(TOLERANCE.min)}.`,
      'To check a result, run again with a tolerance 100 times smaller and compare the two runs. If they agree, the result does not depend on the solver.',
      'Loosening it rarely speeds up a model that switches. With DASSL it can do the opposite: the solver rattles back and forth across switching thresholds and records far more data. Implicit Runge-Kutta copes better with a loose tolerance.',
    ],
    defaultText: formatTolerance(DEFAULTS.tolerance),
    appliesTo: 'variable',
  },
  maxStep: {
    label: 'Maximum step',
    unit: 's',
    line: 'Longest step the solver may take. Leave it blank to let the solver decide.',
    help: [
      'A variable-step solver takes long steps while little changes, and can step right over a pulse that is shorter than its step.',
      'Set a maximum step shorter than the shortest pulse or feature you need. On a model that switches, a maximum step of about half the switching period can also make the run faster, because the solver stops overshooting the next edge.',
      'Smaller values make every run slower. Leave it blank unless something is missed.',
    ],
    defaultText: 'Automatic',
    appliesTo: 'variable',
  },
  outputInterval: {
    label: 'Output interval',
    unit: 's',
    line: 'How often results are recorded. It hardly affects accuracy.',
    help: [
      `The spacing of the recorded points. Blank records ${formatCount(DEFAULTS.points)} intervals across the stop time. Events are always recorded as well, at the instant they happen.`,
      'The solver still steps as the tolerance requires, so this changes what you see in plots and downloads, not how accurately the model is solved (final values typically move by less than the tolerance).',
      'Make it smaller if a smooth curve looks jagged; larger if runs produce more data than you need.',
    ],
    defaultText: `Stop time / ${formatCount(DEFAULTS.points)}`,
    appliesTo: 'variable',
  },
  step: {
    label: 'Step size',
    unit: 's',
    line: 'Length of every step; results are recorded at each one. Smaller is more accurate and slower.',
    help: [
      'A fixed-step solver never adapts, so the step must resolve the fastest thing in the model: a few times shorter than the shortest time constant, and many times shorter than a switching period.',
      `The step is shortened slightly if needed so that a whole number of steps fits the stop time. Blank uses stop time / ${formatCount(DEFAULTS.points)}.`,
      'If values blow up or the run stops early, the step is too large.',
    ],
    defaultText: `Stop time / ${formatCount(DEFAULTS.points)}`,
    appliesTo: 'fixed',
  },
};

export const SOLVER_LINE =
  'Variable-step solvers choose each step to meet the tolerance. Fixed-step solvers use one step throughout.';

export type Symptom = {
  /** Diagnostics link here through their `help` field. */
  id: string;
  symptom: string;
  change: string;
};

/** What to change when something looks wrong. */
export const SYMPTOMS: Symptom[] = [
  {
    id: 'jagged',
    symptom: 'A smooth curve looks jagged or coarse.',
    change: 'Set a smaller output interval.',
  },
  {
    id: 'missed-pulse',
    symptom: 'A short pulse or spike is missing, or looks different from run to run.',
    change: 'Set a maximum step shorter than the pulse. With a fixed step, use a step shorter than the pulse.',
  },
  {
    id: 'slow',
    symptom: 'The run is slow or hits the time limit.',
    change:
      'For a model that switches often, try Implicit Runge-Kutta, or a maximum step of about half the switching period. With a fixed step, use a larger step.',
  },
  {
    id: 'too-much-data',
    symptom: 'A run produces far more data than expected, or is stopped for it.',
    change:
      'Go back to the default tolerance, or use Implicit Runge-Kutta: with a loose tolerance DASSL can rattle across switching thresholds. A maximum step or a larger output interval also helps.',
  },
  {
    id: 'stopped-early',
    symptom: 'The run stops before the stop time.',
    change:
      'With a fixed step, use a smaller step or Backward Euler. With a variable step, try the other variable-step solver or a maximum step. If it still stops, check the Problems list: the model itself may be at fault.',
  },
  {
    id: 'fixed-blows-up',
    symptom: 'With a fixed step, values grow huge or become non-finite.',
    change: 'The step is too large for the fastest part of the model. Use a smaller step or Backward Euler.',
  },
  {
    id: 'check-result',
    symptom: 'You are not sure the result is right.',
    change:
      'Run again with a tolerance 100 times smaller (or half the fixed step) and compare the two runs in Results. If they agree, the settings are not what shapes the result.',
  },
];

export const LIMITS_TEXT = `One run may record at most ${formatCount(MAX_POINTS)} points (or take that many fixed steps), must finish within 120 seconds, and is stopped if its results pass 1 GB.`;

/** "Implicit Runge-Kutta · tolerance 1e-8", for run labels and comparisons. */
export function describeRun(run: EffectiveSettings, duration?: number): string {
  const name = SOLVERS[run.solver].name;
  if (isFixed(run.solver)) return `${name} · step ${formatSeconds(run.step ?? 0)}`;
  const parts = [name, `tolerance ${formatTolerance(run.tolerance)}`];
  if (run.maxStep) parts.push(`max step ${formatSeconds(run.maxStep)}`);
  if (duration !== undefined && run.points !== DEFAULTS.points)
    parts.push(`output every ${formatSeconds(duration / run.points)}`);
  return parts.join(' · ');
}

export function symptom(id: string | null | undefined): Symptom | undefined {
  return SYMPTOMS.find((s) => s.id === id);
}

/** docs/SOLVER.md, written from the text above. */
export function solverGuideMarkdown(): string {
  const lines: string[] = [];
  const add = (...l: string[]) => lines.push(...l);
  add(
    '<!-- Generated from lib/gradara/solver-docs.ts by `npm run docs:solver`. Edit that file, not this one. -->',
    '',
    '# Simulation settings',
    '',
    'Gradara solves every model with OpenModelica. The defaults suit most models: change a setting when you see one of the [symptoms below](#when-something-looks-wrong), not before. The settings are in the model inspector (click empty canvas), under Stop time; each field explains itself in one line and has a help button with more. The same guide opens from the help button next to **Simulation**. Settings are saved with the model and recorded with every run, so runs with different settings can be compared in Results.',
    '',
    '## Solvers',
    '',
    SOLVER_LINE,
    '',
    '| Solver | Type | Use it when |',
    '| --- | --- | --- |',
  );
  for (const [id, s] of Object.entries(SOLVERS) as [SolverId, SolverText][])
    add(`| ${s.name} | ${isFixed(id) ? 'Fixed step' : 'Variable step'} | ${s.whenToUse} |`);
  add('');
  for (const s of Object.values(SOLVERS)) add(`**${s.name}.** ${s.detail}`, '');
  add('## Settings', '', '| Setting | Solvers | Default | What it does |', '| --- | --- | --- | --- |');
  for (const f of Object.values(FIELDS))
    add(`| ${f.label}${f.unit ? ` (${f.unit})` : ''} | ${f.appliesTo === 'variable' ? 'Variable step' : 'Fixed step'} | ${f.defaultText} | ${f.line} |`);
  add('');
  for (const f of Object.values(FIELDS)) add(`**${f.label}.** ${f.help.join(' ')}`, '');
  add('## When something looks wrong', '', '| Symptom | What to change |', '| --- | --- |');
  for (const s of SYMPTOMS) add(`| ${s.symptom} | ${s.change} |`);
  add('', '## Limits', '', LIMITS_TEXT, '');
  return lines.join('\n');
}
