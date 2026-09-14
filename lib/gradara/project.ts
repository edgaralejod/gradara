import { polylineOfWire } from './net-draw';
import { simplifyPoints } from './routing';
import type { Project, Definition, Wire } from './model';
import { compatible, portOf } from './model';
import { connectionError, endpointPort, flattenWires, isTap } from './net';
import { emptySelection, extractSelection, pasteSelection } from './selection';
export function semanticSignature(p: Project) {
  return JSON.stringify({
    duration: p.duration,
    blocks: p.blocks.map((b) => ({
      id: b.id,
      kind: b.definition.kind,
      generated: !!b.definition.generated,
      ports: b.definition.ports.map((x) => [x.id, x.direction, x.domain]),
      parameters: b.definition.parameters.map((x) => [x.id, x.value]),
      declarations: b.definition.declarations ?? '',
      equations: b.definition.equations,
    })),
    wires: flattenWires(p)
      .map((w) => [w.source, w.sourceHandle, w.target, w.targetHandle])
      .sort((a, b) => JSON.stringify(a).localeCompare(JSON.stringify(b))),
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
export function pruneJunctions(
  project: Project,
  preferredWireId?: string,
): Project {
  let p = project;
  while (true) {
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
      const pa = [...polylineOfWire(p, a.id)],
        pb = [...polylineOfWire(p, b.id)];
      const from =
        a.source === j.id
          ? { id: a.target, handle: a.targetHandle }
          : { id: a.source, handle: a.sourceHandle };
      const to =
        b.target === j.id
          ? { id: b.source, handle: b.sourceHandle }
          : { id: b.target, handle: b.targetHandle };
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
    p = {
      ...p,
      junctions: p.junctions?.filter((x) => x.id !== j.id),
      wires: rest,
    };
  }
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
