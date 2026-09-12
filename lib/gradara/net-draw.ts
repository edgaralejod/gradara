import { Position } from '@xyflow/react';
import { blockSize } from './canvas';
import type { Project } from './model';
import { endpointPoint, isTap, TAP_HANDLE } from './net';
import { portPoint } from './ports';
import {
  EXIT_STUB,
  RETURN_CLEARANCE,
  RETURN_STUB,
  STRAIGHT_EPS,
  pinRubberBand,
  pointsToPath,
  rubberBandPoints,
  type Pt,
} from './routing';
import { sideToPosition } from './wires';

export const ANCHOR_PX = 8;
export const PORT_HIT_PX = 16;
export const SEGMENT_HIT_PX = 10;
export const CANCEL_PX = 16;

export { pinRubberBand, rubberBandPoints, pointsToPath };
export type { Pt };

export function nearly(a: number, b: number, eps = STRAIGHT_EPS) {
  return Math.abs(a - b) <= eps;
}

export function samePt(a: Pt, b: Pt, eps = STRAIGHT_EPS) {
  return nearly(a.x, b.x, eps) && nearly(a.y, b.y, eps);
}

export type Anchor = { axis: 'x' | 'y'; value: number; net?: string };

export function polylineOfWire(project: Project, wireId: string): Pt[] {
  const w = project.wires.find((x) => x.id === wireId);
  if (!w) return [];
  const from = endpointPoint(project, w.source, w.sourceHandle);
  const to = endpointPoint(project, w.target, w.targetHandle);
  if (!from || !to) return [];
  if (w.waypoints?.length) return [from, ...w.waypoints, to];
  return committedPoints(project, w.source, w.sourceHandle, w.target, w.targetHandle);
}

export function committedPoints(
  project: Project,
  source: string,
  sourceHandle: string,
  target: string,
  targetHandle: string,
  vertices: Pt[] = [],
): Pt[] {
  const from = endpointPoint(project, source, sourceHandle);
  const to = endpointPoint(project, target, targetHandle);
  if (!from || !to) return [];
  if (vertices.length) return [from, ...vertices, to];
  const sourceBlock = project.blocks.find((b) => b.id === source);
  const targetBlock = project.blocks.find((b) => b.id === target);
  const physical =
    !isTap(project, source) &&
    sourceBlock?.definition.ports.find((p) => p.id === sourceHandle)
      ?.direction === 'physical';
  if (
    !physical &&
    sourceBlock &&
    targetBlock &&
    isBackEdge(project, source, target)
  )
    return loopPoints(from, to, loopRailY(project, source, target));
  return rubberBandPoints(from, to, sideToPosition(from.side));
}

export function isBackEdge(project: Project, fromId: string, toId: string) {
  if (isTap(project, fromId) || isTap(project, toId)) return false;
  const from = project.blocks.find((b) => b.id === fromId);
  const to = project.blocks.find((b) => b.id === toId);
  if (!from || !to) return false;
  if (to.position.x + blockSize(to).width < from.position.x) return true;
  return feeds(project, toId, fromId);
}

function feeds(project: Project, fromBlock: string, toBlock: string) {
  const seen = new Set<string>();
  const stack = [fromBlock];
  while (stack.length) {
    const id = stack.pop()!;
    if (id === toBlock) return true;
    if (seen.has(id)) continue;
    seen.add(id);
    for (const w of project.wires) {
      if (isTap(project, w.source) || isTap(project, w.target)) {
        if (w.source === id && !isTap(project, w.target)) stack.push(w.target);
        continue;
      }
      if (w.source === id) stack.push(w.target);
    }
  }
  return false;
}

export function loopRailY(
  project: Project,
  fromId: string,
  toId: string,
) {
  const from = project.blocks.find((b) => b.id === fromId);
  const to = project.blocks.find((b) => b.id === toId);
  let bottom = 0;
  const left = Math.min(from?.position.x ?? 0, to?.position.x ?? 0);
  const right = Math.max(
    (from?.position.x ?? 0) + (from ? blockSize(from).width : 0),
    (to?.position.x ?? 0) + (to ? blockSize(to).width : 0),
  );
  for (const b of project.blocks) {
    const box = blockSize(b);
    const mid = b.position.x + box.width / 2;
    if (
      b.id === fromId ||
      b.id === toId ||
      (mid >= left - 8 && mid <= right + 8)
    )
      bottom = Math.max(bottom, b.position.y + box.height);
  }
  return bottom + RETURN_CLEARANCE;
}

export function loopPoints(from: Pt, to: Pt, railY: number): Pt[] {
  const stub = RETURN_STUB;
  const leaveX = from.x + stub;
  return [
    from,
    { x: leaveX, y: from.y },
    { x: leaveX, y: railY },
    { x: to.x, y: railY },
    to,
  ];
}

