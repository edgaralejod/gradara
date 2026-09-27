/**
 * The sheet router: the one owner of wire geometry.
 *
 * Every wire's drawn route is a pure function of the sheet: block bodies, terminals, the
 * connections, and the bends a user pinned. Automatic wires are routed around every block
 * body, off the lines of other nets, and preferably off block names, with the fewest bends.
 * A pinned route is used as drawn while it is valid (no loop, no hairpin, not through a
 * block); otherwise that wire is routed automatically. Wires are routed in a fixed order,
 * so the same sheet always draws the same way: preview, commit, and reload agree.
 */
import { Position } from '@xyflow/react';
import { blockSize } from './canvas';
import type { Block, Project, Wire } from './model';
import { endpointPoint, isTap, netComponents } from './net';
import { sideToPosition } from './ports';
import {
  EXIT_STUB,
  eraseLoops,
  outward,
  routeBetween,
  segmentExit,
  segmentHitsRect,
  selfIntersects,
  simplifyPoints,
  simplifyRoute,
  type Pt,
  type Rect,
} from './routing';

const SIDES = [Position.Right, Position.Bottom, Position.Left, Position.Top];
/** Clearance a detour keeps from a body; below a block it also clears the instance name. */
const LANE = EXIT_STUB;
const NAME_LANE = 44;
/** How far around a connection the router looks for detour lanes before widening. */
const REACH = 240;

const COST = {
  body: 100000,
  overlap: 20000,
  label: 400,
  crossing: 25,
  bend: 30,
};

type Segment = { a: Pt; b: Pt; net: string };

export type Sheet = {
  bodies: Map<string, Rect>;
  labels: Map<string, Rect>;
};

const near = (a: number, b: number) => Math.abs(a - b) <= 0.000001;

export function bodyOf(block: Block): Rect {
  return { ...block.position, ...blockSize(block) };
}

/** Where a block's instance name is drawn: centered under the body, moved by its offset. */
export function labelOf(block: Block): Rect {
  const body = bodyOf(block);
  const width = Math.min(240, Math.max(24, block.definition.name.length * 8));
  return {
    x: body.x + body.width / 2 - width / 2 + (block.labelOffset?.x ?? 0),
    y: body.y + body.height + 4 + (block.labelOffset?.y ?? 0),
    width,
    height: 20,
  };
}

export function sheetOf(project: Project): Sheet {
  return {
    bodies: new Map(project.blocks.map((b) => [b.id, bodyOf(b)])),
    labels: new Map(
      project.blocks
        .filter((b) => !b.definition.kind.startsWith('subsystem'))
        .map((b) => [b.id, labelOf(b)]),
    ),
  };
}

/** Which net each wire belongs to, from the connections themselves (never stale). */
function netOfWire(project: Project) {
  const component = new Map<string, number>();
  netComponents(project).forEach((keys, i) =>
    keys.forEach((k) => component.set(k, i)),
  );
  const keyOf = (id: string, handle: string) =>
    isTap(project, id) ? `j:${id}` : `${id}.${handle}`;
  return (wire: Wire) =>
    `net:${component.get(keyOf(wire.source, wire.sourceHandle)) ?? wire.id}`;
}

function length(points: Pt[]) {
  let total = 0;
  for (let i = 1; i < points.length; i++)
    total +=
      Math.abs(points[i].x - points[i - 1].x) +
      Math.abs(points[i].y - points[i - 1].y);
  return total;
}

function orthogonal(points: Pt[]) {
  for (let i = 1; i < points.length; i++)
    if (
      !near(points[i].x, points[i - 1].x) &&
      !near(points[i].y, points[i - 1].y)
    )
      return false;
  return true;
}

