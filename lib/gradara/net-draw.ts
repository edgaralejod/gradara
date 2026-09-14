import { Position } from '@xyflow/react';
import { blockSize } from './canvas';
import type { Project } from './model';
import {
  endpointPoint,
  isTap,
  netComponents,
  netKeys,
  TAP_HANDLE,
} from './net';
import { portPoint } from './ports';
import {
  routeBetween,
  simplifyPoints,
  simplifyRoute,
  segmentExit,
  outward,
  EXIT_STUB,
  RETURN_CLEARANCE,
  RETURN_STUB,
  pinRubberBand,
  pointsToPath,
  rubberBandPoints,
  type Pt,
} from './routing';
import { sideToPosition } from './ports';

export const ANCHOR_PX = 8;
export const PORT_HIT_PX = 16;
export const SEGMENT_HIT_PX = 10;
export const CANCEL_PX = 16;

export { pinRubberBand, rubberBandPoints, pointsToPath };
export type { Pt };

export function nearly(a: number, b: number, eps = 0.000001) {
  return Math.abs(a - b) <= eps;
}

export function samePt(a: Pt, b: Pt, eps = 0.000001) {
  return nearly(a.x, b.x, eps) && nearly(a.y, b.y, eps);
}

export type Anchor = { axis: 'x' | 'y'; value: number; net?: string };

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
type Run = { a: Pt; b: Pt; axis: 'h' | 'v'; coord: number; net: number };
function overlap(a: Run, b: Run) {
  if (a.axis !== b.axis || !nearly(a.coord, b.coord)) return false;
  const key = a.axis === 'h' ? 'x' : 'y';
  return (
    Math.min(Math.max(a.a[key], a.b[key]), Math.max(b.a[key], b.b[key])) -
      Math.max(Math.min(a.a[key], a.b[key]), Math.min(b.a[key], b.b[key])) >
    0.001
  );
}
/** Deterministic lane allocation for automatic runs; pinned routes are never rerouted. */
export function routedPolylines(project: Project): Map<string, Pt[]> {
  const cached = routeCache.get(project);
  if (cached) return cached;
  const nets = new Map<string, number>();
  netComponents(project).forEach((keys, i) =>
    keys.forEach((k) => nets.set(k, i)),
  );
  const runs: Run[] = [];
  const routes = new Map<string, Pt[]>();
  for (const w of project.wires) {
    const key = isTap(project, w.source)
      ? `j:${w.source}`
      : `${w.source}.${w.sourceHandle}`;
    const net = nets.get(key) ?? -1;
    let pts = rawPolyline(project, w.id).map(({ x, y }) => ({ x, y }));
    if (!w.waypoints) {
      const next: Pt[] = [];
      for (let i = 0; i < pts.length - 1; i++) {
        const a = pts[i],
          b = pts[i + 1];
        const axis = a.y === b.y ? 'h' : 'v';
        const run: Run = { a, b, axis, coord: axis === 'h' ? a.y : a.x, net };
        next.push(a);
        if (!runs.some((r) => r.net !== net && overlap(run, r))) continue;
        let offset = 8;
        while (
          offset < 160 &&
          runs.some(
            (r) =>
              r.net !== net &&
              overlap({ ...run, coord: run.coord + offset }, r),
          )
        )
          offset += 8;
        const shift = (p: Pt) =>
          axis === 'h'
            ? { x: p.x, y: p.y + offset }
            : { x: p.x + offset, y: p.y };
        // Leave endpoint normals intact, shifting only the usable middle of an endpoint run.
        const start =
          i === 0
            ? outward(
                a,
                segmentExit(a, b),
                Math.min(20, Math.hypot(a.x - b.x, a.y - b.y) / 3),
              )
            : a;
        const end =
          i === pts.length - 2
            ? outward(
                b,
                segmentExit(b, a),
                Math.min(20, Math.hypot(a.x - b.x, a.y - b.y) / 3),
              )
            : b;
        next.push(start, shift(start), shift(end), end);
      }
      if (pts.length) next.push(pts.at(-1)!);
      pts = simplifyPoints(next);
    }
    // Automatic lanes and pinned paths must expose the same canonical geometry.
    // Otherwise freezing a route for a group move removes old lane spurs only
    // after release, making a rigid selection appear to change shape.
    const from = endpointPoint(project, w.source, w.sourceHandle);
    const to = endpointPoint(project, w.target, w.targetHandle);
    pts = simplifyRoute(
      pts,
      from && !isTap(project, w.source) ? sideToPosition(from.side) : undefined,
      to && !isTap(project, w.target) ? sideToPosition(to.side) : undefined,
    );
    routes.set(w.id, pts);
    runs.push(...segmentsOf(pts).map((r) => ({ ...r, net })));
  }
  routeCache.set(project, routes);
  return routes;
}
export function polylineOfWire(project: Project, wireId: string): Pt[] {
  return routedPolylines(project).get(wireId) ?? [];
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
  const driverKeys = isTap(project, source)
    ? netKeys(project, { id: source, handle: sourceHandle })
    : undefined;
  const sourceBlock =
    project.blocks.find((b) => b.id === source) ??
    project.blocks.find((b) =>
      b.definition.ports.some(
        (p) => p.direction === 'output' && driverKeys?.has(`${b.id}.${p.id}`),
      ),
    );
  const targetBlock = project.blocks.find((b) => b.id === target);
  const physical =
    (!isTap(project, source) &&
      sourceBlock?.definition.ports.find((p) => p.id === sourceHandle)
        ?.direction === 'physical') ||
    (isTap(project, source) &&
      project.junctions?.find((j) => j.id === source)?.domain !== 'signal');
  if (
    !physical &&
    sourceBlock &&
    targetBlock &&
    isBackEdge(project, sourceBlock.id, targetBlock.id)
  )
    return loopPoints(
      from,
      to,
      loopRailY(project, sourceBlock.id, targetBlock.id),
      exit,
      entry,
    );
  return routeBetween(from, to, exit, entry);
}

export function isBackEdge(project: Project, fromId: string, toId: string) {
  if (isTap(project, fromId) || isTap(project, toId)) return false;
  const from = project.blocks.find((b) => b.id === fromId);
  const to = project.blocks.find((b) => b.id === toId);
  if (!from || !to) return false;
  if (to.position.x + blockSize(to).width < from.position.x) return true;
  return to.position.x < from.position.x && feeds(project, toId, fromId);
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
      if (w.source === id) stack.push(w.target);
    }
  }
  return false;
}

export function loopRailY(project: Project, fromId: string, toId: string) {
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

export function loopPoints(
  from: Pt,
  to: Pt,
  railY: number,
  exit = Position.Right,
  entry = Position.Bottom,
): Pt[] {
  const a = outward(from, exit, RETURN_STUB),
    b = outward(to, entry, RETURN_STUB);
  return simplifyPoints([
    from,
    a,
    { x: a.x, y: railY },
    { x: b.x, y: railY },
    b,
    to,
  ]);
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

export { EXIT_STUB };

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
      runs.some((b) => overlap({ ...a, net: 0 }, { ...b, net: 1 })),
    );
  });
}
