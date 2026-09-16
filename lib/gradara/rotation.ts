// SPDX-License-Identifier: Apache-2.0
import type { Block, Project } from './model';
import { blockSize } from './canvas';
import { polylineOfWire } from './net-draw';

/** Rotate each selected block about its own center in one undoable document edit. */
export function rotateBlocks(
  project: Project,
  ids: readonly string[],
): Project {
  const selected = new Set(ids);
  if (!project.blocks.some((b) => selected.has(b.id))) return project;
  const next: Project = {
    ...project,
    blocks: project.blocks.map((b) => {
      if (!selected.has(b.id)) return b;
      const size = blockSize(b);
      return {
        ...b,
        rotation: (((b.rotation ?? 0) + 90) % 360) as Block['rotation'],
        position: {
          x: b.position.x + (size.width - size.height) / 2,
          y: b.position.y + (size.height - size.width) / 2,
        },
        size: { width: size.height, height: size.width },
      };
    }),
  };
  return {
    ...next,
    wires: next.wires.map((w) =>
      selected.has(w.source) || selected.has(w.target)
        ? { ...w, waypoints: polylineOfWire(next, w.id).slice(1, -1) }
        : w,
    ),
  };
}