/** Length two collinear segments share. */
function shared(a: Pt, b: Pt, c: Pt, d: Pt) {
  if (near(a.y, b.y) && near(c.y, d.y) && near(a.y, c.y))
    return (
      Math.min(Math.max(a.x, b.x), Math.max(c.x, d.x)) -
      Math.max(Math.min(a.x, b.x), Math.min(c.x, d.x))
    );
  if (near(a.x, b.x) && near(c.x, d.x) && near(a.x, c.x))
    return (
      Math.min(Math.max(a.y, b.y), Math.max(c.y, d.y)) -
      Math.max(Math.min(a.y, b.y), Math.min(c.y, d.y))
    );
  return 0;
}

function crosses(a: Pt, b: Pt, c: Pt, d: Pt) {
  const h1 = near(a.y, b.y),
    h2 = near(c.y, d.y);
  if (h1 === h2) return false;
  const [hA, hB, vA, vB] = h1 ? [a, b, c, d] : [c, d, a, b];
  const within = (v: number, p: number, q: number) =>
    v > Math.min(p, q) + 0.5 && v < Math.max(p, q) - 0.5;
  return within(vA.x, hA.x, hB.x) && within(hA.y, vA.y, vB.y);
}

type Context = {
  rects: Rect[];
  labels: Rect[];
  /** The wire's own blocks' names: only running along them counts. */
  ownLabels: Rect[];
  occupied: Segment[];
  net: string;
};

function bodyHits(points: Pt[], ctx: Context) {
  for (let i = 1; i < points.length; i++)
    for (const r of ctx.rects)
      if (segmentHitsRect(points[i - 1], points[i], r)) return true;
  return false;
}

/** Penalties a route pays on this sheet; zero means clean. */
function penalty(points: Pt[], ctx: Context) {
  let cost = 0;
  for (let i = 1; i < points.length; i++) {
    const a = points[i - 1],
      b = points[i];
    for (const r of ctx.rects) if (segmentHitsRect(a, b, r)) cost += COST.body;
    for (const r of ctx.labels)
      if (segmentHitsRect(a, b, r, 0)) cost += COST.label;
    if (near(a.y, b.y))
      for (const r of ctx.ownLabels)
        if (segmentHitsRect(a, b, r, 0)) cost += COST.label;
    for (const s of ctx.occupied) {
      if (s.net === ctx.net) continue;
      if (shared(a, b, s.a, s.b) > 0.5) cost += COST.overlap;
      else if (crosses(a, b, s.a, s.b)) cost += COST.crossing;
    }
  }
  return cost;
}

function score(points: Pt[], ctx: Context) {
  return (
    penalty(points, ctx) +
    COST.bend * Math.max(0, points.length - 2) +
    length(points)
  );
}

type Ends = {
  from: Pt;
  exits: Position[];
  fromStub: number;
  to: Pt;
  entries: Position[];
  toStub: number;
};

const STEP: Pt[] = [
  { x: 1, y: 0 },
  { x: 0, y: 1 },
  { x: -1, y: 0 },
  { x: 0, y: -1 },
];
const DIR_OF: Record<Position, number> = {
  [Position.Right]: 0,
  [Position.Bottom]: 1,
  [Position.Left]: 2,
  [Position.Top]: 3,
};

/** A small binary heap on numbers keyed by priority; ties keep insertion order. */
class Heap {
  private items: { f: number; n: number; v: number }[] = [];
  private count = 0;
  get size() {
    return this.items.length;
  }
  push(f: number, v: number) {
    const item = { f, n: this.count++, v };
    const a = this.items;
    a.push(item);
    let i = a.length - 1;
    while (i > 0) {
      const p = (i - 1) >> 1;
      if (a[p].f < f || (a[p].f === f && a[p].n < item.n)) break;
      a[i] = a[p];
      i = p;
    }
    a[i] = item;
  }
  pop() {
    const a = this.items;
    const top = a[0];
    const last = a.pop()!;
    if (a.length) {
      const less = (x: typeof last, y: typeof last) =>
        x.f < y.f || (x.f === y.f && x.n < y.n);
      let i = 0;
      for (;;) {
        const l = 2 * i + 1,
          r = l + 1;
        let m = -1;
        let best = last;
        if (l < a.length && less(a[l], best)) {
          m = l;
          best = a[l];
        }
        if (r < a.length && less(a[r], best)) {
          m = r;
          best = a[r];
        }
        if (m < 0) break;
        a[i] = a[m];
        i = m;
      }
      a[i] = last;
    }
    return top;
  }
}

