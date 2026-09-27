import { Position } from '@xyflow/react';
import type { Project, Wire } from './model';
import { endpointPoint, isTap } from './net';
import { nearly, polylineOfWire, samePt, storedPolyline } from './net-draw';
import { sideToPosition } from './ports';
import { blockSize } from './canvas';
import {
  routeAround,
  routeBetween,
  segmentExit,
  segmentHitsRect,
  selfIntersects,
  simplifyRoute,
  type Pt,
} from './routing';

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
    if (!wire.waypoints?.length) {
      // An auto-routed wire whose new ends line up is simply straight: keep it unpinned
      // rather than freezing a detour drawn for the old geometry.
      const a = start ?? endpointPoint(next, wire.source, wire.sourceHandle);
      const b = end ?? endpointPoint(next, wire.target, wire.targetHandle);
      if (a && b && (nearly(a.x, b.x) || nearly(a.y, b.y))) return wire;
    }
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
      if (!a || !b) continue;
      // A block moved along its own lead onto or past the dot: carry the dot out ahead
      // of the terminal, keeping its spacing, so the lead never folds back into the body.
      const tapId = id === wire.source ? wire.target : wire.source;
      const tap = before.junctions.find((j) => j.id === tapId);
      if (tap) {
        const along: Axis = axis === 'x' ? 'y' : 'x';
        const normal = { left: -1, right: 1, top: -1, bottom: 1 }[a.side];
        const ahead = (tap.position[along] - a[along]) * normal;
        const aheadAfter = (tap.position[along] - b[along]) * normal;
        if (ahead > 0 && aheadAfter <= 0) {
          const proposal = proposals.get(tapId) ?? {};
          const value = b[along] + normal * ahead;
          const existing = proposal[along];
          proposal[along] =
            existing === undefined ||
            (existing !== null && nearly(existing, value))
              ? value
              : null;
          proposals.set(tapId, proposal);
        }
      }
      if (nearly(a[axis], b[axis])) continue;
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
  // Stretch routes against the blocks' new positions: stretching the old geometry and
  // then moving the block again leaves hairpin bends on the wire that drove the move.
  return moveJunctions(after, positions);
}

function reverses(points: Pt[]) {
  for (let i = 2; i < points.length; i++) {
    const [a, b, c] = [points[i - 2], points[i - 1], points[i]];
    const straight =
      (nearly(a.x, b.x) && nearly(b.x, c.x)) ||
      (nearly(a.y, b.y) && nearly(b.y, c.y));
    if (straight && (b.x - a.x) * (c.x - b.x) + (b.y - a.y) * (c.y - b.y) < 0)
      return true;
  }
  return false;
}

function crossesOwnBlock(project: Project, wire: Wire, points: Pt[]) {
  for (const id of [wire.source, wire.target]) {
    const block = project.blocks.find((b) => b.id === id);
    if (!block) continue;
    const body = { ...block.position, ...blockSize(block) };
    for (let i = 1; i < points.length; i++)
      if (segmentHitsRect(points[i - 1], points[i], body)) return true;
  }
  return false;
}

/**
 * After blocks move on their own, a pinned route can end up doubling back into its
 * terminal or through its own block. Release the bends next to the moved end, one at a
 * time, until the wire reads cleanly again; untouched wires and good routes are kept.
 */
export function repairMovedRoutes(
  project: Project,
  movedIds: readonly string[],
  /** Only these ends moved rigidly with their wire; a wire between two of them is kept. */
  rigidIds: readonly string[] = [],
): Project {
  const moved = new Set(movedIds);
  const rigid = new Set(rigidIds);
  let changed = false;
  const wires = project.wires.map((wire) => {
    if (!(moved.has(wire.source) || moved.has(wire.target))) return wire;
    if (rigid.has(wire.source) && rigid.has(wire.target)) return wire;
    let current = wire;
    const bad = (w: Wire) => {
      const trial = {
        ...project,
        wires: project.wires.map((x) => (x.id === w.id ? w : x)),
      };
      const points = polylineOfWire(trial, w.id);
      const stored = storedPolyline(trial, w.id);
      return (
        reverses(points) ||
        selfIntersects(stored) ||
        crossesOwnBlock(trial, w, points)
      );
    };
    while (current.waypoints?.length && bad(current)) {
      const points = [...current.waypoints];
      // Drop the bend nearest a moved end (the source end first when both moved).
      if (moved.has(current.source)) points.shift();
      else points.pop();
      current = { ...current, waypoints: points };
    }
    if (!current.waypoints?.length && bad(current)) {
      const detour = detourToDot(project, current);
      if (detour && !bad(detour)) current = detour;
      else {
        const around = aroundFromDot(project, current);
        if (around && !bad(around)) current = around;
      }
    }
    if (current.waypoints?.length) {
      // Keep what is stored equal to what is drawn once a loop was cut out of the route.
      const trial = {
        ...project,
        wires: project.wires.map((x) => (x.id === current.id ? current : x)),
      };
      const shown = polylineOfWire(trial, current.id);
      const stored = storedPolyline(trial, current.id);
      if (
        shown.length >= 2 &&
        (shown.length !== stored.length ||
          shown.some((p, i) => !samePt(p, stored[i])))
      )
        current = { ...current, waypoints: shown.slice(1, -1) };
    }
    if (current !== wire) changed = true;
    return current;
  });
  return changed ? { ...project, wires } : project;
}

