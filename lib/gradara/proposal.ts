import type { Diagnostic } from './api';
import { defaultBlockSize, snapBlockPosition } from './block-design';
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
  generated: { alias: string; name: string }[];
  verified: boolean;
  diagnostics: Diagnostic[];
  samples: number | null;
  provider: string;
  credits?: number;
};

const same = (a: unknown, b: unknown) => JSON.stringify(a) === JSON.stringify(b);

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
      const size = defaultBlockSize(block.definition);
      return { ...block, size, position: snapBlockPosition(block.position, size) };
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
  return {
    project: {
      ...current,
      name: proposed.name,
      duration: proposed.duration,
      blocks: nextBlocks,
      wires: nextWires,
      ...(nets ? { nets } : {}),
    },
    added,
    changed,
  };
}