/**
 * Shortest orthogonal route on the visibility grid of nearby bodies: lines along every
 * body edge (with clearance) and through both ends. Each step pays its length, a bend,
 * and the sheet penalties (names, crossings, lines of other nets); bodies are walls.
 */
function gridRoute(
  ends: Ends,
  ctx: Context,
  reach: number,
): { points: Pt[]; exit: Position; entry: Position } | undefined {
  const { from, to } = ends;
  const box = {
    x: Math.min(from.x, to.x) - reach,
    y: Math.min(from.y, to.y) - reach,
    x1: Math.max(from.x, to.x) + reach,
    y1: Math.max(from.y, to.y) + reach,
  };
  const starts = ends.exits.map((exit) => ({
    exit,
    at: outward(from, exit, ends.fromStub),
  }));
  const goals = ends.entries.map((entry) => ({
    entry,
    at: outward(to, entry, ends.toStub),
    /** The direction of the last run, from the goal into the terminal. */
    last: (DIR_OF[entry] + 2) % 4,
  }));
  const xs = new Set<number>(),
    ys = new Set<number>();
  for (const p of [
    from,
    to,
    ...starts.map((s) => s.at),
    ...goals.map((g) => g.at),
  ]) {
    xs.add(p.x);
    ys.add(p.y);
  }
  for (const r of ctx.rects) {
    xs.add(r.x - LANE);
    xs.add(r.x + r.width + LANE);
    ys.add(r.y - LANE);
    ys.add(r.y + r.height + LANE);
    ys.add(r.y + r.height + NAME_LANE);
  }
  const within = (v: number, lo: number, hi: number) => v >= lo && v <= hi;
  const X = [...xs]
    .filter((v) => within(v, box.x, box.x1))
    .sort((a, b) => a - b);
  const Y = [...ys]
    .filter((v) => within(v, box.y, box.y1))
    .sort((a, b) => a - b);
  // Midlines between neighbouring lanes give routes room away from both sides.
  for (const list of [X, Y]) {
    const mids: number[] = [];
    for (let i = 1; i < list.length; i++)
      if (list[i] - list[i - 1] > 2 * LANE)
        mids.push(Math.round((list[i] + list[i - 1]) / 2));
    list.push(...mids);
    list.sort((a, b) => a - b);
  }
  const xi = new Map(X.map((v, i) => [v, i])),
    yi = new Map(Y.map((v, i) => [v, i]));
  const nx = X.length,
    ny = Y.length;
  const inside = (p: Pt) =>
    ctx.rects.some(
      (r) =>
        p.x > r.x + 1 &&
        p.x < r.x + r.width - 1 &&
        p.y > r.y + 1 &&
        p.y < r.y + r.height - 1,
    );
  // Other nets' runs, indexed by line (for overlaps) and by position (for crossings).
  const rows = new Map<number, Segment[]>(),
    columns = new Map<number, Segment[]>();
  const verticals: { x: number; lo: number; hi: number }[] = [],
    horizontals: { y: number; lo: number; hi: number }[] = [];
  const ownRows = new Map<number, Segment[]>(),
    ownColumns = new Map<number, Segment[]>();
  for (const seg of ctx.occupied) {
    if (seg.net === ctx.net) {
      const index = near(seg.a.y, seg.b.y) ? ownRows : ownColumns;
      const k = near(seg.a.y, seg.b.y) ? seg.a.y : seg.a.x;
      index.set(k, [...(index.get(k) ?? []), seg]);
      continue;
    }
    if (near(seg.a.y, seg.b.y)) {
      const list = rows.get(seg.a.y) ?? [];
      list.push(seg);
      rows.set(seg.a.y, list);
      horizontals.push({
        y: seg.a.y,
        lo: Math.min(seg.a.x, seg.b.x),
        hi: Math.max(seg.a.x, seg.b.x),
      });
    } else {
      const list = columns.get(seg.a.x) ?? [];
      list.push(seg);
      columns.set(seg.a.x, list);
      verticals.push({
        x: seg.a.x,
        lo: Math.min(seg.a.y, seg.b.y),
        hi: Math.max(seg.a.y, seg.b.y),
      });
    }
  }
  verticals.sort((p, q) => p.x - q.x);
  horizontals.sort((p, q) => p.y - q.y);
  const first = <T>(list: T[], key: (t: T) => number, value: number) => {
    let lo = 0,
      hi = list.length;
    while (lo < hi) {
      const mid = (lo + hi) >> 1;
      if (key(list[mid]) <= value) lo = mid + 1;
      else hi = mid;
    }
    return lo;
  };
  const segCost = new Map<number, number>();
  const stepCost = (a: Pt, b: Pt, key: number) => {
    const known = segCost.get(key);
    if (known !== undefined) return known;
    let cost = 0;
    for (const r of ctx.rects)
      if (segmentHitsRect(a, b, r)) {
        segCost.set(key, Infinity);
        return Infinity;
      }
    for (const r of ctx.labels)
      if (segmentHitsRect(a, b, r, 0)) cost += COST.label;
    const horizontal = near(a.y, b.y);
    if (horizontal)
      for (const r of ctx.ownLabels)
        if (segmentHitsRect(a, b, r, 0)) cost += COST.label;
    const lo = horizontal ? Math.min(a.x, b.x) : Math.min(a.y, b.y),
      hi = horizontal ? Math.max(a.x, b.x) : Math.max(a.y, b.y);
    for (const seg of (horizontal ? rows.get(a.y) : columns.get(a.x)) ?? [])
      if (shared(a, b, seg.a, seg.b) > 0.5) cost += COST.overlap;
    // Running along the wire's own net is cheap: branches share a trunk.
    let along = 0;
    for (const seg of (horizontal ? ownRows.get(a.y) : ownColumns.get(a.x)) ??
      [])
      along = Math.max(along, shared(a, b, seg.a, seg.b));
    cost -= 0.75 * along;
    if (horizontal) {
      for (
        let i = first(verticals, (v) => v.x, lo + 0.5);
        i < verticals.length && verticals[i].x < hi - 0.5;
        i++
      )
        if (a.y > verticals[i].lo + 0.5 && a.y < verticals[i].hi - 0.5)
          cost += COST.crossing;
    } else {
      for (
        let i = first(horizontals, (v) => v.y, lo + 0.5);
        i < horizontals.length && horizontals[i].y < hi - 0.5;
        i++
      )
        if (a.x > horizontals[i].lo + 0.5 && a.x < horizontals[i].hi - 0.5)
          cost += COST.crossing;
    }
    segCost.set(key, cost);
    return cost;
  };
  const id = (x: number, y: number, d: number) => (y * nx + x) * 5 + d;
  const g = new Map<number, number>();
  const parent = new Map<number, number>();
  const heap = new Heap();
  const h = (x: number, y: number) =>
    Math.min(
      ...goals.map((q) => Math.abs(X[x] - q.at.x) + Math.abs(Y[y] - q.at.y)),
    );
  for (const s of starts) {
    const x = xi.get(s.at.x),
      y = yi.get(s.at.y);
    if (x === undefined || y === undefined || inside(s.at)) continue;
    const lead =
      ends.fromStub > 0 ? stepCost(from, s.at, -1 - DIR_OF[s.exit]) : 0;
    if (lead === Infinity) continue;
    const d = ends.fromStub > 0 ? DIR_OF[s.exit] : 4;
    const k = id(x, y, d);
    const cost = ends.fromStub + lead;
    if (cost < (g.get(k) ?? Infinity)) {
      g.set(k, cost);
      heap.push(cost + h(x, y), k);
    }
  }
  let found:
    { total: number; key: number; goal: (typeof goals)[number] } | undefined;
  const settled = new Set<number>();
  while (heap.size) {
    const { f, v } = heap.pop();
    if (found && f >= found.total) break;
    if (settled.has(v)) continue;
    settled.add(v);
    const d = v % 5,
      cell = (v - d) / 5,
      x = cell % nx,
      y = (cell - x) / nx;
    const here = { x: X[x], y: Y[y] };
    const cost = g.get(v)!;
    for (const q of goals)
      if (near(q.at.x, here.x) && near(q.at.y, here.y)) {
        const free = ends.toStub === 0;
        const bend = !free && d !== 4 && d !== q.last ? COST.bend : 0;
        const turnBack = !free && d !== 4 && (d + 2) % 4 === q.last;
        const tail =
          ends.toStub > 0 ? stepCost(q.at, to, -10 - DIR_OF[q.entry]) : 0;
        if (turnBack || tail === Infinity) continue;
        const total = cost + bend + ends.toStub + tail;
        if (!found || total < found.total) found = { total, key: v, goal: q };
      }
    for (let nd = 0; nd < 4; nd++) {
      if (d !== 4 && (d + 2) % 4 === nd) continue;
      const tx = x + STEP[nd].x,
        ty = y + STEP[nd].y;
      if (tx < 0 || ty < 0 || tx >= nx || ty >= ny) continue;
      const there = { x: X[tx], y: Y[ty] };
      if (inside(there)) continue;
      const edge = Math.min(y * nx + x, ty * nx + tx) * 2 + (nd % 2);
      const step = stepCost(here, there, edge);
      if (step === Infinity) continue;
      const next =
        cost +
        Math.abs(there.x - here.x) +
        Math.abs(there.y - here.y) +
        (d !== 4 && d !== nd ? COST.bend : 0) +
        step;
      const k = id(tx, ty, nd);
      if (next < (g.get(k) ?? Infinity)) {
        g.set(k, next);
        parent.set(k, v);
        heap.push(next + h(tx, ty), k);
      }
    }
  }
  if (!found) return undefined;
  const cells: Pt[] = [];
  for (
    let k: number | undefined = found.key;
    k !== undefined;
    k = parent.get(k)
  ) {
    const cell = (k - (k % 5)) / 5;
    cells.push({ x: X[cell % nx], y: Y[Math.floor(cell / nx)] });
  }
  cells.reverse();
  const exit =
    ends.fromStub > 0
      ? starts.find(
          (s) => near(s.at.x, cells[0].x) && near(s.at.y, cells[0].y),
        )!.exit
      : ends.exits[0];
  return {
    points: simplifyPoints([from, ...cells, to]),
    exit,
    entry: found.goal.entry,
  };
}

