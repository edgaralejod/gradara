import { Position } from '@xyflow/react';
import { blockSize } from './canvas';
import { defaultBlockSize } from './block-design';
import type { Block, Definition, Port } from './model';

export type Side = 'left' | 'right' | 'top' | 'bottom';
export type PortPoint = { x: number; y: number; side: Side };

export function portSide(port: Port): Side {
  return port.side ?? (port.direction === 'input' ? 'left' : 'right');
}

export function portOffset(definition: Definition, port: Port): number {
  if (typeof port.offset === 'number') return port.offset;
  const side = portSide(port);
  const peers = definition.ports.filter((p) => portSide(p) === side);
  return ((peers.indexOf(port) + 1) / (peers.length + 1)) * 100;
}

export function portPoint(block: Block, portId: string): PortPoint | undefined {
  const port = block.definition.ports.find((p) => p.id === portId);
  if (!port) return undefined;
  const size = blockSize(block);
  const side = portSide(port);
  const t = portOffset(block.definition, port) / 100;
  const { x, y } = block.position;
  if (side === 'left') return { x, y: y + t * size.height, side };
  if (side === 'right')
    return { x: x + size.width, y: y + t * size.height, side };
  if (side === 'top') return { x: x + t * size.width, y, side };
  return { x: x + t * size.width, y: y + size.height, side };
}

/** Move a block so `portId` sits on `target`. */
export function positionForPortAt(
  definition: Definition,
  port: Port,
  target: { x: number; y: number },
): { x: number; y: number } {
  const size = defaultBlockSize(definition);
  const t = portOffset(definition, port) / 100;
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
