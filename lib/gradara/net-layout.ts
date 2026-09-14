import type { Project, Wire } from './model';
import { endpointPoint, isTap } from './net';
import { nearly, polylineOfWire, samePt } from './net-draw';
import { sideToPosition } from './ports';
import { routeBetween, segmentExit, simplifyRoute, type Pt } from './routing';

type Axis = 'x' | 'y';
const perpendicular = (a: Pt, b: Pt): Axis => (nearly(a.y, b.y) ? 'y' : 'x');
const equalPoints = (a: Pt[] = [], b: Pt[] = []) =>
  a.length === b.length && a.every((p, i) => samePt(p, b[i]));

function clean(project: Project, wire: Wire, points: Pt[]) {
  const side = (id: string, handle: string) => {
    const point = endpointPoint(project, id, handle);
    return !isTap(project, id) && point
      ? sideToPosition(point.side)
      : undefined;
  };
  return simplifyRoute(
    points,
    side(wire.source, wire.sourceHandle),
    side(wire.target, wire.targetHandle),
  );
}

/** Junctions sharing a straight run move together, regardless of wire direction. */
export function junctionsOnRun(
  project: Project,
  wireId: string,
  index: number,
): string[] {
  const wire = project.wires.find((w) => w.id === wireId);
  const points = polylineOfWire(project, wireId);
  if (!wire || !points[index + 1]) return [];
  const axis = perpendicular(points[index], points[index + 1]);
  const coordinate = points[index][axis];
  const ids = new Set<string>();
  const add = (id: string) => {
    if (isTap(project, id)) ids.add(id);
  };
  if (index === 0) add(wire.source);
  if (index === points.length - 2) add(wire.target);
  for (const id of ids) {
    for (const other of project.wires) {
      if (other.source !== id && other.target !== id) continue;
      const route = polylineOfWire(project, other.id);
      if (route.length < 2 || !route.every((p) => nearly(p[axis], coordinate)))
        continue;
      add(other.source === id ? other.target : other.source);
    }
  }
  return [...ids];
}

/** Move real junctions and stretch every incident route in the same transaction. */
export function moveJunctions(
  project: Project,
  positions: ReadonlyMap<string, Pt>,
): Project {
  const moves = new Map(
    (project.junctions ?? [])
      .filter(
        (j) => positions.has(j.id) && !samePt(j.position, positions.get(j.id)!),
      )
      .map((j) => [j.id, positions.get(j.id)!]),
  );
  if (!moves.size) return project;
  const next: Project = {
    ...project,
    junctions: project.junctions?.map((j) =>
      moves.has(j.id) ? { ...j, position: { ...moves.get(j.id)! } } : j,
    ),
  };
  next.wires = project.wires.map((wire) => {
    const start = moves.get(wire.source),
      end = moves.get(wire.target);
    if (!start && !end) return wire;
    const original = polylineOfWire(project, wire.id);
    if (original.length < 2) return wire;
    let points: Pt[];
    if (original.length === 2) {
      // Preserve the run's direction at the junction as well as the fixed port.
      // Otherwise a newly inserted vertical leg would anchor the dot again.
      points = routeBetween(
        start ?? original[0],
        end ?? original[1],
        segmentExit(original[0], original[1]),
        segmentExit(original[1], original[0]),
      );
    } else {
      points = original.map((p) => ({ ...p }));
      if (start) {
        const axis = perpendicular(original[0], original[1]);
        points[0] = { ...start };
        points[1][axis] = start[axis];
      }
      if (end) {
        const last = points.length - 1;
        const axis = perpendicular(original[last], original[last - 1]);
        points[last] = { ...end };
        points[last - 1][axis] = end[axis];
      }
    }
    const waypoints = clean(next, wire, points).slice(1, -1);
    return equalPoints(wire.waypoints, waypoints)
      ? wire
      : { ...wire, waypoints };
  });
  return next;
}

const normalized = new WeakMap<Project, Project>();

/**
 * A dot belongs at the actual divergence, not at the end of a shared detour.
 * If all but one incident paths share an initial run, slide the junction to
 * its nearest bend and trim/extend those paths. The visible union and logical
 * connections are preserved. Unrelated crossings and genuine four-way splits
 * cannot trigger this rule.
 */