/**
 * The best orthogonal route between two ends: the ordinary route when it is clean,
 * otherwise the cheapest of a family of detours along the edges of nearby bodies.
 */
export function searchRoute(ends: Ends, input: Context): Pt[] {
  const { from, to } = ends;
  if (near(from.x, to.x) && near(from.y, to.y)) return [from];
  // A body that already holds an end (a dot dropped on a block) cannot be avoided.
  const holds = (r: Rect, p: Pt) =>
    p.x > r.x + 1 &&
    p.x < r.x + r.width - 1 &&
    p.y > r.y + 1 &&
    p.y < r.y + r.height - 1;
  const ctx = {
    ...input,
    rects: input.rects.filter((r) => !holds(r, from) && !holds(r, to)),
  };
  const valid = (raw: Pt[], exit: Position, entry: Position) => {
    const points = simplifyPoints(raw);
    if (points.length < 2 || !orthogonal(points) || selfIntersects(points))
      return undefined;
    if (ends.fromStub > 0 && segmentExit(points[0], points[1]) !== exit)
      return undefined;
    if (
      ends.toStub > 0 &&
      segmentExit(points.at(-1)!, points.at(-2)!) !== entry
    )
      return undefined;
    return points;
  };
  let best: { points: Pt[]; cost: number } | undefined;
  let local = ctx;
  const narrow = (reach: number) => {
    if (!Number.isFinite(reach)) return ctx;
    const box = {
      x: Math.min(from.x, to.x) - reach - NAME_LANE,
      y: Math.min(from.y, to.y) - reach - NAME_LANE,
      x1: Math.max(from.x, to.x) + reach + NAME_LANE,
      y1: Math.max(from.y, to.y) + reach + NAME_LANE,
    };
    const inside = (x0: number, y0: number, x1: number, y1: number) =>
      !(x0 > box.x1 || x1 < box.x || y0 > box.y1 || y1 < box.y);
    return {
      ...ctx,
      rects: ctx.rects.filter((r) =>
        inside(r.x, r.y, r.x + r.width, r.y + r.height),
      ),
      labels: ctx.labels.filter((r) =>
        inside(r.x, r.y, r.x + r.width, r.y + r.height),
      ),
      occupied: ctx.occupied.filter((g) =>
        inside(
          Math.min(g.a.x, g.b.x),
          Math.min(g.a.y, g.b.y),
          Math.max(g.a.x, g.b.x),
          Math.max(g.a.y, g.b.y),
        ),
      ),
    };
  };
  const consider = (raw: Pt[], exit: Position, entry: Position) => {
    const points = valid(raw, exit, entry);
    if (!points) return;
    const shape = COST.bend * Math.max(0, points.length - 2) + length(points);
    // Penalties only add: a shape that is already too long cannot win.
    if (best && shape >= best.cost - 0.000001) return;
    const cost = shape + penalty(points, local);
    if (!best || cost < best.cost - 0.000001) best = { points, cost };
  };
  const pairs: [Position, Position][] = [];
  for (const exit of ends.exits)
    for (const entry of ends.entries) pairs.push([exit, entry]);
  // The ordinary routes first: a clean one is the answer.
  for (const [exit, entry] of pairs)
    consider(
      ends.fromStub > 0 && ends.toStub > 0
        ? routeBetween(from, to, exit, entry)
        : simplifyPoints(
            ends.fromStub > 0
              ? routeBetween(from, to, exit, undefined)
              : [...routeBetween(to, from, entry, undefined)].reverse(),
          ),
      exit,
      entry,
    );
  // Crossing another net is often unavoidable; anything worse is worth a detour search.
  if (best && penalty(best.points, ctx) < COST.label) return best.points;
  stats.search++;
  for (const reach of [REACH, 3 * REACH, Infinity]) {
    if (reach > REACH) stats.deep++;
    local = narrow(reach + 2 * EXIT_STUB);
    if (best) best = { points: best.points, cost: score(best.points, local) };
    const found = gridRoute(ends, local, reach);
    if (found) consider(found.points, found.exit, found.entry);
    // Only a route through a body is worth a wider search; overlaps and names are not.
    if (best && !bodyHits(best.points, local)) break;
  }
  return best?.points ?? [from, to];
}

