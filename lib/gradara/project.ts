import { polylineOfWire } from './net-draw';
import { simplifyPoints } from './routing';
import type { Project, Definition, Wire } from './model';
import { compatible, portOf } from './model';
import { connectionError, endpointPort, flattenWires, isTap } from './net';
import { emptySelection, extractSelection, pasteSelection } from './selection';
import { adoptBoundaryDomain } from './boundary-adopt';
import { signature as settingsSignature } from './solver';
function sheetSemantics(
  p: Pick<Project, 'blocks' | 'wires' | 'junctions' | 'nets'>,
) {
  return {
    loggedNets: (p.nets ?? [])
      .filter((n) => n.logged)
      .map((n) => n.id)
      .sort(),
    blocks: p.blocks.map((b) => ({
      id: b.id,
      kind: b.definition.kind,
      generated: !!b.definition.generated,
      ports: b.definition.ports.map((x) => [x.id, x.direction, x.domain]),
      parameters: b.definition.parameters.map((x) => [x.id, x.value]),
      declarations: b.definition.declarations ?? '',
      equations: b.definition.equations,
      // A tag joins nets as a wire does (lib/gradara/tag-blocks.ts).
      ...(b.definition.tag !== undefined ? { tag: b.definition.tag } : {}),
      ...(b.definition.subsystem
        ? {
            subsystem: b.definition.subsystem.ref,
            variants: (b.definition.subsystem.variants ?? []).map((v) => [
              v.id,
              v.ref,
              v.unused ?? [],
            ]),
          }
        : {}),
      ...(b.definition.modelica ? { modelica: b.definition.modelica } : {}),
    })),
    wires: flattenWires(p as Project)
      .map((w) => [w.source, w.sourceHandle, w.target, w.targetHandle])
      .sort((a, b) => JSON.stringify(a).localeCompare(JSON.stringify(b))),
  };
}

export function semanticSignature(p: Project) {
  const { loggedNets, blocks, wires } = sheetSemantics(p);
  const solver = settingsSignature(p.duration, p.simulation);
  return JSON.stringify({
    duration: p.duration,
    ...(solver ? { solver } : {}),
    loggedNets,
    blocks,
    wires,
    ...(p.subsystems?.length
      ? {
          subsystems: p.subsystems.map((s) => ({
            id: s.id,
            parameters: (s.parameters ?? []).map((x) => [
              x.id,
              x.value,
              x.targets,
            ]),
            ...sheetSemantics({ ...s, junctions: s.junctions ?? [] }),
          })),
        }
      : {}),
  });
}
/** Move a label independently of its block and all connected geometry. */
export function setLabelOffset(
  project: Project,
  id: string,
  offset: { x: number; y: number } | undefined,
): Project {
  const block = project.blocks.find((b) => b.id === id);
  if (
    !block ||
    (offset && (!Number.isFinite(offset.x) || !Number.isFinite(offset.y)))
  )
    return project;
  const value =
    offset && (offset.x !== 0 || offset.y !== 0) ? offset : undefined;
  if (
    (block.labelOffset?.x ?? 0) === (value?.x ?? 0) &&
    (block.labelOffset?.y ?? 0) === (value?.y ?? 0)
  )
    return project;
  return {
    ...project,
    blocks: project.blocks.map((b) =>
      b.id === id ? { ...b, labelOffset: value } : b,
    ),
  };
}

export function addWire(p: Project, w: Wire): Project {
  const error = connectionError(
    p,
    { id: w.source, handle: w.sourceHandle },
    { id: w.target, handle: w.targetHandle },
  );
  if (error) throw new Error(error);
  if (
    p.wires.some(
      (x) =>
        (x.source === w.source &&
          x.sourceHandle === w.sourceHandle &&
          x.target === w.target &&
          x.targetHandle === w.targetHandle) ||
        (x.target === w.source &&
          x.targetHandle === w.sourceHandle &&
          x.source === w.target &&
          x.sourceHandle === w.targetHandle),
    )
  )
    return p;
  return { ...p, wires: [...p.wires, w] };
}

/** Orient an output (or physical) toward an input so addWire's roles match. */
export function linkEnds(
  p: Project,
  a: { id: string; handle: string },
  b: { id: string; handle: string },
  waypoints?: { x: number; y: number }[],
): Project {
  p = adoptBoundaryDomain(p, a, b);
  const pa = endpointPort(p, a.id, a.handle, 'source');
  const pb = endpointPort(p, b.id, b.handle, 'target');
  const aIsSink = !isTap(p, a.id) && pa?.direction === 'input';
  const bIsSink = !isTap(p, b.id) && pb?.direction === 'input';
  const from = aIsSink && !bIsSink ? b : a;
  const to = aIsSink && !bIsSink ? a : b;
  return addWire(p, {
    id: crypto.randomUUID(),
    source: from.id,
    sourceHandle: from.handle,
    target: to.id,
    targetHandle: to.handle,
    waypoints: aIsSink && !bIsSink ? waypoints?.slice().reverse() : waypoints,
  });
}
export function removeSelection(
  p: Project,
  ids: string[],
  wireIds: string[] = [],
) {
  return pruneJunctions({
    ...p,
    blocks: p.blocks.filter((b) => !ids.includes(b.id)),
    junctions: (p.junctions ?? []).filter((j) => !ids.includes(j.id)),
    wires: p.wires.filter(
      (w) =>
        !wireIds.includes(w.id) &&
        !ids.includes(w.source) &&
        !ids.includes(w.target),
    ),
  });
}
/** Removing a branch also removes its dangling stub; degree-two junctions become bends. */
/**
 * Junctions only exist where three or more wires meet. A dot left with no wire goes; one
 * with a single wire goes with that dangling stub; one with two becomes a bend in one
 * wire (keeping `preferredWireId` when given). A wire that starts and ends on the same
 * terminal connects nothing and goes too, and two wires that only loop between the same
 * two ends are dropped rather than joined into a loop: every merge then points at ends
 * that still exist. Each pass removes a dot, so this always finishes.
 */
