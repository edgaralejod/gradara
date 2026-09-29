import { GRID, SIZE_STEP, snapPoint } from './grid';
import type { Definition, Port } from './model';

/** Diagram units at 100% zoom. Keep the matching typography tokens in blocks.css. */
export const BLOCK_DESIGN = {
  width: 80,
  height: 64,
  text: 14,
  pitch: 24,
  grid: GRID,
} as const;
export type BlockShape =
  | 'box'
  | 'sum'
  | 'gain'
  | 'mux'
  | 'demux'
  | 'physical'
  | 'ground'
  | 'boundary'
  | 'subsystem';
const physical = new Set([
  'resistor',
  'capacitor',
  'inductor',
  'diode',
  'dcSource',
  'idealSwitch',
  'voltageSensor',
  'currentSensor',
]);
const commutative = new Set(['product', 'min', 'max']);
export const sideOf = (p: Port) =>
  p.side ?? (p.direction === 'input' ? 'left' : 'right');

export function blockShape(d: Definition): BlockShape {
  if (d.boundary) return 'boundary';
  if (d.subsystem) return 'subsystem';
  if (d.kind === 'sum' || d.kind === 'subtract') return 'sum';
  if (physical.has(d.kind)) return 'physical';
  if (['gain', 'mux', 'demux', 'ground'].includes(d.kind))
    return d.kind as BlockShape;
  return 'box';
}

/** Show labels when they disambiguate terminals; don't repeat generic u/y on unary blocks. */
export function showPortLabel(d: Definition, p: Port) {
  const shape = blockShape(d);
  if (shape === 'boundary') return false;
  if (shape === 'subsystem') return true;
  if (shape === 'sum') return p.direction === 'input';
  if (shape !== 'box' && shape !== 'mux' && shape !== 'demux') return false;
  if (commutative.has(d.kind)) return false;
  if (
    d.domain === 'signal' &&
    d.ports.length <= 2 &&
    new Set(d.ports.map((port) => port.direction)).size === d.ports.length
  )
    return false;
  return true;
}

/** Sizes step in two sheet-grid units, so centers and ports stay on the grid. */
function roundGrid(n: number) {
  return Math.ceil(n / SIZE_STEP) * SIZE_STEP;
}

export function defaultBlockSize(d: Definition) {
  const shape = blockShape(d);
  if (shape === 'boundary')
    // Side padding, the domain glyph, and about 8 units per character.
    return {
      width: roundGrid(Math.min(176, 56 + d.name.length * 8)),
      height: 32,
    };
  if (shape === 'sum' || shape === 'ground') return { width: 48, height: 48 };
  if (shape === 'physical')
    return ['top', 'bottom'].includes(
      d.ports.find((p) => p.direction === 'physical')?.side ?? '',
    )
      ? { width: 48, height: 80 }
      : { width: 80, height: 48 };
  if (shape === 'gain') return { width: 80, height: 64 };
  if (shape === 'mux' || shape === 'demux') return { width: 48, height: 96 };
  if (d.kind === 'secondOrder') return { width: 160, height: 64 };
  if (shape === 'subsystem') {
    // Room for the label gutters and a readable window onto the inside.
    const gutter = (side: string) =>
      Math.max(
        10,
        ...d.ports
          .filter((p) => sideOf(p) === side)
          .map((p) => Math.min(42, 12 + p.name.length * 7)),
      );
    const rows = Math.max(
      ...['left', 'right'].map(
        (side) => d.ports.filter((p) => sideOf(p) === side).length,
      ),
      1,
    );
    return {
      width: roundGrid(Math.max(160, gutter('left') + 96 + gutter('right'))),
      height: roundGrid(Math.max(96, (rows + 1) * 24)),
    };
  }
  const labeled = d.ports.some((p) => showPortLabel(d, p));
  if (!labeled)
    return { width: BLOCK_DESIGN.width, height: BLOCK_DESIGN.height };
  const count = (side: string) =>
    d.ports.filter((p) => sideOf(p) === side).length;
  // Reserve a central symbol well and label gutters; dense terminals grow the body, not the font.
  const gutter = (side: string) =>
    Math.max(
      8,
      ...d.ports
        .filter((p) => sideOf(p) === side && showPortLabel(d, p))
        .map((p) => 12 + p.name.length * 7),
    );
  if (
    Math.max(count('left'), count('right'), count('top'), count('bottom')) <=
      1 &&
    gutter('left') + 40 + gutter('right') <= 80
  )
    return { width: 80, height: 64 };
  return {
    width: roundGrid(
      Math.max(
        128,
        gutter('left') + 40 + gutter('right'),
        (Math.max(count('top'), count('bottom')) + 1) * 32,
      ),
    ),
    height: roundGrid(
      Math.max(
        96,
        (Math.max(count('left'), count('right')) + 1) * BLOCK_DESIGN.pitch,
      ),
    ),
  };
}

export function minimumDesignedSize(d: Definition) {
  const size = defaultBlockSize(d);
  if (['sum', 'ground', 'boundary'].includes(blockShape(d))) return size;
  if (blockShape(d) === 'box' && size.width === 80)
    return { width: 64, height: 48 };
  return size;
}

/** Bounded notation only; full precision remains in the inspector and numerical definition. */
export function formatBlockValue(value: number) {
  if (!Number.isFinite(value)) return String(value);
  if (value === 0) return '0';
  const abs = Math.abs(value);
  return abs >= 10000 || abs < 0.001
    ? value
        .toExponential(2)
        .replace(/\.0+(?=e)/, '')
        .replace('e+', 'e')
    : String(Number(value.toPrecision(4)));
}

/**
 * A block's corner on the sheet grid. With sizes in whole size steps, that puts its
 * center and every port on the grid too (see grid.ts).
 */
export function snapBlockPosition(
  position: { x: number; y: number },
  _size?: { width: number; height: number },
) {
  return snapPoint(position);
}