type WireEnds = {
  from: Pt;
  to: Pt;
  exit?: Position;
  entry?: Position;
};

function wireEnds(project: Project, wire: Wire): WireEnds | undefined {
  const from = endpointPoint(project, wire.source, wire.sourceHandle);
  const to = endpointPoint(project, wire.target, wire.targetHandle);
  if (!from || !to) return undefined;
  return {
    from,
    to,
    exit: isTap(project, wire.source) ? undefined : sideToPosition(from.side),
    entry: isTap(project, wire.target) ? undefined : sideToPosition(to.side),
  };
}

/** A pinned route as the user drew it: through its bends, leaving and entering along the port normals. */
export function pinnedRoute(project: Project, wire: Wire): Pt[] {
  const ends = wireEnds(project, wire);
  if (!ends) return [];
  const { from, to, entry } = ends;
  const vertices = wire.waypoints ?? [];
  const exit = ends.exit ?? segmentExit(from, vertices[0] ?? to);
  if (!vertices.length) return routeBetween(from, to, exit, entry);
  const points = routeBetween(from, vertices[0], exit);
  for (const vertex of vertices.slice(1)) {
    const last = points.at(-1)!;
    if (near(last.x, vertex.x) || near(last.y, vertex.y)) points.push(vertex);
    else points.push({ x: vertex.x, y: last.y }, vertex);
  }
  const last = points.at(-1)!;
  return simplifyRoute(
    [
      ...points,
      ...routeBetween(last, to, segmentExit(last, to), entry, 0).slice(1),
    ],
    ends.exit,
    entry,
  );
}