export function pruneJunctions(
  project: Project,
  preferredWireId?: string,
): Project {
  const same = (a: { id: string; handle: string }, b: typeof a) =>
    a.id === b.id && a.handle === b.handle;
  let p = project;
  while (true) {
    const loops = p.wires.filter(
      (w) => w.source === w.target && w.sourceHandle === w.targetHandle,
    );
    if (loops.length)
      p = { ...p, wires: p.wires.filter((w) => !loops.includes(w)) };
    const j = p.junctions?.find(
      (j) =>
        p.wires.filter((w) => w.source === j.id || w.target === j.id).length <
        3,
    );
    if (!j) return p;
    const incident = p.wires.filter(
      (w) => w.source === j.id || w.target === j.id,
    );
    const rest = p.wires.filter((w) => w.source !== j.id && w.target !== j.id);
    if (incident.length === 2) {
      const [a, b] =
        incident[1].id === preferredWireId
          ? [incident[1], incident[0]]
          : incident;
      const from =
        a.source === j.id
          ? { id: a.target, handle: a.targetHandle }
          : { id: a.source, handle: a.sourceHandle };
      const to =
        b.target === j.id
          ? { id: b.source, handle: b.sourceHandle }
          : { id: b.target, handle: b.targetHandle };
      if (!same(from, to)) {
        const pa = [...polylineOfWire(p, a.id)],
          pb = [...polylineOfWire(p, b.id)];
        if (a.source === j.id) pa.reverse();
        if (b.target === j.id) pb.reverse();
        rest.push({
          id: a.id,
          source: from.id,
          sourceHandle: from.handle,
          target: to.id,
          targetHandle: to.handle,
          waypoints: simplifyPoints([...pa, ...pb.slice(1)]).slice(1, -1),
        });
      }
    }
    p = {
      ...p,
      junctions: p.junctions?.filter((x) => x.id !== j.id),
      wires: rest,
    };
  }
}

/**
 * Drop wires that end on nothing: a block or junction no longer in the sheet. Such a
 * wire cannot be drawn, simulated, or saved (the service refuses it), so an older
 * document that has one opens and saves again. Wires ending on a block whose port is
 * gone are kept: validation reports them so the user decides.
 */
export function dropOrphanWires<
  T extends Pick<Project, 'blocks' | 'wires' | 'junctions'>,
>(sheet: T): T {
  const ends = new Set([
    ...sheet.blocks.map((b) => b.id),
    ...(sheet.junctions ?? []).map((j) => j.id),
  ]);
  const wires = sheet.wires.filter(
    (w) => ends.has(w.source) && ends.has(w.target),
  );
  return wires.length === sheet.wires.length ? sheet : { ...sheet, wires };
}

export function replaceDefinition(
  p: Project,
  id: string,
  definition: Definition,
) {
  const next = {
    ...p,
    blocks: p.blocks.map((b) => (b.id === id ? { ...b, definition } : b)),
  };
  return {
    ...next,
    wires: next.wires.filter((w) =>
      compatible(
        portOf(next, w.source, w.sourceHandle),
        portOf(next, w.target, w.targetHandle),
      ),
    ),
  };
}
export type BlockEdits = {
  name?: string;
  parameters?: Record<string, number>;
  equations?: string;
  declarations?: string;
};

/** Apply one dialog session; returns `p` itself when nothing changed. */
export function applyBlockEdits(p: Project, id: string, edits: BlockEdits) {
  const block = p.blocks.find((b) => b.id === id);
  if (!block) return p;
  const d = block.definition;
  const name = edits.name?.trim();
  const nameChanged = !!name && name !== d.name;
  const values = edits.parameters ?? {};
  const parametersChanged = d.parameters.some(
    (x) => x.id in values && values[x.id] !== x.value,
  );
  const equationsChanged =
    edits.equations !== undefined && edits.equations !== d.equations;
  const declarationsChanged =
    edits.declarations !== undefined &&
    edits.declarations !== (d.declarations ?? '');
  if (
    !nameChanged &&
    !parametersChanged &&
    !equationsChanged &&
    !declarationsChanged
  )
    return p;
  const definition: Definition = {
    ...d,
    ...(nameChanged ? { name } : {}),
    ...(parametersChanged
      ? {
          parameters: d.parameters.map((x) =>
            x.id in values ? { ...x, value: values[x.id] } : x,
          ),
        }
      : {}),
    ...(equationsChanged ? { equations: edits.equations } : {}),
    ...(declarationsChanged ? { declarations: edits.declarations } : {}),
  };
  if (equationsChanged || declarationsChanged)
    return replaceDefinition(p, id, definition);
  return {
    ...p,
    blocks: p.blocks.map((b) => (b.id === id ? { ...b, definition } : b)),
  };
}

export function duplicateBlocks(p: Project, ids: string[]) {
  const result = pasteSelection(
    p,
    extractSelection(p, { ...emptySelection(), blockIds: ids }),
  );
  return {
    ...result,
    ids: result.selection.blockIds,
  };
}
