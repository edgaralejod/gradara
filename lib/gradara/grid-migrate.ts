import type { Block, Junction, Project } from './model';
import { GRID } from './grid';
import { portPoint } from './ports';

type Sheet = Pick<Project, 'blocks' | 'wires'> & { junctions?: Junction[] };
type Wire = Project['wires'][number];
type Pt = { x: number; y: number };
type Axis = 'x' | 'y';

const horizontal = (side: string) => side === 'left' || side === 'right';

/**
 * Line up wires that a move onto the grid left one step out of line.
 *
 * Putting an older document on the grid moves each block by up to half a step and
 * puts its ports on grid offsets, so two ends that were in line can end up a step
 * apart, and their wire gains a small jog. This removes those jogs:
 *
 * - A wire between a block port and another port or a junction, at most one step out
 *   of line across the port's axis, moves one block by that step: the target
 *   when it has no straight wire to keep, otherwise the source under the same rule.
 *   Junctions never move. A block moves at most once, so blocks already holding a
 *   straight wire stay put and the result does not depend on repeated passes.
 * - A pinned wire whose first or last run leaves its port one step out of line moves
 *   that run onto the port's line.
 */
export function straightenNearRuns<T extends Sheet>(sheet: T): T {
  const byId = new Map(sheet.blocks.map((b) => [b.id, b]));
  const junctionAt = new Map(
    (sheet.junctions ?? []).map((j) => [j.id, j.position]),
  );
  const point = (id: string, handle: string) => {
    const block = byId.get(id);
    if (block) {
      const p = portPoint(block, handle);
      return p && { ...p, block };
    }
    const j = junctionAt.get(id);
    return j && { ...j, side: undefined, block: undefined };
  };
  /** The two ends of a wire and how far apart they are across its axis. */
  const ends = (w: Wire) => {
    if (w.source === w.target) return undefined;
    const p = point(w.source, w.sourceHandle),
      q = point(w.target, w.targetHandle);
    if (!p || !q || (!p.block && !q.block)) return undefined;
    const sides = [p.side, q.side].filter((s) => s !== undefined);
    if (sides.length === 2 && horizontal(sides[0]) !== horizontal(sides[1]))
      return undefined;
    const axis: Axis = horizontal(sides[0]) ? 'y' : 'x';
    return { p, q, axis, d: q[axis] - p[axis] };
  };
  const straight = new Set<string>();
  for (const w of sheet.wires) {
    const e = ends(w);
    if (e?.d === 0)
      for (const end of [e.p, e.q]) if (end.block) straight.add(end.block.id);
  }
  const moved = new Set<string>();
  let changed = false;
  for (const w of sheet.wires) {
    const e = ends(w);
    if (!e || e.d === 0 || Math.abs(e.d) > GRID) continue;
    const pick = (
      [
        [e.q.block, -e.d],
        [e.p.block, e.d],
      ] as [Block | undefined, number][]
    ).find(([b]) => b && !straight.has(b.id) && !moved.has(b.id));
    if (!pick) continue;
    const [block, shift] = pick as [Block, number];
    byId.set(block.id, {
      ...block,
      position: { ...block.position, [e.axis]: block.position[e.axis] + shift },
    });
    moved.add(block.id);
    for (const end of [e.p, e.q]) if (end.block) straight.add(end.block.id);
    changed = true;
  }

  /** Move a pinned wire's end run onto its port's line when it is a step away. */
  const alignEnd = (waypoints: Pt[], port: ReturnType<typeof point>) => {
    if (!port?.side || !waypoints.length) return waypoints;
    const axis: Axis = horizontal(port.side) ? 'y' : 'x';
    const d = port[axis] - waypoints[0][axis];
    if (d === 0 || Math.abs(d) > GRID) return waypoints;
    const run = waypoints.findIndex((p) => p[axis] !== waypoints[0][axis]);
    const count = run < 0 ? waypoints.length : run;
    return waypoints.map((p, i) =>
      i < count ? { ...p, [axis]: port[axis] } : p,
    );
  };
  const wires = sheet.wires.map((w) => {
    if (!w.waypoints?.length) return w;
    let waypoints = alignEnd(w.waypoints, point(w.source, w.sourceHandle));
    waypoints = alignEnd(
      [...waypoints].reverse(),
      point(w.target, w.targetHandle),
    ).reverse();
    if (waypoints.every((p, i) => p === w.waypoints![i])) return w;
    changed = true;
    return { ...w, waypoints };
  });
  if (!changed) return sheet;
  return {
    ...sheet,
    blocks: sheet.blocks.map((b) => byId.get(b.id)!),
    wires,
  };
}
