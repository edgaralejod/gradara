import { categoryOf } from './catalog';
import { findSubsystem, isBoundary, isInstance, refsOf } from './hierarchy';
import type { Block, LibraryCategoryId, Project } from './model';
import { isCausal } from './model';
import { flattenWires } from './net';
import {
  effective,
  formatCount,
  formatSeconds,
  isFixed,
  MAX_POINTS,
  stepsFor,
  type EffectiveSettings,
  type SimulationSettings,
  type SolverId,
} from './solver';

/** What C code is generated for: one subsystem instance, or a set of blocks on the open sheet. */
export type CodeUnit =
  | { kind: 'instance'; instanceId: string }
  | { kind: 'selection'; blockIds: string[] };

export type CodegenOptions = {
  /** Absent: the model's fixed step. A value overrides it, and the code then matches no run. */
  step?: number;
  method: 'forward' | 'backward' | 'tustin';
  real: 'double' | 'float';
  prefix: string;
};

export type CodegenPort = {
  name: string;
  label: string;
  domain: string;
  column: string | null;
};

export type CodegenResult =
  | {
      ok: true;
      files: Record<string, string>;
      step: number;
      /** Where the step came from: Simulation settings, or the Step field. */
      stepSource: 'model' | 'option';
      /** The model's effective simulation settings, as the service read them. */
      solver: EffectiveSettings;
      inputs: CodegenPort[];
      outputs: CodegenPort[];
      blocks: string[];
      notes: string[];
    }
  | { ok: false; error: string; blockIds: string[] };

export type VerifyResult =
  | {
      ok: boolean;
      steps: number;
      step: number;
      tolerance: number;
      outputs: {
        output: string;
        maxError: number;
        relative: number;
        passed: boolean;
      }[];
    }
  | { ok: false; error: string; blockIds: string[] };

/** Library categories whose blocks run in a controller. Plant stand-ins (inverter models) and sources stay out. */
const CONTROL_CATEGORIES = new Set<LibraryCategoryId>([
  'math',
  'continuous',
  'discrete',
  'nonlinear',
  'routing',
  'control',
  'logic',
]);

function signalOnly(block: Block) {
  return block.definition.ports.every((p) => isCausal(p.domain));
}

/** A block that can be part of generated controller code. */
export function isControlBlock(block: Block) {
  const d = block.definition;
  if (isBoundary(block) || !signalOnly(block)) return false;
  if (!d.ports.some((p) => p.direction === 'input')) return false;
  if (isInstance(block)) return true;
  if (['scope', 'display', 'terminator'].includes(d.kind)) return false;
  return CONTROL_CATEGORIES.has(categoryOf(d));
}

/**
 * Find the controller on a sheet: the signal-processing blocks connected to each other,
 * between the plant's measurements and its actuators. The group holding a block marked
 * as a controller wins; otherwise the largest group.
 */
export function detectController(project: Project): CodeUnit | null {
  const candidates = new Map(
    project.blocks.filter(isControlBlock).map((b) => [b.id, b]),
  );
  if (!candidates.size) return null;
  const parent = new Map<string, string>();
  const find = (x: string): string => {
    while (parent.get(x) && parent.get(x) !== x) x = parent.get(x)!;
    return x;
  };
  for (const id of candidates.keys()) parent.set(id, id);
  for (const w of flattenWires(project)) {
    if (candidates.has(w.source) && candidates.has(w.target))
      parent.set(find(w.source), find(w.target));
  }
  const groups = new Map<string, string[]>();
  for (const id of [...candidates.keys()].sort())
    groups.set(find(id), [...(groups.get(find(id)) ?? []), id]);
  const ranked = [...groups.values()].sort((a, b) => {
    const marked = (g: string[]) =>
      g.some((id) => candidates.get(id)!.definition.controller) ? 1 : 0;
    return (
      marked(b) - marked(a) || b.length - a.length || a[0].localeCompare(b[0])
    );
  });
  const best = ranked[0];
  // Constants that only feed the controller (a zero d-axis reference, say) belong inside it.
  const wires = flattenWires(project);
  for (const b of project.blocks) {
    if (b.definition.kind !== 'constant') continue;
    const targets = wires.filter((w) => w.source === b.id).map((w) => w.target);
    if (targets.length && targets.every((t) => best.includes(t)))
      best.push(b.id);
  }
  best.sort();
  if (best.length === 1 && isInstance(candidates.get(best[0])!))
    return { kind: 'instance', instanceId: best[0] };
  return { kind: 'selection', blockIds: best };
}

