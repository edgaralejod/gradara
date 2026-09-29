/**
 * The sheet grid: one pitch that every block corner, block size, and port lands on.
 *
 * Wires look straight only when the two ports they join sit on the same line. With
 * ports placed as fractions of a block's height, a resized block's ports drift off
 * any common line by a pixel or two. So geometry follows three rules instead:
 *
 * 1. Block positions are multiples of GRID.
 * 2. Block widths and heights are multiples of 2·GRID, so a block's center, and the
 *    center of every side, is on the grid too, and a quarter turn about the center
 *    keeps the block on the grid.
 * 3. Ports on a side are spread evenly and symmetrically about its middle, at whole
 *    grid steps from the side's start (`gridPortOffsets`).
 *
 * Together these put every port on a grid point, so two ports can always be lined
 * up exactly by moving a block whole grid steps.
 */
export const GRID = 8;
/** Sizes step in two grid units so centers stay on the grid. */
export const SIZE_STEP = GRID * 2;

export const snap = (value: number) => Math.round(value / GRID) * GRID;
export const snapPoint = (p: { x: number; y: number }) => ({
  x: snap(p.x),
  y: snap(p.y),
});

/** The nearest size step, never below `min` (itself rounded up to a size step). */
export function snapLength(value: number, min = SIZE_STEP) {
  const floor = Math.ceil(min / SIZE_STEP) * SIZE_STEP;
  return Math.max(floor, Math.round(value / SIZE_STEP) * SIZE_STEP);
}

export function snapSize(
  size: { width: number; height: number },
  min: { width: number; height: number } = {
    width: SIZE_STEP,
    height: SIZE_STEP,
  },
) {
  return {
    width: snapLength(size.width, min.width),
    height: snapLength(size.height, min.height),
  };
}

/**
 * Where `count` ports go along a side of `length` (a multiple of SIZE_STEP), in
 * units from the side's start. Spacing is a whole number of grid steps, as close as
 * possible to the classic (i + 1) / (count + 1) spread, and the group is centered on
 * the side's middle.
 *
 * An even count straddles the middle, so it is exactly centered only when its
 * spacing is an even number of steps. When an odd number of steps fits the side much
 * better (dense terminals, where labels need the room), the group sits half a step
 * toward the side's start instead.
 */
export function gridPortOffsets(length: number, count: number): number[] {
  if (count <= 0) return [];
  const middle = length / 2;
  if (count === 1) return [middle];
  const ideal = length / (count + 1);
  // Keep the outer ports at least one step inside the corners when the side allows it.
  const widest = Math.max(
    GRID,
    Math.floor((length - 2 * GRID) / (count - 1) / GRID) * GRID,
  );
  const offCenter = (spacing: number) =>
    count % 2 === 0 && (spacing / GRID) % 2 === 1;
  let spacing = GRID;
  let best = Infinity;
  for (let s = GRID; s <= widest; s += GRID) {
    // Being half a step off center costs about half a step of spacing error; ties
    // go to the wider spread, which leaves more room for labels.
    const score = Math.abs(s - ideal) + (offCenter(s) ? GRID / 2 : 0);
    if (score <= best) [best, spacing] = [score, s];
  }
  // On a grid-sized side every offset below is a grid step. Off-grid sides (documents
  // not yet normalized) keep the same spread about their middle.
  const first =
    middle - (spacing * (count - 1)) / 2 - (offCenter(spacing) ? GRID / 2 : 0);
  return Array.from({ length: count }, (_, i) => first + i * spacing);
}

/** A free offset (a fraction of the side, 0 to 1) moved to the nearest grid step. */
export const snapOffset = (fraction: number, length: number) =>
  Math.min(length, Math.max(0, snap(fraction * length)));

type Sized = {
  position: { x: number; y: number };
  size?: { width: number; height: number };
};

/**
 * Put a sheet on the grid: block corners, block sizes, pinned wire bends, and
 * junctions. Returns the same object when everything is already on the grid, so
 * running it on every edit is cheap. Older documents move by at most a few units
 * the first time they open.
 */
export function gridSheet<
  T extends {
    blocks: (Sized & { rotation?: number })[];
    wires: { waypoints?: { x: number; y: number }[] }[];
    junctions?: { position: { x: number; y: number } }[];
  },
>(
  sheet: T,
  sizeOf: (block: T['blocks'][number]) => { width: number; height: number },
  minOf: (block: T['blocks'][number]) => { width: number; height: number },
): T {
  let changed = false;
  const blocks = sheet.blocks.map((b) => {
    const current = sizeOf(b);
    const size = snapSize(current, minOf(b));
    // Grow or shrink about the center, then put the corner on the grid.
    const position = snapPoint({
      x: b.position.x + (current.width - size.width) / 2,
      y: b.position.y + (current.height - size.height) / 2,
    });
    const same =
      b.size &&
      b.size.width === size.width &&
      b.size.height === size.height &&
      position.x === b.position.x &&
      position.y === b.position.y;
    if (same) return b;
    changed = true;
    return { ...b, position, size };
  });
  const onGrid = (p: { x: number; y: number }) =>
    p.x === snap(p.x) && p.y === snap(p.y);
  const wires = sheet.wires.map((w) => {
    if (!w.waypoints?.length || w.waypoints.every(onGrid)) return w;
    changed = true;
    return { ...w, waypoints: w.waypoints.map(snapPoint) };
  });
  const junctions = sheet.junctions?.map((j) => {
    if (onGrid(j.position)) return j;
    changed = true;
    return { ...j, position: snapPoint(j.position) };
  });
  if (!changed) return sheet;
  return { ...sheet, blocks, wires, ...(junctions ? { junctions } : {}) };
}
