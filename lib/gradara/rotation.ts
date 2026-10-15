// SPDX-License-Identifier: Apache-2.0
import type { Block, Project } from './model';
import { blockSize } from './canvas';

/** Turned or mirrored terminals face new ways: the router draws their wires afresh. */
function rerouted(project: Project, selected: Set<string>): Project {
  return {
    ...project,
    wires: project.wires.map((w) => {
      if (!(selected.has(w.source) || selected.has(w.target))) return w;
      const { waypoints: _drop, ...rest } = w;
      return rest;
    }),
  };
}

/** Rotate each selected block a quarter turn clockwise about its own center, in one undoable edit. */
export function rotateBlocks(
  project: Project,
  ids: readonly string[],
): Project {
  const selected = new Set(ids);
  if (!project.blocks.some((b) => selected.has(b.id))) return project;
  return rerouted(
    {
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
    },
    selected,
  );
}

/**
 * Mirror each selected block along the way its signal flows (Simulink's Flip Block):
 * inputs move to the other side and outputs with them, in place, in one undoable edit.
 * Text stays upright; only the drawing and the terminals mirror.
 */
export function flipBlocks(project: Project, ids: readonly string[]): Project {
  const selected = new Set(ids);
  if (!project.blocks.some((b) => selected.has(b.id))) return project;
  return rerouted(
    {
      ...project,
      blocks: project.blocks.map((b) => {
        if (!selected.has(b.id)) return b;
        const { flip: _was, ...rest } = b;
        return b.flip ? rest : { ...rest, flip: true };
      }),
    },
    selected,
  );
}
