import type { Project, Block, Definition, Wire } from './model';
import { compatible, portOf } from './model';
import {
  endpointPort,
  endpointsCompatible,
  flattenWires,
  isTap,
} from './net';
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
      .sort(),
  });
}
export function addWire(p: Project, w: Wire): Project {
  if (!endpointsCompatible(p, w.source, w.sourceHandle, w.target, w.targetHandle))
    throw new Error(
      'Connect ports in the same domain. Signals need an output and an input.',
    );
  const a = endpointPort(p, w.source, w.sourceHandle, 'source');
  const b = endpointPort(p, w.target, w.targetHandle, 'target');
  const input =
    !isTap(p, w.source) && a?.direction === 'input'
      ? { block: w.source, port: w.sourceHandle }
      : !isTap(p, w.target) && b?.direction === 'input'
        ? { block: w.target, port: w.targetHandle }
        : null;
  if (
    input &&
    flattenWires(p).some(
      (x) =>
        (x.target === input.block && x.targetHandle === input.port) ||
        (x.source === input.block && x.sourceHandle === input.port),
    )
  )
    throw new Error(
      'This input already has a source. Remove its existing wire first.',
    );
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
    waypoints,
  });
}
export function removeSelection(
  p: Project,
  ids: string[],
  wireIds: string[] = [],
) {
  return {
    ...p,
    blocks: p.blocks.filter((b) => !ids.includes(b.id)),
    junctions: (p.junctions ?? []).filter((j) => !ids.includes(j.id)),
    wires: p.wires.filter(
      (w) =>
        !wireIds.includes(w.id) &&
        !ids.includes(w.source) &&
        !ids.includes(w.target),
    ),
  };
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
  const remap = new Map(
    ids.map((id) => [
      id,
      `b_${crypto.randomUUID().replaceAll('-', '').slice(0, 12)}`,
    ]),
  );
  const blocks = p.blocks
    .filter((b) => ids.includes(b.id))
    .map((b) => ({
      ...structuredClone(b),
      id: remap.get(b.id)!,
      position: { x: b.position.x + 35, y: b.position.y + 45 },
    }));
  const wires = p.wires
    .filter((w) => ids.includes(w.source) && ids.includes(w.target))
    .map((w) => ({
      ...w,
      id: crypto.randomUUID(),
      source: remap.get(w.source)!,
      target: remap.get(w.target)!,
      junctions: w.junctions?.map((p) => ({ x: p.x + 35, y: p.y + 45 })),
      waypoints: w.waypoints?.map((p) => ({ x: p.x + 35, y: p.y + 45 })),
    }));
  return {
    project: {
      ...p,
      blocks: [...p.blocks, ...blocks],
      wires: [...p.wires, ...wires],
    },
    ids: blocks.map((b) => b.id),
  };
}