/** Whether a pinned route can still be drawn as pinned on this sheet. */
function pinnedValid(points: Pt[], rects: Rect[]) {
  if (points.length < 2 || !orthogonal(points) || selfIntersects(points))
    return false;
  for (let i = 1; i < points.length; i++)
    for (const r of rects)
      if (segmentHitsRect(points[i - 1], points[i], r)) return false;
  return true;
}

/**
 * Routes by their inputs. A wire's route only depends on its ends and on what lies near
 * them, so a sheet where one block moved re-routes only the wires around that block.
 */
export const stats = { sheets: 0, search: 0, deep: 0, memo: 0 };
const memo = new Map<string, Pt[]>();
const MEMO_LIMIT = 20000;

function region(ends: WireEnds) {
  return {
    x: Math.min(ends.from.x, ends.to.x) - REACH,
    y: Math.min(ends.from.y, ends.to.y) - REACH,
    x1: Math.max(ends.from.x, ends.to.x) + REACH,
    y1: Math.max(ends.from.y, ends.to.y) + REACH,
  };
}

function memoKey(ends: WireEnds, ctx: Context) {
  const box = region(ends);
  const inside = (r: Rect) =>
    !(
      r.x > box.x1 ||
      r.x + r.width < box.x ||
      r.y > box.y1 ||
      r.y + r.height < box.y
    );
  const parts: (string | number)[] = [
    ends.from.x,
    ends.from.y,
    ends.to.x,
    ends.to.y,
    ends.exit ?? '*',
    ends.entry ?? '*',
    '|',
  ];
  for (const r of ctx.rects)
    if (inside(r)) parts.push(r.x, r.y, r.width, r.height);
  parts.push('|');
  for (const r of ctx.labels)
    if (inside(r)) parts.push(r.x, r.y, r.width, r.height);
  parts.push('|');
  for (const r of ctx.ownLabels) parts.push(r.x, r.y, r.width, r.height);
  parts.push('|');
  for (const seg of ctx.occupied) {
    const r = {
      x: Math.min(seg.a.x, seg.b.x),
      y: Math.min(seg.a.y, seg.b.y),
      width: Math.abs(seg.a.x - seg.b.x),
      height: Math.abs(seg.a.y - seg.b.y),
    };
    if (inside(r))
      parts.push(
        seg.net === ctx.net ? 's' : 'o',
        seg.a.x,
        seg.a.y,
        seg.b.x,
        seg.b.y,
      );
  }
  return parts.join(',');
}

