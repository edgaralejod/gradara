import type { Project } from './model';
import { polylineOfWire } from './net-draw';
export type Pt = { x: number; y: number };
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

export function setWireWaypoints(
  project: Project,
  id: string,
  waypoints: Pt[],
) {
  return {
    ...project,
    wires: project.wires.map((w) => (w.id === id ? { ...w, waypoints } : w)),
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
  const pts = insertVertex(polylineOfWire(project, wire.id), p);
  return setWireWaypoints(project, id, pts.slice(1, -1));
}
