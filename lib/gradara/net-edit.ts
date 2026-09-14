import type { Project } from './model';
import { endpointPoint, isTap, netKeys } from './net';
import {
  collectAnchors,
  polylineOfWire,
  snapToAnchors,
  type Anchor,
} from './net-draw';
import { sideToPosition } from './ports';
import { outward, simplifyPoints, simplifyRoute, type Pt } from './routing';
import { setWireWaypoints } from './wires';
import {
  junctionsOnRun,
  moveJunctions,
  normalizeJunctions,
} from './net-layout';

/** A screen-space capture radius; snapping never rounds the actual port coordinates. */
export const STRAIGHTEN_PX = 8;
type Axis = 'x' | 'y';
const lengthOf = (points: Pt[]) =>
  points
    .slice(1)
    .reduce(
      (total, p, i) =>
        total + Math.abs(p.x - points[i].x) + Math.abs(p.y - points[i].y),
      0,
    );

/** Remove collinear hairpins as well as extra vertices, without losing an endpoint's escape. */
function compactWire(project: Project, wireId: string) {
  const w = project.wires.find((w) => w.id === wireId)!;
  const side = (id: string, handle: string) =>
    isTap(project, id)
      ? undefined
      : sideToPosition(endpointPoint(project, id, handle)!.side);
  const points = simplifyRoute(
    polylineOfWire(project, wireId),
    side(w.source, w.sourceHandle),
    side(w.target, w.targetHandle),
  );
  return normalizeJunctions(
    setWireWaypoints(project, wireId, points.slice(1, -1)),
  );
}

/** Coalesce nearby parallel runs on this path. Fixed ports/junctions never move. */
function alignRuns(
  project: Project,
  wireId: string,
  axis: Axis,
  value: number,
  tolerance: number,
) {
  const points = polylineOfWire(project, wireId),
    next = points.map((p) => ({ ...p }));
  for (let i = 0; i < points.length - 1; i++) {
    if (
      points[i][axis] !== points[i + 1][axis] ||
      Math.abs(points[i][axis] - value) > tolerance
    )
      continue;
    if (
      (i === 0 && points[0][axis] !== value) ||
      (i === points.length - 2 && points.at(-1)![axis] !== value)
    )
      continue;
    next[i][axis] = value;
    next[i + 1][axis] = value;
  }
  const candidate = setWireWaypoints(project, wireId, next.slice(1, -1));
  // The renderer restores endpoint approaches before any redundant geometry is removed.
  return compactWire(candidate, wireId);
}

function segmentAnchors(points: Pt[], index: number, axis: Axis): Anchor[] {
  const values = new Set([points[0][axis], points.at(-1)![axis]]);
  for (let i = 0; i < points.length - 1; i++) {
    if (i !== index && points[i][axis] === points[i + 1][axis])
      values.add(points[i][axis]);
  }
  return [...values].map((value) => ({ axis, value }));
}

/** Move a run and its junctions perpendicular to itself; fixed block ports grow doglegs. */
export function slideSegment(
  project: Project,
  wireId: string,
  index: number,
  delta: number,
): Project {
  const wire = project.wires.find((w) => w.id === wireId);
  if (!wire || Math.abs(delta) < 1e-7) return project;
  const pts = polylineOfWire(project, wireId);
  const a = pts[index],
    b = pts[index + 1];
  if (!a || !b) return project;
  const horizontal = a.y === b.y;
  const shift = (p: Pt): Pt =>
    horizontal ? { x: p.x, y: p.y + delta } : { x: p.x + delta, y: p.y };
  const start = index === 0;
  const end = index === pts.length - 2;
  const from = endpointPoint(project, wire.source, wire.sourceHandle)!;
  const to = endpointPoint(project, wire.target, wire.targetHandle)!;
  const stub = Math.min(20, Math.hypot(b.x - a.x, b.y - a.y) / 3);
  const startStub = isTap(project, wire.source)
    ? a
    : outward(a, sideToPosition(from.side), stub);
  const endStub = isTap(project, wire.target)
    ? b
    : outward(b, sideToPosition(to.side), stub);
  const positions = new Map(
    junctionsOnRun(project, wireId, index).map((id) => {
      const junction = project.junctions!.find((j) => j.id === id)!;
      return [id, shift(junction.position)];
    }),
  );
  const draft = moveJunctions(project, positions);
  const moved = simplifyPoints([
    ...pts.slice(0, index),
    ...(start && !isTap(project, wire.source)
      ? [a, startStub, shift(startStub)]
      : [shift(a)]),
    ...(end && !isTap(project, wire.target)
      ? [shift(endStub), endStub, b]
      : [shift(b)]),
    ...pts.slice(index + 2),
  ]);
  return compactWire(
    setWireWaypoints(draft, wireId, moved.slice(1, -1)),
    wireId,
  );
}