export function segmentsOf(pts: Pt[]) {
  const segs: { a: Pt; b: Pt; axis: 'h' | 'v'; coord: number }[] = [];
  for (let i = 0; i < pts.length - 1; i++) {
    const a = pts[i],
      b = pts[i + 1];
    if (nearly(a.y, b.y) && !nearly(a.x, b.x))
      segs.push({ a, b, axis: 'h', coord: a.y });
    else if (nearly(a.x, b.x) && !nearly(a.y, b.y))
      segs.push({ a, b, axis: 'v', coord: a.x });
  }
  return segs;
}

export function collectAnchors(
  project: Project,
  ignoreWireIds: string[] = [],
): Anchor[] {
  const anchors: Anchor[] = [];
  const seen = new Set<string>();
  const add = (axis: 'x' | 'y', value: number) => {
    const k = `${axis}:${Math.round(value)}`;
    if (seen.has(k)) return;
    seen.add(k);
    anchors.push({ axis, value });
  };
  for (const b of project.blocks)
    for (const p of b.definition.ports) {
      const pt = portPoint(b, p.id);
      if (!pt) continue;
      add('x', pt.x);
      add('y', pt.y);
    }
  for (const j of project.junctions ?? []) {
    add('x', j.position.x);
    add('y', j.position.y);
  }
  for (const w of project.wires) {
    if (ignoreWireIds.includes(w.id)) continue;
    for (const s of segmentsOf(polylineOfWire(project, w.id))) {
      if (s.axis === 'h') add('y', s.coord);
      else add('x', s.coord);
    }
  }
  return anchors;
}

export function snapToAnchors(
  cursor: Pt,
  anchors: Anchor[],
  px = ANCHOR_PX,
): { point: Pt; guides: Anchor[] } {
  let x = cursor.x,
    y = cursor.y;
  const guides: Anchor[] = [];
  let bestX = px + 1,
    bestY = px + 1;
  for (const a of anchors) {
    if (a.axis === 'x') {
      const d = Math.abs(cursor.x - a.value);
      if (d < bestX) {
        bestX = d;
        x = a.value;
      }
    } else {
      const d = Math.abs(cursor.y - a.value);
      if (d < bestY) {
        bestY = d;
        y = a.value;
      }
    }
  }
  if (bestX <= px) guides.push({ axis: 'x', value: x });
  else x = cursor.x;
  if (bestY <= px) guides.push({ axis: 'y', value: y });
  else y = cursor.y;
  return { point: { x, y }, guides };
}

export function hitPort(
  project: Project,
  at: Pt,
  max = PORT_HIT_PX,
): { id: string; handle: string; dist: number } | undefined {
  let best: { id: string; handle: string; dist: number } | undefined;
  for (const b of project.blocks)
    for (const p of b.definition.ports) {
      const pt = portPoint(b, p.id);
      if (!pt) continue;
      const dist = Math.hypot(pt.x - at.x, pt.y - at.y);
      if (dist <= max && (!best || dist < best.dist))
        best = { id: b.id, handle: p.id, dist };
    }
  for (const j of project.junctions ?? []) {
    const dist = Math.hypot(j.position.x - at.x, j.position.y - at.y);
    if (dist <= max && (!best || dist < best.dist))
      best = { id: j.id, handle: TAP_HANDLE, dist };
  }
  return best;
}

export function hitSegment(
  project: Project,
  at: Pt,
  max = SEGMENT_HIT_PX,
  ignoreWireIds: string[] = [],
): { wireId: string; point: Pt; dist: number } | undefined {
  let best: { wireId: string; point: Pt; dist: number } | undefined;
  for (const w of project.wires) {
    if (ignoreWireIds.includes(w.id)) continue;
    const pts = polylineOfWire(project, w.id);
    for (let i = 0; i < pts.length - 1; i++) {
      const a = pts[i],
        b = pts[i + 1];
      const dx = b.x - a.x,
        dy = b.y - a.y;
      const len2 = dx * dx + dy * dy || 1;
      const t = Math.max(
        0,
        Math.min(1, ((at.x - a.x) * dx + (at.y - a.y) * dy) / len2),
      );
      const point = { x: a.x + t * dx, y: a.y + t * dy };
      const dist = Math.hypot(at.x - point.x, at.y - point.y);
      if (dist <= max && (!best || dist < best.dist))
        best = { wireId: w.id, point, dist };
    }
  }
  return best;
}

export function livePath(
  origin: Pt,
  cursor: Pt,
  exit: Position,
  corners: Pt[],
  start?: Pt,
): Pt[] {
  const tail = rubberBandPoints(origin, cursor, exit);
  const head = start ? [start, ...corners] : [...corners];
  const last = head.at(-1);
  const rest =
    last && tail[0] && samePt(last, tail[0]) ? tail.slice(1) : tail;
  return [...head, ...rest];
}

export function firstSegmentHorizontal(pts: Pt[]) {
  if (pts.length < 2) return false;
  return nearly(pts[0].y, pts[1].y) && !nearly(pts[0].x, pts[1].x);
}

export { EXIT_STUB };
