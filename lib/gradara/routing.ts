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
  return pts
    .map((p, i) => `${i === 0 ? 'M' : 'L'} ${p.x} ${p.y}`)
    .join(' ');
}

function nearly(a: number, b: number) {
  return Math.abs(a - b) <= STRAIGHT_EPS;
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
  const horiz = exit === Position.Left || exit === Position.Right;
  const sign =
    exit === Position.Right || exit === Position.Bottom ? 1 : -1;
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
export function pinRubberBand(from: Pt, to: Pt, exit: Position) {
  const pts = rubberBandPoints(from, to, exit);
  const origin = pts.at(-1) ?? to;
  const prev = pts.at(-2) ?? from;
  return {
    points: pts.slice(1),
    origin,
    exit: segmentExit(prev, origin),
  };
}
