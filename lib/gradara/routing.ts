import { GRID, snap } from './grid';
import { Position } from '@xyflow/react';

/** Two sheet grid steps, so stubs and detour lanes stay on the grid (see grid.ts). */
export const EXIT_STUB = 2 * GRID;

export type Pt = { x: number; y: number };

export function pointsToPath(pts: Pt[]): string {
  if (!pts.length) return '';
  return pts.map((p, i) => `${i === 0 ? 'M' : 'L'} ${p.x} ${p.y}`).join(' ');
}

function nearly(a: number, b: number) {
  return Math.abs(a - b) <= 0.000001;
}

function dedupe(pts: Pt[]): Pt[] {
  const out: Pt[] = [];
  for (const p of pts) {
    const last = out.at(-1);
    if (!last || !nearly(last.x, p.x) || !nearly(last.y, p.y)) out.push(p);
  }
  return out;
}

/**
 * Altium-style rubber band: first segment must leave in `exit` (the pin
 * direction). The rest is one orthogonal elbow to the cursor. A click should
 * pin this geometry; only the unfixed tail keeps following the mouse.
 */
export function rubberBandPoints(
  from: Pt,
  to: Pt,
  exit: Position,
  minStub = EXIT_STUB,
): Pt[] {
  if (nearly(from.x, to.x) && nearly(from.y, to.y)) return [from];
  const horiz = exit === Position.Left || exit === Position.Right;
  const sign = exit === Position.Right || exit === Position.Bottom ? 1 : -1;
  if (horiz) {
    const reach = sign * (to.x - from.x);
    const x = from.x + sign * Math.max(minStub, reach);
    const corner = { x, y: from.y };
    const drop = { x, y: to.y };
    return dedupe([from, corner, drop, to]);
  }
  const reach = sign * (to.y - from.y);
  const y = from.y + sign * Math.max(minStub, reach);
  const corner = { x: from.x, y };
  const drop = { x: to.x, y };
  return dedupe([from, corner, drop, to]);
}

export function segmentExit(a: Pt, b: Pt): Position {
  const dx = b.x - a.x,
    dy = b.y - a.y;
  if (Math.abs(dx) >= Math.abs(dy))
    return dx >= 0 ? Position.Right : Position.Left;
  return dy >= 0 ? Position.Bottom : Position.Top;
}

/** Pin the live rubber band at the cursor. Next exit is the last segment's direction. */
export function pinRubberBand(
  from: Pt,
  to: Pt,
  exit: Position,
  minStub = EXIT_STUB,
) {
  const pts = rubberBandPoints(from, to, exit, minStub);
  const origin = pts.at(-1) ?? to;
  const prev = pts.at(-2) ?? from;
  return {
    points: pts.slice(1),
    origin,
    exit: segmentExit(prev, origin),
  };
}

/** Exact simplification: tolerance-based deduplication can introduce diagonal segments. */
export function simplifyPoints(points: Pt[]): Pt[] {
  const out: Pt[] = [];
  for (const p of points) {
    const last = out.at(-1);
    if (last && nearly(last.x, p.x) && nearly(last.y, p.y)) continue;
    const a = out.at(-2);
    if (
      a &&
      last &&
      ((nearly(a.x, last.x) &&
        nearly(last.x, p.x) &&
        (last.y - a.y) * (p.y - last.y) >= 0) ||
        (nearly(a.y, last.y) &&
          nearly(last.y, p.y) &&
          (last.x - a.x) * (p.x - last.x) >= 0))
    )
      out.pop();
    out.push({ x: p.x, y: p.y });
  }
  return out;
}

/** Remove retraced spurs from a complete route, while preserving both port normals.
 * Unlike a free drawing tail, a completed route has enough context to discard
 * collinear backtracking safely when a block moves past an old bend.
 */
