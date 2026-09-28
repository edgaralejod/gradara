import type { Project } from './model';
import { bodyOf, labelOf, routeSheet } from './router';

export type Bounds = { x: number; y: number; width: number; height: number };

/**
 * Everything drawn on a sheet: block bodies and names, every wire as routed (a feedback
 * loop can run well outside the blocks), junction dots, and section notes. Fit to view
 * frames this, not just the blocks.
 */
export function sheetBounds(project: Project): Bounds | undefined {
  let x0 = Infinity,
    y0 = Infinity,
    x1 = -Infinity,
    y1 = -Infinity;
  const add = (x: number, y: number, w = 0, h = 0) => {
    x0 = Math.min(x0, x);
    y0 = Math.min(y0, y);
    x1 = Math.max(x1, x + w);
    y1 = Math.max(y1, y + h);
  };
  for (const block of project.blocks) {
    const body = bodyOf(block);
    add(body.x, body.y, body.width, body.height);
    const label = labelOf(block);
    add(label.x, label.y, label.width, label.height);
  }
  for (const points of routeSheet(project).routes.values())
    for (const p of points) add(p.x, p.y);
  for (const j of project.junctions ?? [])
    add(j.position.x - 5, j.position.y - 5, 10, 10);
  // A note is a heading and a detail line in the diagram type sizes.
  for (const a of project.annotations ?? [])
    add(
      a.x,
      a.y,
      Math.max(a.text.length * 10, (a.detail?.length ?? 0) * 8),
      a.detail ? 48 : 24,
    );
  if (!Number.isFinite(x0)) return undefined;
  return { x: x0, y: y0, width: x1 - x0, height: y1 - y0 };
}
