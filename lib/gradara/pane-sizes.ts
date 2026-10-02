/**
 * Pure rules for resizable panes, so they can be tested without a browser.
 */

/**
 * Move the divider after pane `index` by `delta` of the whole stack (a fraction of
 * one): the pane before it grows and the pane after shrinks by the same amount, and
 * neither goes below `min`. Panes further away keep their share.
 */
export function moveDivider(
  fractions: number[],
  index: number,
  delta: number,
  min = 0.12,
): number[] {
  if (index < 0 || index + 1 >= fractions.length) return fractions;
  const pair = fractions[index] + fractions[index + 1];
  const before = Math.min(pair - min, Math.max(min, fractions[index] + delta));
  return fractions.map((f, i) =>
    i === index ? before : i === index + 1 ? pair - before : f,
  );
}

/** Keep a size inside `[min, max]`; a size that is not a finite number becomes `min`. */
export function clampSize(size: number, min: number, max: number): number {
  if (!Number.isFinite(size)) return min;
  return Math.round(Math.min(Math.max(size, min), Math.max(min, max)));
}

/**
 * The size a centred dialog gets when the pointer drags one of its edges by `delta`.
 * The dialog stays centred, so both edges move and the size changes by twice the
 * travel, which keeps the dragged edge under the pointer. `side` is the edge: the
 * right or bottom grows with positive travel, the left or top with negative.
 */
export function dialogSize(
  start: number,
  delta: number,
  side: 'far' | 'near',
  min: number,
  max: number,
): number {
  return clampSize(start + (side === 'far' ? 2 : -2) * delta, min, max);
}