/** The unit for the current selection: one subsystem, or the selected blocks. */
export function selectionUnit(
  project: Project,
  blockIds: string[],
): CodeUnit | null {
  const blocks = project.blocks.filter((b) => blockIds.includes(b.id));
  if (!blocks.length) return null;
  if (blocks.length === 1 && isInstance(blocks[0]))
    return { kind: 'instance', instanceId: blocks[0].id };
  return { kind: 'selection', blockIds: blocks.map((b) => b.id).sort() };
}

export function unitLabel(project: Project, unit: CodeUnit) {
  const name = (id: string) =>
    project.blocks.find((b) => b.id === id)?.definition.name ?? id;
  if (unit.kind === 'instance') return name(unit.instanceId);
  const names = unit.blockIds.map(name);
  return names.length <= 3
    ? names.join(', ')
    : `${names.slice(0, 2).join(', ')} and ${names.length - 2} more`;
}

export function unitBlockIds(unit: CodeUnit) {
  return unit.kind === 'instance' ? [unit.instanceId] : unit.blockIds;
}

/** A C identifier prefix from the unit's name. */
export function defaultPrefix(project: Project, unit: CodeUnit) {
  const base =
    unit.kind === 'instance'
      ? (project.blocks.find((b) => b.id === unit.instanceId)?.definition
          .name ?? 'controller')
      : 'controller';
  const clean = base
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '');
  return /^[a-z]/.test(clean) ? clean.slice(0, 40) : 'controller';
}

export function codegenBody(
  doc: Project,
  path: string[],
  unit: CodeUnit,
  options: CodegenOptions,
  runId?: string,
) {
  return JSON.stringify({
    project: doc,
    path,
    ...(unit.kind === 'instance'
      ? { instanceId: unit.instanceId }
      : { blockIds: unit.blockIds }),
    options,
    ...(runId ? { runId } : {}),
  });
}

/** The solver names Simulation settings shows (solver-docs.ts), for the readiness lines. */
const SOLVER_NAMES: Record<SolverId, string> = {
  dassl: 'DASSL',
  esdirk: 'Implicit Runge-Kutta',
  backwardEuler: 'Backward Euler',
  rk4: 'Runge-Kutta 4',
};

/** Most controller steps a verification replays (server/codegen.py MAX_SIL_STEPS). */
export const MAX_SIL_STEPS = 500_000;

/** The kinds whose sample period sets the rate a controller runs at. */
const SAMPLED_PERIOD_IDS = new Set(['samplePeriod', 'Ts']);

/** The blocks a unit is made of, nested subsystems included. */
export function unitBlocks(doc: Project, sheet: Project, unit: CodeUnit): Block[] {
  const out: Block[] = [];
  const seen = new Set<string>();
  const visit = (block: Block) => {
    out.push(block);
    if (!isInstance(block)) return;
    for (const ref of refsOf(block.definition)) {
      if (seen.has(ref)) continue;
      seen.add(ref);
      for (const inner of findSubsystem(doc, ref)?.blocks ?? []) visit(inner);
    }
  };
  for (const id of unitBlockIds(unit)) {
    const block = sheet.blocks.find((b) => b.id === id);
    if (block) visit(block);
  }
  return out;
}

/**
 * The fixed step to switch the model to for a unit: its shortest sample period,
 * so sampled blocks run every step, or else the spacing the model records at now.
 */
