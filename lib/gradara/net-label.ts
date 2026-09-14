import type { Net, Project } from './model';
import { polylineOfWire, type Pt } from './net-draw';

export type LabelAnchor = NonNullable<Net['label']>;

function segments(project: Project, net: Net) {
  return net.wireIds.flatMap((wireId) => {
    const points = polylineOfWire(project, wireId);
    const lengths = points
      .slice(1)
      .map((p, i) => Math.hypot(p.x - points[i].x, p.y - points[i].y));
    const total = lengths.reduce((a, b) => a + b, 0);
    let start = 0;
    return lengths.flatMap((length, i) => {
      const from = start;
      start += length;
      return length
        ? [
            {
              wireId,
              a: points[i],
              b: points[i + 1],
              length,
              total,
              start: from,
              horizontal: Math.abs(points[i].y - points[i + 1].y) < 0.001,
            },
          ]
        : [];
    });
  });
}

/** Names attach to a route fraction, so they follow block and wire movement. */
export function labelPosition(project: Project, net: Net, anchor = net.label) {
  const edges = segments(project, net);
  const requested = anchor;
  let edge =
    requested &&
    edges.find(
      (e) =>
        e.wireId === requested.wireId &&
        e.start + e.length >= requested.fraction * e.total - 0.001,
    );
  if (!edge) {
    // Favor the longest horizontal stretch; short port stubs are poor label sites.
    edge = [...edges].sort(
      (a, b) =>
        Number(b.horizontal) - Number(a.horizontal) ||
        b.length - a.length ||
        a.wireId.localeCompare(b.wireId),
    )[0];
    anchor = edge
      ? {
          wireId: edge.wireId,
          fraction: (edge.start + edge.length / 2) / edge.total,
          side: 1,
        }
      : undefined;
  }
  if (!edge || !anchor) return undefined;
  const t = Math.max(
    0,
    Math.min(1, (anchor.fraction * edge.total - edge.start) / edge.length),
  );
  const point = {
    x: edge.a.x + (edge.b.x - edge.a.x) * t,
    y: edge.a.y + (edge.b.y - edge.a.y) * t,
  };
  return {
    anchor,
    point,
    horizontal: edge.horizontal,
    x: point.x + (edge.horizontal ? 0 : -11 * anchor.side),
    y: point.y + (edge.horizontal ? 12 * anchor.side : 0),
  };
}

/** Snap to any branch of this net, with side switching relative to the wire. */
export function nearestLabelAnchor(
  project: Project,
  net: Net,
  point: Pt,
): LabelAnchor | undefined {
  let best: { distance: number; anchor: LabelAnchor } | undefined;
  for (const e of segments(project, net)) {
    const dx = e.b.x - e.a.x,
      dy = e.b.y - e.a.y;
    const t = Math.max(
      0,
      Math.min(
        1,
        ((point.x - e.a.x) * dx + (point.y - e.a.y) * dy) /
          (e.length * e.length),
      ),
    );
    const x = e.a.x + t * dx,
      y = e.a.y + t * dy;
    const distance = Math.hypot(point.x - x, point.y - y);
    if (!best || distance < best.distance)
      best = {
        distance,
        anchor: {
          wireId: e.wireId,
          fraction: (e.start + e.length * t) / e.total,
          side: (e.horizontal ? point.y >= y : point.x <= x) ? 1 : -1,
        },
      };
  }
  return best?.anchor;
}

export function setNetLabel(project: Project, id: string, label?: LabelAnchor) {
  const net = project.nets?.find((n) => n.id === id);
  if (!net || JSON.stringify(net.label) === JSON.stringify(label))
    return project;
  return {
    ...project,
    nets: project.nets!.map((n) => (n.id === id ? { ...n, label } : n)),
  };
}