/**
 * A block dragged past its own junction dot: pin a route that leaves the terminal, steps
 * around the body on the dot's side, and comes back, instead of cutting through the block.
 */
function detourToDot(project: Project, wire: Wire): Wire | undefined {
  const blockEnd = isTap(project, wire.target)
    ? 'source'
    : isTap(project, wire.source)
      ? 'target'
      : undefined;
  if (!blockEnd) return undefined;
  const id = blockEnd === 'source' ? wire.source : wire.target;
  const handle = blockEnd === 'source' ? wire.sourceHandle : wire.targetHandle;
  const block = project.blocks.find((b) => b.id === id);
  const port = endpointPoint(project, id, handle);
  const dot = endpointPoint(
    project,
    blockEnd === 'source' ? wire.target : wire.source,
    'node',
  );
  if (!block || !port || !dot) return undefined;
  const size = blockSize(block);
  const stub = 20;
  const out = { left: [-1, 0], right: [1, 0], top: [0, -1], bottom: [0, 1] }[
    port.side
  ];
  const lead = { x: port.x + out[0] * stub, y: port.y + out[1] * stub };
  let bends: Pt[];
  if (out[0] !== 0) {
    const above = dot.y < block.position.y + size.height / 2;
    const y = above
      ? Math.min(block.position.y - stub, dot.y)
      : Math.max(block.position.y + size.height + stub, dot.y);
    bends = [lead, { x: lead.x, y }, { x: dot.x, y }];
  } else {
    const leftward = dot.x < block.position.x + size.width / 2;
    const x = leftward
      ? Math.min(block.position.x - stub, dot.x)
      : Math.max(block.position.x + size.width + stub, dot.x);
    bends = [lead, { x, y: lead.y }, { x, y: dot.y }];
  }
  bends = bends.filter(
    (p, i) => !samePt(p, dot) && (i === 0 || !samePt(p, bends[i - 1])),
  );
  return {
    ...wire,
    waypoints: blockEnd === 'source' ? bends : bends.reverse(),
  };
}

/**
 * The cleanest route from a junction dot to a block terminal that stays out of the block:
 * the dot may leave in any direction, the terminal is entered along its normal.
 */
function aroundFromDot(project: Project, wire: Wire): Wire | undefined {
  const dotIsSource = isTap(project, wire.source);
  if (dotIsSource === isTap(project, wire.target)) return undefined;
  const [dotId, blockId, handle] = dotIsSource
    ? [wire.source, wire.target, wire.targetHandle]
    : [wire.target, wire.source, wire.sourceHandle];
  const dot = endpointPoint(project, dotId, 'node');
  const port = endpointPoint(project, blockId, handle);
  const block = project.blocks.find((b) => b.id === blockId);
  if (!dot || !port || !block) return undefined;
  const body = { ...block.position, ...blockSize(block) };
  let best: { points: Pt[]; cost: number } | undefined;
  for (const exit of [
    Position.Left,
    Position.Right,
    Position.Top,
    Position.Bottom,
  ]) {
    // Leaving the port and arriving at the dot is the same route reversed.
    const points = routeAround(port, dot, sideToPosition(port.side), exit, [
      body,
    ]);
    if (selfIntersects(points)) continue;
    let hits = 0;
    for (let i = 1; i < points.length; i++)
      if (segmentHitsRect(points[i - 1], points[i], body)) hits++;
    const cost = hits * 100000 + points.length * 30 + routeLengthOf(points);
    if (!best || cost < best.cost) best = { points, cost };
  }
  if (!best || best.points.length < 3) return undefined;
  const bends = best.points.slice(1, -1);
  return { ...wire, waypoints: dotIsSource ? bends.reverse() : bends };
}

function routeLengthOf(points: Pt[]) {
  let length = 0;
  for (let i = 1; i < points.length; i++)
    length +=
      Math.abs(points[i].x - points[i - 1].x) +
      Math.abs(points[i].y - points[i - 1].y);
  return length;
}
