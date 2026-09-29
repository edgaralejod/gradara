import { blockSize } from './canvas';
import { snapBlockPosition } from './block-design';
import type { Block, Definition, Port, Project } from './model';
import { endpointPoint, isTap } from './net';
import { portPoint, portSide, positionForPortAt } from './ports';

import { GRID } from './grid';
export { GRID };
export const STAGE_GAP = 56;
export const ALIGN_SNAP = 16;

export function snapPoint(point: { x: number; y: number }) {
  return {
    x: Math.round(point.x / GRID) * GRID,
    y: Math.round(point.y / GRID) * GRID,
  };
}

function snapX(x: number) {
  return Math.round(x / GRID) * GRID;
}

export function placeAligned(
  from: Block,
  fromPort: Port,
  next: Definition,
  nextPort: Port,
): { x: number; y: number } {
  const origin = portPoint(from, fromPort.id);
  if (!origin) {
    const size = blockSize(from);
    return snapPoint({
      x: from.position.x + size.width + STAGE_GAP,
      y: from.position.y,
    });
  }
  const fromSide = origin.side;
  const toSide = portSide(nextPort);
  let target = { x: origin.x, y: origin.y };
  if (fromSide === 'right' && toSide === 'left')
    target = { x: origin.x + STAGE_GAP, y: origin.y };
  else if (fromSide === 'left' && toSide === 'right')
    target = { x: origin.x - STAGE_GAP, y: origin.y };
  else if (fromSide === 'bottom' && toSide === 'top')
    target = { x: origin.x, y: origin.y + STAGE_GAP };
  else if (fromSide === 'top' && toSide === 'bottom')
    target = { x: origin.x, y: origin.y - STAGE_GAP };
  else if (toSide === 'left') target = { x: origin.x + STAGE_GAP, y: origin.y };
  else target = { x: origin.x - STAGE_GAP, y: origin.y };
  const placed = positionForPortAt(next, nextPort, target);
  return { x: snapX(placed.x), y: placed.y };
}

export function placeDownstream(block: Block, next: Definition) {
  const from =
    block.definition.ports.find((p) => p.direction === 'output') ??
    block.definition.ports.find((p) => p.direction === 'physical') ??
    block.definition.ports[0];
  const to =
    next.ports.find((p) => p.direction === 'input') ??
    next.ports.find((p) => p.direction === 'physical') ??
    next.ports[0];
  if (!from || !to) {
    const size = blockSize(block);
    return snapPoint({
      x: block.position.x + size.width + STAGE_GAP,
      y: block.position.y,
    });
  }
  return placeAligned(block, from, next, to);
}

export function placeAtDrop(
  drop: { x: number; y: number },
  next: Definition,
  nextPort?: Port,
  fromDirection?: Port['direction'],
) {
  const port =
    nextPort ??
    (fromDirection === 'input'
      ? next.ports.find((p) => p.direction === 'output')
      : next.ports.find((p) => p.direction === 'input')) ??
    next.ports[0];
  if (!port) return snapPoint({ x: drop.x + 12, y: drop.y });
  const placed = positionForPortAt(next, port, drop);
  return { x: snapX(placed.x), y: placed.y };
}

/**
 * The point a block's terminal should line up with on one wire: the adjacent saved bend
 * when the wire has one (its first leg is what looks crooked), otherwise the far end
 * (a block terminal or a junction dot).
 */
function alignmentTarget(
  project: Project,
  wire: Project['wires'][number],
  mine: 'source' | 'target',
) {
  const bends = wire.waypoints ?? [];
  if (bends.length) {
    const bend = mine === 'source' ? bends[0] : bends[bends.length - 1];
    return { x: bend.x, y: bend.y, side: undefined };
  }
  const id = mine === 'source' ? wire.target : wire.source;
  const handle = mine === 'source' ? wire.targetHandle : wire.sourceHandle;
  const point = endpointPoint(project, id, handle);
  if (!point) return undefined;
  return {
    x: point.x,
    y: point.y,
    side: isTap(project, id) ? undefined : point.side,
  };
}

/**
 * Independent snaps for both axes: a connected terminal close to a horizontal line snaps
 * vertically onto it, and one close to a vertical line snaps horizontally, so a block
 * can straighten a signal wire and a shaft at the same time.
 */
function alignmentShift(project: Project, block: Block) {
  let dy: number | undefined;
  let dx: number | undefined;
  for (const wire of project.wires) {
    const mine =
      wire.source === block.id
        ? 'source'
        : wire.target === block.id
          ? 'target'
          : undefined;
    if (!mine || wire.source === wire.target) continue;
    const a = portPoint(
      block,
      mine === 'source' ? wire.sourceHandle : wire.targetHandle,
    );
    const b = alignmentTarget(project, wire, mine);
    if (!a || !b) continue;
    const horizontal = a.side === 'left' || a.side === 'right';
    // A terminal on the other block must face along the same axis to form a straight run.
    if (b.side && (b.side === 'left' || b.side === 'right') !== horizontal)
      continue;
    if (horizontal) {
      const d = b.y - a.y;
      if (
        Math.abs(d) <= ALIGN_SNAP &&
        (dy === undefined || Math.abs(d) < Math.abs(dy))
      )
        dy = d;
    } else {
      const d = b.x - a.x;
      if (
        Math.abs(d) <= ALIGN_SNAP &&
        (dx === undefined || Math.abs(d) < Math.abs(dx))
      )
        dx = d;
    }
  }
  return { x: dx, y: dy };
}

/** After a move or resize, pull the block onto a connected port's line if close. */
export function snapMovedBlocks(project: Project, ids: string[]): Project {
  if (!ids.length) return project;
  let blocks = project.blocks;
  for (const id of ids) {
    const block = blocks.find((b) => b.id === id);
    if (!block) continue;
    const shift = alignmentShift({ ...project, blocks }, block);
    if (!shift.x && !shift.y) continue;
    blocks = blocks.map((b) =>
      b.id === id
        ? {
            ...b,
            position: {
              x: b.position.x + (shift.x ?? 0),
              y: b.position.y + (shift.y ?? 0),
            },
          }
        : b,
    );
  }
  return blocks === project.blocks ? project : { ...project, blocks };
}

/** A nearby connected port wins over the placement grid, including in legacy layouts. */
export function snapDraggedBlockPosition(
  project: Project,
  id: string,
  position: Block['position'],
  movingIds: string[] = [],
) {
  const original = project.blocks.find((b) => b.id === id);
  if (!original) return position;
  const block = { ...original, position };
  const snapped = snapBlockPosition(position, blockSize(block));
  const moving = new Set(movingIds);
  const external = {
    ...project,
    wires: project.wires.filter(
      (w) => !(moving.has(w.source) && moving.has(w.target)),
    ),
  };
  const shift = alignmentShift(external, block);
  if (shift.y !== undefined) snapped.y = position.y + shift.y;
  if (shift.x !== undefined) snapped.x = position.x + shift.x;
  return snapped;
}
