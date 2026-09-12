import { Position } from '@xyflow/react';
import type { Project, Wire } from './model';
import { portOf } from './model';
import { portPoint, type Side } from './ports';
import { linkEnds } from './project';
import {
  endpointPoint,
  endpointPort,
  isTap,
  netBlocks,
  occupiedInputs,
  onNet,
  splitAt,
  TAP_HANDLE,
} from './net';
import { feedbackRailY, isReturnPath, wirePath } from './routing';

export type Pt = { x: number; y: number };

export function sideToPosition(side: Side): Position {
  if (side === 'left') return Position.Left;
  if (side === 'right') return Position.Right;
  if (side === 'top') return Position.Top;
  return Position.Bottom;
}

export function parsePath(d: string): Pt[] {
  const pts: Pt[] = [];
  const re = /[ML]\s*(-?[0-9]*\.?[0-9]+)\s+(-?[0-9]*\.?[0-9]+)/gi;
  for (const match of d.matchAll(re))
    pts.push({ x: Number(match[1]), y: Number(match[2]) });
  return pts;
}

export function wirePolyline(project: Project, wire: Wire): Pt[] {
  const from = isTap(project, wire.source)
    ? endpointPoint(project, wire.source, wire.sourceHandle)
    : (() => {
        const block = project.blocks.find((b) => b.id === wire.source);
        return block ? portPoint(block, wire.sourceHandle) : undefined;
      })();
  const to = isTap(project, wire.target)
    ? endpointPoint(project, wire.target, wire.targetHandle)
    : (() => {
        const block = project.blocks.find((b) => b.id === wire.target);
        return block ? portPoint(block, wire.targetHandle) : undefined;
      })();
  if (!from || !to) return wire.waypoints ? [...wire.waypoints] : [];
  if (wire.waypoints?.length) return [from, ...wire.waypoints, to];
  const physical =
    !isTap(project, wire.source) &&
    project.blocks
      .find((b) => b.id === wire.source)
      ?.definition.ports.find((p) => p.id === wire.sourceHandle)
      ?.direction === 'physical';
  const sourceBlock = project.blocks.find((b) => b.id === wire.source);
  const targetBlock = project.blocks.find((b) => b.id === wire.target);
  const path = wirePath({
    sourceX: from.x,
    sourceY: from.y,
    targetX: to.x,
    targetY: to.y,
    sourcePosition: sideToPosition(from.side),
    targetPosition: sideToPosition(to.side),
    flow: physical ? 'physical' : 'signal',
    railY:
      !physical &&
      isReturnPath({ sourceX: from.x, targetX: to.x }) &&
      sourceBlock &&
      targetBlock
        ? feedbackRailY(sourceBlock, targetBlock)
        : undefined,
  });
  return parsePath(path);
}

export function nearestOnPolyline(pts: Pt[], p: Pt) {
  let best = {
    point: pts[0] ?? p,
    index: 0,
    t: 0,
    dist: Number.POSITIVE_INFINITY,
  };
  for (let i = 0; i < pts.length - 1; i++) {
    const a = pts[i],
      b = pts[i + 1];
    const dx = b.x - a.x,
      dy = b.y - a.y;
    const len2 = dx * dx + dy * dy || 1;
    const t = Math.max(
      0,
      Math.min(1, ((p.x - a.x) * dx + (p.y - a.y) * dy) / len2),
    );
    const point = { x: a.x + t * dx, y: a.y + t * dy };
    const dist = Math.hypot(p.x - point.x, p.y - point.y);
    if (dist < best.dist) best = { point, index: i, t, dist };
  }
  return best;
}

export function insertVertex(pts: Pt[], p: Pt): Pt[] {
  if (pts.length < 2) return pts;
  const hit = nearestOnPolyline(pts, p);
  if (hit.t < 0.08 || hit.t > 0.92) return pts;
  const next = pts.slice();
  next.splice(hit.index + 1, 0, hit.point);
  return next;
}

export function setWireWaypoints(project: Project, id: string, waypoints: Pt[]) {
  return {
    ...project,
    wires: project.wires.map((w) =>
      w.id === id ? { ...w, waypoints } : w,
    ),
  };
}

export function resetWireRoute(project: Project, id: string): Project {
  return {
    ...project,
    wires: project.wires.map((w) =>
      w.id === id ? { ...w, waypoints: undefined } : w,
    ),
  };
}

export function insertVertexOnWire(
  project: Project,
  id: string,
  p: Pt,
): Project {
  const wire = project.wires.find((w) => w.id === id);
  if (!wire) return project;
  const pts = insertVertex(wirePolyline(project, wire), p);
  return setWireWaypoints(project, id, pts.slice(1, -1));
}

export function branchFromWire(
  project: Project,
  wireId: string,
  at: Pt,
  target: { blockId: string; portId: string },
): Project {
  const wire = project.wires.find((w) => w.id === wireId);
  if (!wire) return project;
  const pts = wirePolyline(project, wire);
  const node = nearestOnPolyline(pts, at).point;
  const domain =
    project.blocks.find((b) => b.id === wire.source)?.definition.ports.find(
      (p) => p.id === wire.sourceHandle,
    )?.domain ??
    project.junctions?.find((j) => j.id === wire.source)?.domain ??
    'signal';
  const split = splitAt(project, wireId, node, domain);
  if (!split) return project;
  return linkEnds(
    split.project,
    { id: split.tapId, handle: TAP_HANDLE },
    { id: target.blockId, handle: target.portId },
  );
}

const WIRE_HIT = 10;
const TAP_HIT = 16;
const PORT_HIT = 18;

