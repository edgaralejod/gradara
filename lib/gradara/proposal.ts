import type { Diagnostic } from './api';
import { arrangeIfBetter } from './arrange';
import { layoutNewBlocks } from './auto-layout';
import { defaultBlockSize } from './block-design';
import { isBoundary, placeBoundaryPorts, subsystemsOf } from './hierarchy';
import type { Block, Project, SubsystemDefinition, Wire } from './model';

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
  /** The sheet the proposal edits: a path of subsystem instance IDs, empty for the top level. */
  sheet?: string[];
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

function withoutRoute(wire: Wire): Wire {
  const { waypoints: _route, junctions: _bends, ...rest } = wire;
  return rest;
}

/**
 * Combine the proposal with the model the user has now. The server never
 * moves existing blocks or reroutes existing wires, so untouched objects are
 * kept exactly (routes, labels, sizes, nets); only definitions, new blocks,
 * new wires and their nets, removals, logged nets, the name, and the stop time
 * come from the proposal.
 * New blocks are placed by `layoutNewBlocks`, ignoring the server's rough position.
 *
 * A grouping (`group_into_subsystem`) arrives as a new definition in
 * `proposed.subsystems` and an instance block on the top level. The definition
 * is adopted with the user's own block and wire objects inside (sizes, rotation,
 * routes), its port pills are placed in line with what they feed, and the
 * instance keeps the position the server chose (the centre of the grouped
 * blocks); the inside and the top level are then tidied (`arrangeIfBetter`)
 * where that clearly helps, unless `tidy` is false. Existing definitions are
 * never replaced.
 */
export function mergeProposal(
  current: Project,
  proposed: Project,
  { tidy = true }: { tidy?: boolean } = {},
) {
  const blocks = new Map(current.blocks.map((b) => [b.id, b]));
  const wires = new Map(current.wires.map((w) => [w.id, w]));
  const existingDefinitions = new Set(subsystemsOf(current).map((s) => s.id));
  const adopted = subsystemsOf(proposed).filter(
    (s) => !existingDefinitions.has(s.id),
  );
  const adoptedIds = new Set(adopted.map((s) => s.id));
  const added: string[] = [];
  const placedByServer: string[] = [];
  const changed: string[] = [];

  /** The user's object for a block the proposal keeps; the proposal's for a new one. */
  const mergeBlock = (block: Block, into: string[]) => {
    const existing = blocks.get(block.id);
    if (!existing) {
      into.push(block.id);
      return { ...block, size: defaultBlockSize(block.definition) };
    }
    // An output the proposal logs (log_signal) is logged; nothing else on the block changes.
    const logged = [
      ...new Set([...(existing.logged ?? []), ...(block.logged ?? [])]),
    ];
    const withLog =
      logged.length !== (existing.logged ?? []).length
        ? { ...existing, logged }
        : existing;
    if (same(existing.definition, block.definition)) return withLog;
    changed.push(block.id);
    return { ...withLog, definition: block.definition };
  };
  const mergeWire = (wire: Wire) => {
    const existing = wires.get(wire.id);
    if (existing && sameEnds(existing, wire)) return existing;
    return withoutRoute(wire);
  };

  const nextBlocks: Block[] = proposed.blocks.map((block) => {
    const ref = block.definition.subsystem?.ref;
    if (!blocks.has(block.id) && ref && adoptedIds.has(ref)) {
      // The instance of a grouping stands where the grouped blocks were.
      placedByServer.push(block.id);
      return { ...block, size: defaultBlockSize(block.definition) };
    }
    return mergeBlock(block, added);
  });
  const nextWires: Wire[] = proposed.wires.map(mergeWire);
  const kept = new Set(nextWires.map((w) => w.id));
  // Nets keep their names and labels; a net the proposal logs (log_signal) is logged,
  // and nets the proposal made for its new wires come along for the reconciler to adopt.
  const proposedNets = new Map((proposed.nets ?? []).map((n) => [n.id, n]));
  const currentIds = new Set((current.nets ?? []).map((n) => n.id));
  const nets =
    current.nets || proposed.nets
      ? [
          ...(current.nets ?? []).map((n) => ({
            ...n,
            ...(proposedNets.get(n.id)?.logged && !n.logged
              ? { logged: true }
              : {}),
          })),
          ...(proposed.nets ?? []).filter((n) => !currentIds.has(n.id)),
        ]
          .map((n) => ({
            ...n,
            wireIds: n.wireIds.filter((id) => kept.has(id)),
          }))
          .filter((n) => n.wireIds.length)
      : undefined;
  // A grouping takes the junctions of its nets inside; the top level keeps the rest.
  const proposedJunctions = new Set(
    (proposed.junctions ?? []).map((j) => j.id),
  );
  const junctions = adopted.length
    ? (current.junctions ?? []).filter((j) => proposedJunctions.has(j.id))
    : current.junctions;
  const definitions: SubsystemDefinition[] = adopted.map((s) => {
    const inner = {
      ...s,
      blocks: s.blocks.map((b) =>
        isBoundary(b)
          ? { ...b, size: defaultBlockSize(b.definition) }
          : mergeBlock(b, []),
      ),
      wires: s.wires.map(mergeWire),
    };
    return placeBoundaryPorts(inner);
  });
  const merged: Project = {
    ...current,
    name: proposed.name,
    duration: proposed.duration,
    blocks: nextBlocks,
    wires: nextWires,
    ...(nets ? { nets } : {}),
    ...(junctions ? { junctions } : {}),
    ...(adopted.length
      ? {
          version: 2 as const,
          subsystems: [...subsystemsOf(current), ...definitions],
        }
      : {}),
  };
  // The agent never picks coordinates: new blocks get the house-style layout here.
  let project = layoutNewBlocks(merged, added);
  if (adopted.length && tidy) project = tidyGrouping(project, adoptedIds);
  return {
    project,
    added: [...added, ...placedByServer],
    changed,
  };
}

/** Tidy the inside of each adopted definition and the top level, where that clearly helps. */
function tidyGrouping(project: Project, adoptedIds: Set<string>): Project {
  const subsystems = subsystemsOf(project).map((s) => {
    if (!adoptedIds.has(s.id)) return s;
    const sheet: Project = {
      ...project,
      ...s,
      junctions: s.junctions ?? [],
      annotations: [],
    };
    const { project: arranged, improved } = arrangeIfBetter(sheet);
    if (!improved) return s;
    return {
      ...s,
      blocks: arranged.blocks,
      wires: arranged.wires,
      junctions: arranged.junctions ?? [],
      ...(arranged.nets ? { nets: arranged.nets } : {}),
    };
  });
  return arrangeIfBetter({ ...project, subsystems }).project;
}