function autoRoute(
  project: Project,
  wire: Wire,
  ctx: Context,
): Pt[] | undefined {
  const ends = wireEnds(project, wire);
  if (!ends) return undefined;
  const key = memoKey(ends, ctx);
  const known = memo.get(key);
  if (known) {
    stats.memo++;
    return known;
  }
  const points = searchRoute(
    {
      from: ends.from,
      to: ends.to,
      exits: ends.exit ? [ends.exit] : SIDES,
      fromStub: ends.exit ? EXIT_STUB : 0,
      entries: ends.entry ? [ends.entry] : SIDES,
      toStub: ends.entry ? EXIT_STUB : 0,
    },
    ctx,
  );
  const route = eraseLoops(points, ends.exit, ends.entry);
  // A route that had to look past the region depends on more than the key describes.
  const box = region(ends);
  if (
    route.every(
      (p) => p.x >= box.x && p.x <= box.x1 && p.y >= box.y && p.y <= box.y1,
    )
  ) {
    if (memo.size >= MEMO_LIMIT) memo.clear();
    memo.set(key, route);
  }
  return route;
}

export type SheetRoutes = {
  routes: Map<string, Pt[]>;
  /** Wires whose pinned bends could not be used; they are drawn automatically. */
  released: Set<string>;
  /** Pinned wires drawn with a loop cut out; their bends are stored as drawn. */
  reshaped: Set<string>;
};