export function simplifyRoute(
  points: Pt[],
  sourceSide?: Position,
  targetSide?: Position,
): Pt[] {
  let out = simplifyPoints(points);
  for (let i = 1; i < out.length - 1;) {
    const a = out[i - 1],
      b = out[i],
      c = out[i + 1];
    if (
      (nearly(a.x, b.x) && nearly(b.x, c.x)) ||
      (nearly(a.y, b.y) && nearly(b.y, c.y))
    ) {
      const next = dedupe(out.filter((_, j) => j !== i));
      if (
        next.length >= 2 &&
        (!sourceSide || segmentExit(next[0], next[1]) === sourceSide) &&
        (!targetSide || segmentExit(next.at(-1)!, next.at(-2)!) === targetSide)
      ) {
        out = next;
        i = Math.max(1, i - 1);
        continue;
      }
    }
    i++;
  }
  return out;
}

export function outward(p: Pt, side: Position, distance = EXIT_STUB): Pt {
  return {
    x:
      p.x +
      (side === Position.Right
        ? distance
        : side === Position.Left
          ? -distance
          : 0),
    y:
      p.y +
      (side === Position.Bottom
        ? distance
        : side === Position.Top
          ? -distance
          : 0),
  };
}
function toward(a: Pt, b: Pt): Position {
  return segmentExit(a, b);
}
/** A completed connection respects both port normals. Free tails use rubberBandPoints. */
export function routeBetween(
  from: Pt,
  to: Pt,
  exit: Position,
  entry?: Position,
  sourceStub = EXIT_STUB,
): Pt[] {
  if (nearly(from.x, to.x) && nearly(from.y, to.y)) return [from];
  const direct = nearly(from.x, to.x) || nearly(from.y, to.y);
  if (
    direct &&
    (toward(from, to) === exit || sourceStub === 0) &&
    (!entry || toward(to, from) === entry)
  )
    return [from, to];
  if (!entry)
    return simplifyPoints(rubberBandPoints(from, to, exit, sourceStub));
  const a = outward(from, exit, sourceStub),
    b = outward(to, entry);
  const h1 = exit === Position.Left || exit === Position.Right;
  const h2 = entry === Position.Left || entry === Position.Right;
  let middle: Pt[];
  if (h1 && h2) {
    const facing =
      (exit === Position.Right && entry === Position.Left && a.x <= b.x) ||
      (exit === Position.Left && entry === Position.Right && a.x >= b.x);
    // Opposite ports that point away from each other (the target is behind the source)
    // need an S: two legs across, so neither stub doubles back on itself.
    if (!facing && exit !== entry) {
      const y = nearly(a.y, b.y) ? a.y + EXIT_STUB : snap((a.y + b.y) / 2);
      return simplifyPoints([from, a, { x: a.x, y }, { x: b.x, y }, b, to]);
    }
    const x = facing
      ? sourceStub === 0
        ? a.x
        : snap((a.x + b.x) / 2)
      : exit === Position.Right
        ? Math.max(a.x, b.x)
        : Math.min(a.x, b.x);
    middle = [
      { x, y: a.y },
      { x, y: b.y },
    ];
  } else if (!h1 && !h2) {
    const facing =
      (exit === Position.Bottom && entry === Position.Top && a.y <= b.y) ||
      (exit === Position.Top && entry === Position.Bottom && a.y >= b.y);
    if (!facing && exit !== entry) {
      const x = nearly(a.x, b.x) ? a.x + EXIT_STUB : snap((a.x + b.x) / 2);
      return simplifyPoints([from, a, { x, y: a.y }, { x, y: b.y }, b, to]);
    }
    const y = facing
      ? sourceStub === 0
        ? a.y
        : snap((a.y + b.y) / 2)
      : exit === Position.Bottom
        ? Math.max(a.y, b.y)
        : Math.min(a.y, b.y);
    middle = [
      { x: a.x, y },
      { x: b.x, y },
    ];
  } else {
    const corner = h1 ? { x: to.x, y: from.y } : { x: from.x, y: to.y };
    if (
      toward(from, corner) === exit &&
      toward(to, corner) === entry &&
      Math.hypot(corner.x - from.x, corner.y - from.y) >= EXIT_STUB &&
      Math.hypot(corner.x - to.x, corner.y - to.y) >= EXIT_STUB
    )
      return simplifyPoints([from, corner, to]);
    middle = h1 ? [{ x: a.x, y: b.y }] : [{ x: b.x, y: a.y }];
  }
  return simplifyPoints([from, a, ...middle, b, to]);
}

