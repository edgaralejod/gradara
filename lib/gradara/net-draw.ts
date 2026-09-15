import { Position } from '@xyflow/react';
import type { Project } from './model';
import { endpointPoint, isTap, netComponents, TAP_HANDLE } from './net';
import { portPoint, sideToPosition } from './ports';
import {
  routeBetween,
  simplifyRoute,
  segmentExit,
  EXIT_STUB,
  rubberBandPoints,
  type Pt,
} from './routing';

export const ANCHOR_PX = 8;
const PORT_HIT_PX = 16;
const SEGMENT_HIT_PX = 10;
export const CANCEL_PX = 16;

export type { Pt };

export function nearly(a: number, b: number, eps = 0.000001) {
  return Math.abs(a - b) <= eps;
}

export function samePt(a: Pt, b: Pt, eps = 0.000001) {
  return nearly(a.x, b.x, eps) && nearly(a.y, b.y, eps);
}

export type Anchor = { axis: 'x' | 'y'; value: number };

function rawPolyline(project: Project, wireId: string): Pt[] {
  const w = project.wires.find((x) => x.id === wireId);
  if (!w) return [];
  const from = endpointPoint(project, w.source, w.sourceHandle);
  const to = endpointPoint(project, w.target, w.targetHandle);
  if (!from || !to) return [];
  return committedPoints(
    project,
    w.source,
    w.sourceHandle,
    w.target,
    w.targetHandle,
    w.waypoints,
  );
}

const routeCache = new WeakMap<Project, Map<string, Pt[]>>();
type Run = { a: Pt; b: Pt; axis: 'h' | 'v'; coord: number };
function overlap(a: Run, b: Run) {
  if (a.axis !== b.axis || !nearly(a.coord, b.coord)) return false;
  const key = a.axis === 'h' ? 'x' : 'y';
  return (
    Math.min(Math.max(a.a[key], a.b[key]), Math.max(b.a[key], b.b[key])) -
      Math.max(Math.min(a.a[key], a.b[key]), Math.min(b.a[key], b.b[key])) >
    0.001
  );
}
/** Displayed geometry is the drawing route: pinned waypoints, or orthogonal auto-route. */
function routedPolylines(project: Project): Map<string, Pt[]> {
  const cached = routeCache.get(project);
  if (cached) return cached;
  const routes = new Map<string, Pt[]>();
  for (const w of project.wires) {
    const from = endpointPoint(project, w.source, w.sourceHandle);
    const to = endpointPoint(project, w.target, w.targetHandle);
    const pts = simplifyRoute(
      rawPolyline(project, w.id),
      from && !isTap(project, w.source) ? sideToPosition(from.side) : undefined,
      to && !isTap(project, w.target) ? sideToPosition(to.side) : undefined,
    );
    routes.set(w.id, pts);
  }
  routeCache.set(project, routes);
  return routes;
}
export function polylineOfWire(project: Project, wireId: string): Pt[] {
  return routedPolylines(project).get(wireId) ?? [];
}

function committedPoints(
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
  const exit = isTap(project, source)
    ? segmentExit(from, vertices[0] ?? to)
    : sideToPosition(from.side);
  const entry = isTap(project, target) ? undefined : sideToPosition(to.side);
  if (vertices.length) {
    const points = routeBetween(from, vertices[0], exit);
    for (const vertex of vertices.slice(1)) {
      const a = points.at(-1)!;
      if (nearly(a.x, vertex.x) || nearly(a.y, vertex.y)) points.push(vertex);
      else points.push({ x: vertex.x, y: a.y }, vertex);
    }
    const last = points.at(-1)!;
    const tailExit = segmentExit(last, to);
    return simplifyRoute(
      [...points, ...routeBetween(last, to, tailExit, entry, 0).slice(1)],
      isTap(project, source) ? undefined : exit,
      entry,
    );
  }
  return routeBetween(from, to, exit, entry);
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
  ignoreEnds: Set<string> = new Set(),
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
      if (ignoreEnds.has(`${b.id}.${p.id}`)) continue;
      const pt = portPoint(b, p.id);
      if (!pt) continue;
      add('x', pt.x);
      add('y', pt.y);
    }
  for (const j of project.junctions ?? []) {
    if (ignoreEnds.has(`j:${j.id}`)) continue;
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
): { wireId: string; point: Pt; dist: number; segment: number } | undefined {
  let best:
    | { wireId: string; point: Pt; dist: number; segment: number }
    | undefined;
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
        best = { wireId: w.id, point, dist, segment: i };
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
  const tail = rubberBandPoints(
    origin,
    cursor,
    exit,
    corners.length ? 0 : EXIT_STUB,
  );
  const head = start ? [start, ...corners] : [...corners];
  const last = head.at(-1);
  const rest = last && tail[0] && samePt(last, tail[0]) ? tail.slice(1) : tail;
  return [...head, ...rest];
}

export function firstSegmentHorizontal(pts: Pt[]) {
  if (pts.length < 2) return false;
  return nearly(pts[0].y, pts[1].y) && !nearly(pts[0].x, pts[1].x);
}

export function overlapsDifferentNet(
  project: Project,
  wireId: string,
): boolean {
  const w = project.wires.find((w) => w.id === wireId);
  if (!w) return false;
  const own =
    netComponents(project).find((keys) =>
      keys.includes(
        isTap(project, w.source)
          ? `j:${w.source}`
          : `${w.source}.${w.sourceHandle}`,
      ),
    ) ?? [];
  const runs = segmentsOf(polylineOfWire(project, wireId));
  return project.wires.some((other) => {
    if (
      other.id === wireId ||
      own.includes(
        isTap(project, other.source)
          ? `j:${other.source}`
          : `${other.source}.${other.sourceHandle}`,
      )
    )
      return false;
    return segmentsOf(polylineOfWire(project, other.id)).some((a) =>
      runs.some((b) => overlap(a, b)),
    );
  });
}