export function suggestedFixedStep(doc: Project, sheet: Project, unit: CodeUnit): number {
  const periods = unitBlocks(doc, sheet, unit).flatMap((b) =>
    b.definition.parameters
      .filter((p) => SAMPLED_PERIOD_IDS.has(p.id) && typeof p.value === 'number' && p.value > 0)
      .map((p) => p.value as number),
  );
  if (periods.length) return Math.min(...periods);
  const run = effective(doc.duration, doc.simulation);
  return doc.duration / run.points;
}

/** The settings Use fixed step writes: Runge-Kutta 4 at the step, other fields kept. */
export function fixedStepSettings(settings: SimulationSettings | undefined, step: number): SimulationSettings {
  return { ...settings, solver: 'rk4', step };
}

export type TimingLine = {
  ok: boolean;
  text: string;
  /** What the line's button does, when there is one. */
  action?: 'use-fixed-step' | 'run';
};

export type Readiness = {
  solver: TimingLine;
  run: TimingLine;
  /** Controller steps over the stop time, at the code's step. */
  steps: number;
  /** A caution that does not stop generation: too many steps to verify, or an overriding step. */
  warning?: string;
};

/** The last run, as the readiness list needs it. */
export type LastRun = {
  id: string;
  /** Absent on runs from before 0.6.9: the defaults, a variable-step solver. */
  simulation?: EffectiveSettings;
  /** The model changed since the run (its semantic signature differs). */
  stale: boolean;
};

/**
 * The Timing section of the C code flow: whether the model has a fixed step the
 * code can take, and whether the last run is one the code can be verified against.
 */
export function readiness(
  doc: Project,
  stepOverride: number | undefined,
  lastRun: LastRun | undefined,
): Readiness {
  const settings = effective(doc.duration, doc.simulation);
  const fixed = isFixed(settings.solver);
  const step = stepOverride ?? settings.step;
  const solver: TimingLine = fixed
    ? {
        ok: true,
        text: `${SOLVER_NAMES[settings.solver]} · step ${formatSeconds(settings.step!)} · from Simulation settings`,
      }
    : {
        ok: false,
        text: `${SOLVER_NAMES[settings.solver]} is a variable-step solver. C code steps at one fixed rate.`,
        action: 'use-fixed-step',
      };
  const steps = step ? stepsFor(doc.duration, step) : 0;
  let run: TimingLine;
  if (!step)
    run = { ok: false, text: 'Choose a fixed step first, then run the model to verify the code.' };
  else if (!lastRun)
    run = { ok: false, text: 'Run the model with this step to verify the code.', action: 'run' };
  else if (lastRun.stale)
    run = { ok: false, text: 'The model changed since the last run. Run it again to verify the code.', action: 'run' };
  else {
    const used = lastRun.simulation ?? effective(doc.duration, undefined);
    if (!isFixed(used.solver))
      run = {
        ok: false,
        text: `The last run used ${SOLVER_NAMES[used.solver]}, a variable-step solver. Run the model with the fixed step to verify the code.`,
        action: 'run',
      };
    else if (Math.abs(used.step! - step) > 1e-9 * step)
      run = {
        ok: false,
        text: `The last run stepped every ${formatSeconds(used.step!)}; the code steps every ${formatSeconds(step)}. Run the model again to verify the code.`,
        action: 'run',
      };
    else run = { ok: true, text: `Last run matches · ${formatCount(steps)} steps of ${formatSeconds(step)}` };
  }
  let warning: string | undefined;
  if (stepOverride !== undefined && fixed && Math.abs(stepOverride - settings.step!) > 1e-9 * stepOverride)
    warning = `The code steps every ${formatSeconds(stepOverride)}, not the model's ${formatSeconds(settings.step!)}. Leave Step blank to match the model and verify.`;
  else if (steps > MAX_SIL_STEPS)
    warning = `Verification replays up to ${formatCount(MAX_SIL_STEPS)} steps; this run has ${formatCount(steps)}. Shorten the stop time or use a longer step.`;
  else if (steps > MAX_POINTS)
    warning = `A run of ${formatCount(steps)} steps is over the limit of ${formatCount(MAX_POINTS)}. Shorten the stop time or use a longer step.`;
  return { solver, run, steps, warning };
}
