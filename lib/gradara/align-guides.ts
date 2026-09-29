/**
 * Smart alignment while dragging, as in Visio and Simulink: when the moving block (or
 * the bounding box of a moving group) comes within a few screen pixels of lining up
 * an edge or center with another block, it snaps there and a guide shows the line.
 * The pull is small, so moving a little further escapes it, and holding Alt turns it
 * off. Blocks sit on the sheet grid, so every edge and center is a grid line and a
 * guided position is still on the grid.
 */
export type Rect = { x: number; y: number; width: number; height: number };
export type AlignGuide = {
  axis: 'x' | 'y';
  /** The shared coordinate: an x for a vertical guide, a y for a horizontal one. */
  value: number;
  /** Extent of the guide along the other axis, covering both aligned rectangles. */
  from: number;
  to: number;
};

/** Screen pixels within which an edge or center is pulled into line. */
export const ALIGN_GUIDE_PX = 6;

const lines = (r: Rect, axis: 'x' | 'y') =>
  axis === 'x'
    ? [r.x, r.x + r.width / 2, r.x + r.width]
    : [r.y, r.y + r.height / 2, r.y + r.height];

/**
 * The shift that lines `moving` up with the nearest of `others` on each axis, within
 * `tolerance` sheet units, and the guides to draw. Axes in `skip` are left alone (a
 * connected wire already decided them).
 */
export function alignToNeighbors(
  moving: Rect,
  others: Rect[],
  tolerance: number,
  skip: { x?: boolean; y?: boolean } = {},
): { dx?: number; dy?: number; guides: AlignGuide[] } {
  const result: { dx?: number; dy?: number; guides: AlignGuide[] } = {
    guides: [],
  };
  for (const axis of ['x', 'y'] as const) {
    if (skip[axis]) continue;
    let best: number | undefined;
    for (const other of others)
      for (const target of lines(other, axis))
        for (const own of lines(moving, axis)) {
          const d = target - own;
          if (
            Math.abs(d) <= tolerance &&
            (best === undefined || Math.abs(d) < Math.abs(best))
          )
            best = d;
        }
    if (best === undefined) continue;
    const shift = best;
    const placed: Rect =
      axis === 'x'
        ? { ...moving, x: moving.x + shift }
        : { ...moving, y: moving.y + shift };
    // Every line this shift makes coincide gets a guide, like Visio's.
    const cross = axis === 'x' ? 'y' : 'x';
    const size = axis === 'x' ? 'height' : 'width';
    const shown = new Map<number, AlignGuide>();
    for (const other of others)
      for (const target of lines(other, axis))
        if (lines(placed, axis).some((own) => Math.abs(own - target) < 1e-6)) {
          const from = Math.min(placed[cross], other[cross]);
          const to = Math.max(
            placed[cross] + placed[size],
            other[cross] + other[size],
          );
          const guide = shown.get(target);
          shown.set(
            target,
            guide
              ? {
                  ...guide,
                  from: Math.min(guide.from, from),
                  to: Math.max(guide.to, to),
                }
              : { axis, value: target, from, to },
          );
        }
    result.guides.push(...shown.values());
    if (axis === 'x') result.dx = shift;
    else result.dy = shift;
  }
  return result;
}

export function boundsOf(rects: Rect[]): Rect | undefined {
  if (!rects.length) return undefined;
  const x = Math.min(...rects.map((r) => r.x)),
    y = Math.min(...rects.map((r) => r.y));
  return {
    x,
    y,
    width: Math.max(...rects.map((r) => r.x + r.width)) - x,
    height: Math.max(...rects.map((r) => r.y + r.height)) - y,
  };
}
