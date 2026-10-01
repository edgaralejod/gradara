import type { Diagnostic } from './api';
import { layoutNewBlocks } from './auto-layout';
import { defaultBlockSize } from './block-design';
import type { Block, Project, Wire } from './model';

export type EditChange = {
  op: string;
  blockIds: string[];
  wireIds: string[];
  description: string;
};

/** A reviewed AI edit of the open model, as returned by POST /api/models/edit. */
export type EditProposal = {
  project: Project;
  summary: string;
  assumptions: string[];
  changes: EditChange[];
  /** The plan behind the proposal; sent back when the user asks to refine it. */
  operations: Record<string, unknown>[];
  generated: { alias: string; name: string }[];
  verified: boolean;
  diagnostics: Diagnostic[];
  samples: number | null;
  provider: string;
  credits?: number;
};

/** What POST /api/models/edit needs to revise an unapplied proposal. */
export type PreviousProposal = {
  prompt: string;
  summary: string;
  operations: Record<string, unknown>[];
};

const same = (a: unknown, b: unknown) =>
  JSON.stringify(a) === JSON.stringify(b);

function sameEnds(a: Wire, b: Wire) {
  return (
    a.source === b.source &&
    a.sourceHandle === b.sourceHandle &&
    a.target === b.target &&
    a.targetHandle === b.targetHandle
  );
}

/**
 * Combine the proposal with the model the user has now. The server never
 * moves existing blocks or reroutes existing wires, so untouched objects are
 * kept exactly (routes, labels, sizes, nets); only definitions, new blocks,
 * new wires, removals, the name, and the stop time come from the proposal.
 * New blocks are placed by `layoutNewBlocks`, ignoring the server's rough position.
 */
export function mergeProposal(current: Project, proposed: Project) {
  const blocks = new Map(current.blocks.map((b) => [b.id, b]));
  const wires = new Map(current.wires.map((w) => [w.id, w]));
  const added: string[] = [];
  const changed: string[] = [];
  const nextBlocks: Block[] = proposed.blocks.map((block) => {
    const existing = blocks.get(block.id);
    if (!existing) {
      added.push(block.id);
      return { ...block, size: defaultBlockSize(block.definition) };
    }
    if (same(existing.definition, block.definition)) return existing;
    changed.push(block.id);
    return { ...existing, definition: block.definition };
  });
  const nextWires: Wire[] = proposed.wires.map((wire) => {
    const existing = wires.get(wire.id);
    if (existing && sameEnds(existing, wire)) return existing;
    const { waypoints: _route, junctions: _bends, ...rest } = wire;
    return rest;
  });
  const kept = new Set(nextWires.map((w) => w.id));
  const nets = current.nets
    ?.map((n) => ({ ...n, wireIds: n.wireIds.filter((id) => kept.has(id)) }))
    .filter((n) => n.wireIds.length);
  const merged: Project = {
    ...current,
    name: proposed.name,
    duration: proposed.duration,
    blocks: nextBlocks,
    wires: nextWires,
    ...(nets ? { nets } : {}),
  };
  return {
    // The agent never picks coordinates: new blocks get the house-style layout here.
    project: layoutNewBlocks(merged, added),
    added,
    changed,
  };
}
