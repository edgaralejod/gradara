import { categoryOf } from './catalog';
import { isBoundary, isInstance } from './hierarchy';
import type { Block, LibraryCategoryId, Project } from './model';
import { isCausal } from './model';
import { flattenWires } from './net';

/** What C code is generated for: one subsystem instance, or a set of blocks on the open sheet. */
export type CodeUnit =
  | { kind: 'instance'; instanceId: string }
  | { kind: 'selection'; blockIds: string[] };

export type CodegenOptions = {
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