export type Rect = { x: number; y: number; width: number; height: number };

/** Whether an orthogonal segment passes through the inside of `r` (running along an edge does not). */
export function segmentHitsRect(a: Pt, b: Pt, r: Rect, inset = 1) {
  const x0 = r.x + inset,
    x1 = r.x + r.width - inset,
    y0 = r.y + inset,
    y1 = r.y + r.height - inset;
  if (x1 <= x0 || y1 <= y0) return false;
  if (nearly(a.y, b.y)) {
    const lo = Math.min(a.x, b.x),
      hi = Math.max(a.x, b.x);
    return a.y > y0 && a.y < y1 && hi > x0 && lo < x1;
  }
  const lo = Math.min(a.y, b.y),
    hi = Math.max(a.y, b.y);
  return a.x > x0 && a.x < x1 && hi > y0 && lo < y1;
}

function reversesAt(a: Pt, b: Pt, c: Pt) {
  const straight =
    (nearly(a.x, b.x) && nearly(b.x, c.x)) ||
    (nearly(a.y, b.y) && nearly(b.y, c.y));
  return straight && (b.x - a.x) * (c.x - b.x) + (b.y - a.y) * (c.y - b.y) < 0;
}

/** The part two orthogonal segments share, as the point nearest `near`, or undefined. */
function meet(a: Pt, b: Pt, c: Pt, d: Pt, near: Pt): Pt | undefined {
  const x0 = Math.max(Math.min(a.x, b.x), Math.min(c.x, d.x)),
    x1 = Math.min(Math.max(a.x, b.x), Math.max(c.x, d.x)),
    y0 = Math.max(Math.min(a.y, b.y), Math.min(c.y, d.y)),
    y1 = Math.min(Math.max(a.y, b.y), Math.max(c.y, d.y));
  if (x0 > x1 + 0.000001 || y0 > y1 + 0.000001) return undefined;
  return {
    x: Math.min(Math.max(near.x, x0), x1),
    y: Math.min(Math.max(near.y, y0), y1),
  };
}

/**
 * A route that crosses or touches itself, or doubles straight back: the loops and hairpins
 * a wire should never show. Adjacent segments only count when they reverse.
 */
export function selfIntersects(points: Pt[]) {
  const pts = simplifyPoints(points);
  for (let i = 1; i < pts.length - 1; i++)
    if (reversesAt(pts[i - 1], pts[i], pts[i + 1])) return true;
  for (let i = 0; i < pts.length - 1; i++)
    for (let j = i + 2; j < pts.length - 1; j++)
      if (meet(pts[i], pts[i + 1], pts[j], pts[j + 1], pts[i])) return true;
  return false;
}

/**
 * Cut every loop out of a route: where it meets itself again, jump straight to the later
 * segment. The first and last runs keep the port normals, so a loop that is the only way
 * out of a terminal stays.
 */