export function normalizeJunctions(project: Project): Project {
  const cached = normalized.get(project);
  if (cached) return cached;
  if (!project.junctions?.length) return project;
  const paths = new Map(
    project.wires.map((w) => [w.id, polylineOfWire(project, w.id)]),
  );
  const incident = new Map(
    project.junctions.map((j) => [
      j.id,
      project.wires.filter((w) => w.source === j.id || w.target === j.id),
    ]),
  );
  const positions = new Map(project.junctions.map((j) => [j.id, j.position]));
  const changed = new Set<string>();
  const queue = project.junctions.map((j) => j.id).sort();
  const pending = new Set(queue);
  for (let cursor = 0; cursor < queue.length; cursor++) {
    const id = queue[cursor];
    pending.delete(id);
    const wires = incident.get(id)!;
    if (wires.length < 3) continue;
    const branches = wires.map((wire) => ({
      wire,
      points:
        wire.source === id
          ? paths.get(wire.id)!
          : [...paths.get(wire.id)!].reverse(),
    }));
    if (branches.some((b) => b.points.length < 2)) continue;
    const groups = new Map<string, typeof branches>();
    for (const branch of branches) {
      const direction = segmentExit(branch.points[0], branch.points[1]);
      groups.set(direction, [...(groups.get(direction) ?? []), branch]);
    }
    const shared = [...groups.values()].find(
      (group) => group.length === wires.length - 1,
    );
    if (!shared) continue;
    const origin = positions.get(id)!;
    const nearest = shared.reduce((a, b) =>
      Math.hypot(a.points[1].x - origin.x, a.points[1].y - origin.y) <=
      Math.hypot(b.points[1].x - origin.x, b.points[1].y - origin.y)
        ? a
        : b,
    );
    const point = nearest.points[1];
    if (samePt(origin, point)) continue;
    // Reaching another junction or port would require changing topology.
    if (shared.some((b) => b.points.length === 2 && samePt(b.points[1], point)))
      continue;
    positions.set(id, { ...point });
    for (const branch of branches) {
      const moved = shared.includes(branch)
        ? [point, ...branch.points.slice(1)]
        : [point, ...branch.points];
      const oriented = branch.wire.source === id ? moved : moved.reverse();
      paths.set(branch.wire.id, clean(project, branch.wire, oriented));
      changed.add(branch.wire.id);
      for (const neighbor of [branch.wire.source, branch.wire.target]) {
        if (incident.has(neighbor) && !pending.has(neighbor)) {
          queue.push(neighbor);
          pending.add(neighbor);
        }
      }
    }
  }
  const next = !changed.size
    ? project
    : {
        ...project,
        junctions: project.junctions.map((j) =>
          samePt(j.position, positions.get(j.id)!)
            ? j
            : { ...j, position: positions.get(j.id)! },
        ),
        wires: project.wires.map((w) => {
          if (!changed.has(w.id)) return w;
          const waypoints = paths.get(w.id)!.slice(1, -1);
          return equalPoints(w.waypoints, waypoints) ? w : { ...w, waypoints };
        }),
      };
  normalized.set(project, next);
  normalized.set(next, next);
  return next;
}

/** A block moving a whole endpoint run carries its junctions perpendicular to it. */
export function followJunctionsForLayout(
  before: Project,
  after: Project,
): Project {
  if (!before.junctions?.length || before.blocks === after.blocks) return after;
  const proposals = new Map<string, Partial<Record<Axis, number | null>>>();
  for (const wire of before.wires) {
    const points = polylineOfWire(before, wire.id);
    if (points.length !== 2) continue;
    const axis = perpendicular(points[0], points[1]);
    for (const [id, handle] of [
      [wire.source, wire.sourceHandle],
      [wire.target, wire.targetHandle],
    ]) {
      if (isTap(before, id)) continue;
      const a = endpointPoint(before, id, handle),
        b = endpointPoint(after, id, handle);
      if (!a || !b || nearly(a[axis], b[axis])) continue;
      for (const junctionId of junctionsOnRun(before, wire.id, 0)) {
        const proposal = proposals.get(junctionId) ?? {};
        const value = b[axis];
        const existing = proposal[axis];
        proposal[axis] =
          existing === undefined ||
          (existing !== null && nearly(existing, value))
            ? value
            : null;
        proposals.set(junctionId, proposal);
      }
    }
  }
  const positions = new Map(
    (before.junctions ?? [])
      .filter((j) => proposals.has(j.id))
      .map((j) => {
        const proposal = proposals.get(j.id)!;
        return [
          j.id,
          { x: proposal.x ?? j.position.x, y: proposal.y ?? j.position.y },
        ];
      }),
  );
  const moved = moveJunctions(before, positions);
  return moved === before
    ? after
    : { ...after, junctions: moved.junctions, wires: moved.wires };
}