const cache = new WeakMap<Project, SheetRoutes>();

/** Every wire's drawn route on this sheet. Pure and cached per project object. */
export function routeSheet(project: Project): SheetRoutes {
  const cached = cache.get(project);
  if (cached) return cached;
  stats.sheets++;
  const sheet = sheetOf(project);
  const rects = [...sheet.bodies.values()];
  const labelRects = [...sheet.labels.entries()];
  const netOf = netOfWire(project);
  const routes = new Map<string, Pt[]>();
  const released = new Set<string>();
  const reshaped = new Set<string>();
  const occupied: Segment[] = [];
  const occupy = (wire: Wire, points: Pt[]) => {
    const net = netOf(wire);
    for (let i = 1; i < points.length; i++)
      occupied.push({ a: points[i - 1], b: points[i], net });
  };
  const auto: Wire[] = [];
  // Pinned routes first: they are the user's drawing, and automatic wires keep off them.
  for (const wire of project.wires) {
    // No pinned bends ([] included) leaves the whole shape to the router.
    if (!wire.waypoints?.length) {
      auto.push(wire);
      continue;
    }
    const raw = pinnedRoute(project, wire);
    const ends = wireEnds(project, wire);
    // A loop left by a move is cut out; what remains is still the user's drawing.
    const points = eraseLoops(raw, ends?.exit, ends?.entry);
    if (pinnedValid(points, rects)) {
      routes.set(wire.id, points);
      occupy(wire, points);
      if (
        points.length !== raw.length ||
        points.some((p, i) => !near(p.x, raw[i].x) || !near(p.y, raw[i].y))
      )
        reshaped.add(wire.id);
    } else {
      released.add(wire.id);
      auto.push(wire);
    }
  }
  // Short connections first: they take the straight lines, longer ones go around them.
  const span = (w: Wire) => {
    const e = wireEnds(project, w);
    return e ? Math.abs(e.from.x - e.to.x) + Math.abs(e.from.y - e.to.y) : 0;
  };
  auto.sort((a, b) => span(a) - span(b) || a.id.localeCompare(b.id));
  for (const wire of auto) {
    const net = netOf(wire);
    const own = new Set([wire.source, wire.target]);
    const points = autoRoute(project, wire, {
      rects,
      labels: labelRects.filter(([id]) => !own.has(id)).map(([, r]) => r),
      ownLabels: labelRects.filter(([id]) => own.has(id)).map(([, r]) => r),
      occupied,
      net,
    });
    if (!points) continue;
    routes.set(wire.id, points);
    occupy(wire, points);
  }
  const result = { routes, released, reshaped };
  cache.set(project, result);
  return result;
}

/**
 * Store what is drawn: pinned bends that can no longer be used are cleared, so the wire
 * is automatic again, and a pinned route that lost a loop keeps the route as drawn.
 */
export function settleRoutes(project: Project): Project {
  if (!project.wires.some((w) => w.waypoints?.length)) return project;
  const { routes, released, reshaped } = routeSheet(project);
  if (!released.size && !reshaped.size) return project;
  const wires = project.wires.map((w) => {
    if (released.has(w.id)) {
      const { waypoints: _drop, ...rest } = w;
      return rest;
    }
    if (reshaped.has(w.id))
      return { ...w, waypoints: routes.get(w.id)!.slice(1, -1) };
    return w;
  });
  return { ...project, wires };
}