export function hitTestTap(project: Project, at: Pt, max = TAP_HIT) {
  let best: { id: string; dist: number } | undefined;
  for (const j of project.junctions ?? []) {
    const dist = Math.hypot(j.position.x - at.x, j.position.y - at.y);
    if (dist <= max && (!best || dist < best.dist)) best = { id: j.id, dist };
  }
  return best;
}

export function hitTestWire(project: Project, at: Pt, max = WIRE_HIT) {
  let best: { id: string; point: Pt; dist: number } | undefined;
  for (const w of project.wires) {
    const pts = wirePolyline(project, w);
    if (pts.length < 2) continue;
    const hit = nearestOnPolyline(pts, at);
    if (hit.dist <= max && (!best || hit.dist < best.dist))
      best = { id: w.id, point: hit.point, dist: hit.dist };
  }
  return best;
}

function domainOf(
  project: Project,
  id: string,
  handle: string,
): string | undefined {
  return (
    endpointPort(project, id, handle, 'source')?.domain ??
    endpointPort(project, id, handle, 'target')?.domain
  );
}

function freePortsOnNet(
  project: Project,
  seed: { id: string; handle: string },
  from: { id: string; handle: string },
  at: Pt,
) {
  const fromPort = endpointPort(project, from.id, from.handle, 'source');
  if (!fromPort) return [];
  const taken = occupiedInputs(project);
  const blocks = netBlocks(project, seed);
  const hits: { id: string; handle: string; dist: number }[] = [];
  for (const block of project.blocks) {
    if (!blocks.has(block.id) && !blocks.has(from.id)) continue;
    if (!blocks.has(block.id)) continue;
    for (const port of block.definition.ports) {
      if (port.domain !== fromPort.domain) continue;
      if (port.direction === 'physical') continue;
      const wantInput = fromPort.direction === 'output';
      if (wantInput && port.direction !== 'input') continue;
      if (!wantInput && port.direction !== 'output') continue;
      if (wantInput && taken.has(`${block.id}.${port.id}`)) continue;
      if (block.id === from.id && port.id === from.handle) continue;
      const pt = portPoint(block, port.id);
      if (!pt) continue;
      hits.push({
        id: block.id,
        handle: port.id,
        dist: Math.hypot(pt.x - at.x, pt.y - at.y),
      });
    }
  }
  return hits.sort((a, b) => a.dist - b.dist);
}

export function nearestFreePort(
  project: Project,
  from: { id: string; handle: string },
  at: Pt,
  max = PORT_HIT,
) {
  const fromPort = endpointPort(project, from.id, from.handle, 'source');
  if (!fromPort) return undefined;
  const taken = occupiedInputs(project);
  let best: { id: string; handle: string; dist: number } | undefined;
  for (const block of project.blocks) {
    for (const port of block.definition.ports) {
      if (port.domain !== fromPort.domain) continue;
      if (block.id === from.id && port.id === from.handle) continue;
      const wantInput = fromPort.direction !== 'input';
      if (fromPort.direction !== 'physical') {
        if (wantInput && port.direction !== 'input') continue;
        if (!wantInput && port.direction !== 'output') continue;
      }
      if (port.direction === 'input' && taken.has(`${block.id}.${port.id}`))
        continue;
      const pt = portPoint(block, port.id);
      if (!pt) continue;
      const dist = Math.hypot(pt.x - at.x, pt.y - at.y);
      if (dist <= max && (!best || dist < best.dist))
        best = { id: block.id, handle: port.id, dist };
    }
  }
  return best;
}

/** Drop a connection onto a node, a wire, or a nearby free port. Null = keep drawing. */
export function attachAt(
  project: Project,
  from: { id: string; handle: string },
  at: Pt,
): Project | null {
  const fromPort = endpointPort(project, from.id, from.handle, 'source');
  if (!fromPort) return null;
  const fromTap = isTap(project, from.id);
  const tap = hitTestTap(project, at);
  if (tap && !onNet(project, from, { id: tap.id, handle: TAP_HANDLE })) {
    if (fromTap || fromPort.direction === 'input')
      return linkEnds(project, from, { id: tap.id, handle: TAP_HANDLE });
    const frees = freePortsOnNet(
      project,
      { id: tap.id, handle: TAP_HANDLE },
      from,
      at,
    );
    if (fromPort.direction === 'output' && frees[0])
      return linkEnds(project, from, {
        id: frees[0].id,
        handle: frees[0].handle,
      });
    return linkEnds(project, from, { id: tap.id, handle: TAP_HANDLE });
  }
  const wire = hitTestWire(project, at);
  if (
    wire &&
    !onNet(project, from, {
      id: project.wires.find((x) => x.id === wire.id)!.source,
      handle: project.wires.find((x) => x.id === wire.id)!.sourceHandle,
    })
  ) {
    const w = project.wires.find((x) => x.id === wire.id)!;
    if (fromTap || fromPort.direction === 'input') {
      const domain =
        domainOf(project, w.source, w.sourceHandle) ?? fromPort.domain;
      const split = splitAt(
        project,
        wire.id,
        wire.point,
        domain as typeof fromPort.domain,
      );
      if (!split) return null;
      return linkEnds(split.project, from, {
        id: split.tapId,
        handle: TAP_HANDLE,
      });
    }
    const frees = freePortsOnNet(
      project,
      { id: w.source, handle: w.sourceHandle },
      from,
      at,
    );
    if (frees[0])
      return linkEnds(project, from, {
        id: frees[0].id,
        handle: frees[0].handle,
      });
    throw new Error(
      'This net already has a source. Drop on a free input (the other side of a sum).',
    );
  }
  const port = nearestFreePort(project, from, at, PORT_HIT);
  if (port && !onNet(project, from, { id: port.id, handle: port.handle }))
    return linkEnds(project, from, { id: port.id, handle: port.handle });
  return null;
}