/** Copy cached geometry before editing: mutating cached polylines corrupted cancel/undo. */
export function moveVertex(
  project: Project,
  wireId: string,
  index: number,
  point: Pt,
): Project {
  const points = polylineOfWire(project, wireId).map((p) => ({ ...p }));
  const old = points[index];
  if (!old || index === 0 || index === points.length - 1) return project;
  const positions = new Map<string, Pt>();
  for (const segment of [index - 1, index]) {
    if (segment !== 0 && segment !== points.length - 2) continue;
    const axis = points[segment].y === points[segment + 1].y ? 'y' : 'x';
    for (const id of junctionsOnRun(project, wireId, segment)) {
      const position =
        positions.get(id) ??
        project.junctions!.find((j) => j.id === id)!.position;
      positions.set(id, {
        ...position,
        [axis]: position[axis] + point[axis] - old[axis],
      });
    }
  }
  const draft = moveJunctions(project, positions);
  const wire = project.wires.find((w) => w.id === wireId)!;
  if (positions.has(wire.source)) points[0] = positions.get(wire.source)!;
  if (positions.has(wire.target))
    points[points.length - 1] = positions.get(wire.target)!;
  if (index > 1)
    points[index - 1] =
      points[index - 1].y === old.y
        ? { ...points[index - 1], y: point.y }
        : { ...points[index - 1], x: point.x };
  if (index < points.length - 2)
    points[index + 1] =
      points[index + 1].y === old.y
        ? { ...points[index + 1], y: point.y }
        : { ...points[index + 1], x: point.x };
  points[index] = point;
  return compactWire(
    setWireWaypoints(draft, wireId, simplifyPoints(points).slice(1, -1)),
    wireId,
  );
}

export function editingAnchors(project: Project, wireId: string) {
  const wire = project.wires.find((w) => w.id === wireId);
  if (!wire) return [];
  const own = netKeys(project, { id: wire.source, handle: wire.sourceHandle });
  const ignore = project.wires
    .filter((w) =>
      own.has(
        isTap(project, w.source)
          ? `j:${w.source}`
          : `${w.source}.${w.sourceHandle}`,
      ),
    )
    .map((w) => w.id);
  return collectAnchors(project, ignore, own);
}

export function snappedSegment(
  project: Project,
  wireId: string,
  index: number,
  at: Pt,
  zoom: number,
  anchors = editingAnchors(project, wireId),
) {
  const points = polylineOfWire(project, wireId),
    a = points[index],
    b = points[index + 1];
  if (!a || !b) return { project, guides: [] };
  const horizontal = a.y === b.y;
  const axis = horizontal ? 'y' : 'x';
  const tolerance = STRAIGHTEN_PX / zoom;
  const own = segmentAnchors(points, index, axis).filter(
    (g) => Math.abs(g.value - at[axis]) <= tolerance,
  );
  if (own.length) {
    // Prefer the route with fewer bends, then less travel, then the nearest snap.
    const candidates = own
      .map((guide) => {
        const draft = slideSegment(
          project,
          wireId,
          index,
          guide.value - a[axis],
        );
        const next = alignRuns(draft, wireId, axis, guide.value, tolerance);
        const route = polylineOfWire(next, wireId);
        return {
          project: next,
          guide,
          count: route.length,
          length: lengthOf(route),
          distance: Math.abs(guide.value - at[axis]),
        };
      })
      .sort(
        (a, b) =>
          a.count - b.count || a.length - b.length || a.distance - b.distance,
      );
    return { project: candidates[0].project, guides: [candidates[0].guide] };
  }
  const snap = snapToAnchors(
    at,
    anchors.filter((g) => g.axis === axis),
    tolerance,
  );
  return {
    project: slideSegment(project, wireId, index, snap.point[axis] - a[axis]),
    guides: snap.guides,
  };
}

/** Corner editing shares the segment straightening policy, rather than a separate grid. */
export function snappedVertex(
  project: Project,
  wireId: string,
  index: number,
  at: Pt,
  zoom: number,
  anchors = editingAnchors(project, wireId),
) {
  const points = polylineOfWire(project, wireId),
    old = points[index];
  if (!old) return { project, guides: [] };
  const tolerance = STRAIGHTEN_PX / zoom;
  const point = { ...at },
    guides: Anchor[] = [];
  for (const axis of ['x', 'y'] as const) {
    const own = points
      .filter(
        (p, i) =>
          i !== index &&
          !(
            i > 0 &&
            i < points.length - 1 &&
            Math.abs(i - index) === 1 &&
            p[axis] === old[axis]
          ),
      )
      .map((p) => ({ axis, value: p[axis] }));
    const close = own.filter((g) => Math.abs(g.value - at[axis]) <= tolerance);
    const snap = snapToAnchors(
      at,
      close.length ? close : anchors.filter((g) => g.axis === axis),
      tolerance,
    );
    point[axis] = snap.point[axis];
    guides.push(...snap.guides.filter((g) => g.axis === axis));
  }
  let next = moveVertex(project, wireId, index, point);
  for (const guide of guides)
    next = alignRuns(next, wireId, guide.axis, guide.value, tolerance);
  return { project: next, guides };
}
