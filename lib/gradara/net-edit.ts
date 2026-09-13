import type { Project } from './model';
import { endpointPoint, isTap, netKeys } from './net';
import { collectAnchors, polylineOfWire, snapToAnchors } from './net-draw';
import { sideToPosition } from './ports';
import { outward, simplifyPoints, type Pt } from './routing';
import { setWireWaypoints } from './wires';

/** Move one run perpendicular to itself. Endpoints never move; endpoint runs grow doglegs. */
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
  const moved = simplifyPoints([
    ...pts.slice(0, index),
    ...(start ? [a, startStub, shift(startStub)] : [shift(a)]),
    ...(end ? [shift(endStub), endStub, b] : [shift(b)]),
    ...pts.slice(index + 2),
  ]);
  return setWireWaypoints(project, wireId, moved.slice(1, -1));
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
  return setWireWaypoints(project, wireId, simplifyPoints(points).slice(1, -1));
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
  const snap = snapToAnchors(
    at,
    anchors.filter((g) => g.axis === axis),
    8 / zoom,
  );
  return {
    project: slideSegment(project, wireId, index, snap.point[axis] - a[axis]),
    guides: snap.guides,
  };
}
