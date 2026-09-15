import { blockSize } from './canvas';
import { snapBlockPosition } from './block-design';
import type { Block, Definition, Port, Project } from './model';
import { portPoint, portSide, positionForPortAt } from './ports';

export const GRID = 20;
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

function alignmentShift(project: Project, block: Block) {
  let best: { x: number; y: number; mag: number; axis: 'x' | 'y' } | undefined;
  for (const wire of project.wires) {
    if (wire.source !== block.id && wire.target !== block.id) continue;
    const mine =
      wire.source === block.id ? wire.sourceHandle : wire.targetHandle;
    const theirs =
      wire.source === block.id ? wire.targetHandle : wire.sourceHandle;
    const otherId = wire.source === block.id ? wire.target : wire.source;
    const other = project.blocks.find((b) => b.id === otherId);
    const a = portPoint(block, mine);
    const b = other ? portPoint(other, theirs) : undefined;
    if (!a || !b) continue;
    const horizontal =
      (a.side === 'left' || a.side === 'right') &&
      (b.side === 'left' || b.side === 'right');
    if (horizontal) {
      const dy = b.y - a.y;
      if (Math.abs(dy) <= ALIGN_SNAP && (!best || Math.abs(dy) < best.mag))
        best = { x: 0, y: dy, mag: Math.abs(dy), axis: 'y' };
    }
    const vertical =
      (a.side === 'top' || a.side === 'bottom') &&
      (b.side === 'top' || b.side === 'bottom');
    if (vertical) {
      const dx = b.x - a.x;
      if (Math.abs(dx) <= ALIGN_SNAP && (!best || Math.abs(dx) < best.mag))
        best = { x: dx, y: 0, mag: Math.abs(dx), axis: 'x' };
    }
  }
  return best ?? { x: 0, y: 0 };
}

/** After a move or resize, pull the block onto a connected port's line if close. */
export function snapMovedBlocks(project: Project, ids: string[]): Project {
  if (!ids.length) return project;
  let blocks = project.blocks;
  for (const id of ids) {
    const block = blocks.find((b) => b.id === id);
    if (!block) continue;
    const shift = alignmentShift({ ...project, blocks }, block);
    if (shift.x === 0 && shift.y === 0) continue;
    blocks = blocks.map((b) =>
      b.id === id
        ? {
            ...b,
            position: { x: b.position.x + shift.x, y: b.position.y + shift.y },
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
  if ('axis' in shift && shift.axis === 'y') snapped.y = position.y + shift.y;
  if ('axis' in shift && shift.axis === 'x') snapped.x = position.x + shift.x;
  return snapped;
}
