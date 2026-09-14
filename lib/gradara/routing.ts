import { Position } from '@xyflow/react';
import { blockSize } from './canvas';
import type { Block } from './model';

export const STRAIGHT_EPS = 3.5;
export const RETURN_STUB = 22;
export const RETURN_CLEARANCE = 48;
export const RETURN_THRESHOLD = 12;
export const EXIT_STUB = 20;

export type Pt = { x: number; y: number };

type Ends = {
  sourceX: number;
  sourceY: number;
  targetX: number;
  targetY: number;
  sourcePosition: Position;
  targetPosition: Position;
  railY?: number;
  /** Conserving/physical nets are never treated as control feedback. */
  flow?: 'signal' | 'physical';
};

/** A signal wire is feedback when it travels upstream — source sits to the right of the target. */
export function isReturnPath(
  ends: Pick<Ends, 'sourceX' | 'targetX' | 'flow'>,
): boolean {
  if (ends.flow === 'physical') return false;
  return ends.sourceX > ends.targetX + RETURN_THRESHOLD;
}

export function feedbackRailY(source: Block, target: Block): number {
  const a = blockSize(source);
  const b = blockSize(target);
  return (
    Math.max(source.position.y + a.height, target.position.y + b.height) +
    RETURN_CLEARANCE
  );
}

/** Straight forward paths. Return paths ride a rail under the chain. */
export function wirePath(ends: Ends): string {
  if (isReturnPath(ends)) return returnRail(ends);
  const { sourceX, sourceY, targetX, targetY } = ends;
  const dx = targetX - sourceX;
  const dy = targetY - sourceY;
  if (Math.abs(dy) <= STRAIGHT_EPS && Math.abs(dx) >= Math.abs(dy))
    return `M ${sourceX} ${sourceY} L ${targetX} ${targetY}`;
  if (Math.abs(dx) <= STRAIGHT_EPS && Math.abs(dy) >= Math.abs(dx))
    return `M ${sourceX} ${sourceY} L ${targetX} ${targetY}`;
  return manhattan(ends);
}

function returnRail(ends: Ends): string {
  const { sourceX, sourceY, targetX, targetY, sourcePosition, targetPosition } =
    ends;
  const stub = RETURN_STUB;
  const railY = Math.max(
    ends.railY ?? Number.NEGATIVE_INFINITY,
    sourceY + RETURN_CLEARANCE,
    targetY + RETURN_CLEARANCE,
  );
  const leaveX =
    sourcePosition === Position.Left ? sourceX - stub : sourceX + stub;
  const leaveY =
    sourcePosition === Position.Top
      ? sourceY - stub
      : sourcePosition === Position.Bottom
        ? sourceY + stub
        : sourceY;
  const start =
    sourcePosition === Position.Top || sourcePosition === Position.Bottom
      ? `M ${sourceX} ${sourceY} L ${sourceX} ${leaveY} L ${sourceX} ${railY}`
      : `M ${sourceX} ${sourceY} L ${leaveX} ${sourceY} L ${leaveX} ${railY}`;

  if (targetPosition === Position.Bottom)
    return `${start} L ${targetX} ${railY} L ${targetX} ${targetY}`;
  if (targetPosition === Position.Top)
    return `${start} L ${targetX} ${railY} L ${targetX} ${targetY}`;
  const enterX =
    targetPosition === Position.Left ? targetX - stub : targetX + stub;
  return `${start} L ${enterX} ${railY} L ${enterX} ${targetY} L ${targetX} ${targetY}`;
}

function manhattan(ends: Ends): string {
  return pointsToPath(
    rubberBandPoints(
      { x: ends.sourceX, y: ends.sourceY },
      { x: ends.targetX, y: ends.targetY },
      ends.sourcePosition,
    ),
  );
}

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

export function rubberBandPath(from: Pt, to: Pt, exit: Position) {
  return pointsToPath(rubberBandPoints(from, to, exit));
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
export function toward(a: Pt, b: Pt): Position {
  return segmentExit(a, b);
}
export function opposite(side: Position): Position {
  return {
    left: Position.Right,
    right: Position.Left,
    top: Position.Bottom,
    bottom: Position.Top,
  }[side];
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
    // Closely stacked blocks need two vertical legs: a single leg doubles back through a port.
    if (!facing && exit !== entry) {
      const y = nearly(a.y, b.y) ? a.y + RETURN_CLEARANCE : (a.y + b.y) / 2;
      return simplifyPoints([from, a, { x: a.x, y }, { x: b.x, y }, b, to]);
    }
    const x = facing
      ? sourceStub === 0
        ? a.x
        : (a.x + b.x) / 2
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
      const x = nearly(a.x, b.x) ? a.x + RETURN_CLEARANCE : (a.x + b.x) / 2;
      return simplifyPoints([from, a, { x, y: a.y }, { x, y: b.y }, b, to]);
    }
    const y = facing
      ? sourceStub === 0
        ? a.y
        : (a.y + b.y) / 2
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
