import { Position } from '@xyflow/react';
import { blockSize } from './canvas';
import { defaultBlockSize } from './block-design';
import type { Block, Definition, Port } from './model';
import { gridPortOffsets, snapOffset } from './grid';

export type Side = 'left' | 'right' | 'top' | 'bottom';
export type PortPoint = { x: number; y: number; side: Side };

export function portSide(port: Port): Side {
  return port.side ?? (port.direction === 'input' ? 'left' : 'right');
}

/**
 * Where a port sits along its side, in percent from the side's start. Given the
 * side's length, the answer is on the sheet grid (see grid.ts), so ports of
 * blocks on the grid line up exactly.
 */
export function portOffset(
  definition: Definition,
  port: Port,
  length?: number,
): number {
  const side = portSide(port);
  if (typeof port.offset === 'number')
    return length
      ? (snapOffset(port.offset / 100, length) / length) * 100
      : port.offset;
  const peers = definition.ports.filter((p) => portSide(p) === side);
  const index = peers.indexOf(port);
  if (!length) return ((index + 1) / (peers.length + 1)) * 100;
  return (gridPortOffsets(length, peers.length)[index] / length) * 100;
}

/** The length of a port's side before rotation, for a block drawn at `size` (after rotation). */
export function sideLength(
  port: Port,
  size: { width: number; height: number },
  rotation = 0,
) {
  const vertical = ['left', 'right'].includes(portSide(port));
  const turned = rotation % 180 !== 0;
  return vertical !== turned ? size.height : size.width;
}

/** Port geometry after clockwise rotation, including asymmetric offsets. */
export function portPlacement(
  definition: Definition,
  port: Port,
  rotation = 0,
  size?: { width: number; height: number },
) {
  let side = portSide(port);
  let offset = portOffset(
    definition,
    port,
    size ? sideLength(port, size, rotation) : undefined,
  );
  const clockwise: Record<Side, Side> = {
    left: 'top',
    top: 'right',
    right: 'bottom',
    bottom: 'left',
  };
  for (let turn = 0; turn < rotation / 90; turn++) {
    if (side === 'left' || side === 'right') offset = 100 - offset;
    side = clockwise[side];
  }
  return { side, offset };
}

export function portPoint(block: Block, portId: string): PortPoint | undefined {
  const port = block.definition.ports.find((p) => p.id === portId);
  if (!port) return undefined;
  const size = blockSize(block);
  const { side, offset } = portPlacement(
    block.definition,
    port,
    block.rotation,
    size,
  );
  // Percent round trips leave float dust (40 / 96 · 96 ≠ 40); grid ports are whole units.
  const along = (length: number) =>
    Math.round((offset / 100) * length * 1e6) / 1e6;
  const { x, y } = block.position;
  if (side === 'left') return { x, y: y + along(size.height), side };
  if (side === 'right')
    return { x: x + size.width, y: y + along(size.height), side };
  if (side === 'top') return { x: x + along(size.width), y, side };
  return { x: x + along(size.width), y: y + size.height, side };
}

/** Move a block so `portId` sits on `target`. */
export function positionForPortAt(
  definition: Definition,
  port: Port,
  target: { x: number; y: number },
): { x: number; y: number } {
  const size = defaultBlockSize(definition);
  const t = portOffset(definition, port, sideLength(port, size)) / 100;
  const side = portSide(port);
  if (side === 'left') return { x: target.x, y: target.y - t * size.height };
  if (side === 'right')
    return { x: target.x - size.width, y: target.y - t * size.height };
  if (side === 'top') return { x: target.x - t * size.width, y: target.y };
  return { x: target.x - t * size.width, y: target.y - size.height };
}

export function sideToPosition(side: Side): Position {
  return {
    left: Position.Left,
    right: Position.Right,
    top: Position.Top,
    bottom: Position.Bottom,
  }[side];
}
