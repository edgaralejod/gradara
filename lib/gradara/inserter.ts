/** Targets that already own double-click (equations, labels, wires, chrome). */
export const CANVAS_INSERT_BLOCKERS =
  '.react-flow__node,.react-flow__handle,.react-flow__resize-control,.react-flow__controls,.react-flow__minimap,.react-flow__panel,.block-label-anchor,.block-name,.engineering-block,.net-toolbar,.net-label,[data-wire-id],[data-junction-id],[data-port-id],.block-inserter,.agent-composer,.empty-model';

export const INSERTER_WIDTH = 300;
export const INSERTER_MAX_HEIGHT = 520;
export const INSERTER_PAD = 12;

type ClosestTarget = { closest: (selector: string) => unknown };

function hasClosest(target: unknown): target is ClosestTarget {
  return !!target && typeof (target as ClosestTarget).closest === 'function';
}

/** Empty pane / background only. Block, wire, and chrome double-clicks stay with their own handlers. */
export function isCanvasInsertDoubleClick(target: unknown): boolean {
  if (!hasClosest(target)) return false;
  if (!target.closest('.react-flow__pane')) return false;
  return !target.closest(CANVAS_INSERT_BLOCKERS);
}

/** Keep a popover fully inside its viewport, preferring the click when it already fits. */
export function clampPopoverPosition(
  click: { x: number; y: number },
  viewport: { width: number; height: number },
  popover: { width: number; height: number } = {
    width: INSERTER_WIDTH,
    height: INSERTER_MAX_HEIGHT,
  },
  pad = INSERTER_PAD,
): { x: number; y: number } {
  const maxW = Math.max(0, viewport.width - 2 * pad);
  const maxH = Math.max(0, viewport.height - 2 * pad);
  const width = Math.min(Math.max(0, popover.width), maxW);
  const height = Math.min(Math.max(0, popover.height), maxH);
  return {
    x: Math.max(pad, Math.min(click.x, viewport.width - width - pad)),
    y: Math.max(pad, Math.min(click.y, viewport.height - height - pad)),
  };
}