export function eraseLoops(points: Pt[], exit?: Position, entry?: Position) {
  let pts = simplifyPoints(points);
  const keeps = (c: Pt[]) =>
    c.length >= 2 &&
    (!exit || segmentExit(c[0], c[1]) === exit) &&
    (!entry || segmentExit(c.at(-1)!, c.at(-2)!) === entry);
  for (let pass = 0; pass < 32; pass++) {
    let cut: Pt[] | undefined;
    search: for (let i = 0; i < pts.length - 1; i++)
      for (let j = pts.length - 2; j >= i + 2; j--) {
        const p = meet(pts[i], pts[i + 1], pts[j], pts[j + 1], pts[i]);
        if (!p) continue;
        const candidate = simplifyPoints([
          ...pts.slice(0, i + 1),
          p,
          ...pts.slice(j + 1),
        ]);
        if (keeps(candidate) && candidate.length < pts.length + 1) {
          cut = candidate;
          break search;
        }
      }
    if (!cut) break;
    pts = cut;
  }
  return simplifyRoute(pts, exit, entry);
}

function routeHits(points: Pt[], rects: Rect[]) {
  let hits = 0;
  for (let i = 1; i < points.length; i++)
    for (const r of rects)
      if (segmentHitsRect(points[i - 1], points[i], r)) hits++;
  return hits;
}

function routeLength(points: Pt[]) {
  let length = 0;
  for (let i = 1; i < points.length; i++)
    length +=
      Math.abs(points[i].x - points[i - 1].x) +
      Math.abs(points[i].y - points[i - 1].y);
  return length;
}

/** Clearance a detour keeps from a body; below a block it also clears the instance name. */
const LANE = EXIT_STUB;
const NAME_LANE = 5 * GRID;

/**
 * The orthogonal route between two terminals that stays out of `rects` when it can: the
 * ordinary route when that is already clean, otherwise the shortest route with the fewest
 * bends from a family of detours around the rectangles' edges. Never loops or doubles back.
 */
export function routeAround(
  from: Pt,
  to: Pt,
  exit: Position,
  entry: Position,
  rects: Rect[],
  options: { always?: boolean } = {},
): Pt[] {
  const base = routeBetween(from, to, exit, entry);
  if (!options.always && !selfIntersects(base) && routeHits(base, rects) === 0)
    return base;
  const a = outward(from, exit),
    b = outward(to, entry);
  const xs = new Set([a.x, b.x, snap((a.x + b.x) / 2)]);
  const ys = new Set([a.y, b.y, snap((a.y + b.y) / 2)]);
  for (const r of rects) {
    xs.add(r.x - LANE);
    xs.add(r.x + r.width + LANE);
    ys.add(r.y - LANE);
    ys.add(r.y + r.height + LANE);
    ys.add(r.y + r.height + NAME_LANE);
  }
  const middles: Pt[][] = [[], [{ x: b.x, y: a.y }], [{ x: a.x, y: b.y }]];
  for (const x of xs)
    middles.push([
      { x, y: a.y },
      { x, y: b.y },
    ]);
  for (const y of ys)
    middles.push([
      { x: a.x, y },
      { x: b.x, y },
    ]);
  for (const x of xs)
    for (const y of ys)
      middles.push(
        [
          { x, y: a.y },
          { x, y },
          { x: b.x, y },
        ],
        [
          { x: a.x, y },
          { x, y },
          { x, y: b.y },
        ],
      );
  let best: { points: Pt[]; cost: number } | undefined;
  const consider = (raw: Pt[]) => {
    const points = simplifyPoints(raw);
    if (points.length < 2) return;
    for (let i = 1; i < points.length; i++)
      if (
        !nearly(points[i].x, points[i - 1].x) &&
        !nearly(points[i].y, points[i - 1].y)
      )
        return;
    if (segmentExit(points[0], points[1]) !== exit) return;
    if (segmentExit(points.at(-1)!, points.at(-2)!) !== entry) return;
    if (selfIntersects(points)) return;
    const cost =
      routeHits(points, rects) * 100000 +
      (points.length - 2) * 30 +
      routeLength(points);
    if (!best || cost < best.cost - 0.000001) best = { points, cost };
  };
  if (!selfIntersects(base)) consider(base);
  for (const middle of middles) consider([from, a, ...middle, b, to]);
  return best?.points ?? eraseLoops(base, exit, entry);
}
