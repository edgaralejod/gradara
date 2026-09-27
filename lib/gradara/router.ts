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
import { endpointPoint, isTap } from './net';
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
  label: 150,
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

function netOfWire(project: Project) {
  const map = new Map<string, string>();
  for (const net of project.nets ?? [])
    for (const id of net.wireIds) map.set(id, net.id);
  return (id: string) => map.get(id) ?? `wire:${id}`;
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

function lanes(ends: Ends, rects: Rect[], reach: number) {
  const { from, to } = ends;
  const box = {
    x: Math.min(from.x, to.x) - reach,
    y: Math.min(from.y, to.y) - reach,
    x1: Math.max(from.x, to.x) + reach,
    y1: Math.max(from.y, to.y) + reach,
  };
  const xs = new Set<number>(),
    ys = new Set<number>();
  for (const r of rects) {
    if (
      r.x > box.x1 ||
      r.x + r.width < box.x ||
      r.y > box.y1 ||
      r.y + r.height < box.y
    )
      continue;
    xs.add(r.x - LANE);
    xs.add(r.x + r.width + LANE);
    ys.add(r.y - LANE);
    ys.add(r.y + r.height + LANE);
    ys.add(r.y + r.height + NAME_LANE);
  }
  return { xs, ys };
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
  for (const reach of [REACH, 3 * REACH]) {
    if (reach > REACH) stats.deep++;
    // Candidates stay within the lanes' reach, so only what is near can touch them.
    local = narrow(reach + 2 * EXIT_STUB);
    if (best) best = { points: best.points, cost: score(best.points, local) };
    const { xs, ys } = lanes(ends, ctx.rects, reach);
    for (const [exit, entry] of pairs) {
      const a = outward(from, exit, ends.fromStub),
        b = outward(to, entry, ends.toStub);
      const X = new Set([...xs, a.x, b.x, (a.x + b.x) / 2]);
      const Y = new Set([...ys, a.y, b.y, (a.y + b.y) / 2]);
      const route = (middle: Pt[]) =>
        consider([from, a, ...middle, b, to], exit, entry);
      route([]);
      route([{ x: b.x, y: a.y }]);
      route([{ x: a.x, y: b.y }]);
      for (const x of X)
        route([
          { x, y: a.y },
          { x, y: b.y },
        ]);
      for (const y of Y)
        route([
          { x: a.x, y },
          { x: b.x, y },
        ]);
      for (const x of X)
        for (const y of Y) {
          route([
            { x, y: a.y },
            { x, y },
            { x: b.x, y },
          ]);
          route([
            { x: a.x, y },
            { x, y },
            { x, y: b.y },
          ]);
        }
    }
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
    const net = netOf(wire.id);
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
    const net = netOf(wire.id);
    const own = new Set([wire.source, wire.target]);
    const points = autoRoute(project, wire, {
      rects,
      labels: labelRects.filter(([id]) => !own.has(id)).map(([, r]) => r),
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
