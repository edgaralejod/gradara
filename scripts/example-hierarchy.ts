// SPDX-License-Identifier: Apache-2.0
/**
 * Helpers for example builders that group a flat model into subsystems: readable
 * instance IDs (so result keys read `power.vout.y`), named subsystem ports placed
 * level with what they feed, and routes redrawn on every sheet.
 */
import type { Project } from '../lib/gradara/model';
import { defaultBlockSize } from '../lib/gradara/block-design';
import { portPoint } from '../lib/gradara/ports';
import {
  groupIntoSubsystem,
  scopeView,
  syncInstances,
  writeScope,
} from '../lib/gradara/hierarchy';
import { normalizeProject } from '../lib/gradara/normalize-project';
import { flattenWires, netKeys } from '../lib/gradara/net';
import { linkEnds } from '../lib/gradara/project';

/** Group `ids` into a subsystem named `name` whose instance gets the ID `id`. */
export function groupAs(
  project: Project,
  ids: string[],
  name: string,
  id: string,
): Project {
  const grouped = groupIntoSubsystem(project, ids, name);
  if (!grouped) throw new Error(`Could not group ${name}`);
  const from = grouped.instanceId;
  const text = JSON.stringify(syncInstances(grouped.project))
    .replaceAll(`"${from}"`, `"${id}"`)
    .replaceAll(`"${from}.`, `"${id}.`);
  return JSON.parse(text) as Project;
}

/** Name the ports of subsystem `name`: `block.port` on a port's net inside → its name. */
export function namePorts(
  project: Project,
  name: string,
  names: Record<string, string>,
): Project {
  for (const sub of project.subsystems ?? []) {
    if (sub.name !== name) continue;
    const view = { ...project, ...sub, junctions: sub.junctions ?? [] };
    for (const b of sub.blocks) {
      if (!b.definition.boundary) continue;
      // Any port on the boundary's net may name it.
      const onNet = netKeys(view as Project, {
        id: b.id,
        handle: b.definition.ports[0].id,
      });
      const key = Object.keys(names).find((k) => onNet.has(k));
      if (key) b.definition.name = names[key];
    }
  }
  return syncInstances(project);
}

/** Every subsystem port sits level with the port it connects to, a short run away. */
export function placePorts(project: Project, gap = 96): Project {
  for (const sub of project.subsystems ?? [])
    for (const b of sub.blocks) {
      if (!b.definition.boundary) continue;
      const w = sub.wires.find((w) => w.source === b.id || w.target === b.id);
      if (!w) continue;
      const [otherId, handle] =
        w.source === b.id
          ? [w.target, w.targetHandle]
          : [w.source, w.sourceHandle];
      const other = sub.blocks.find((o) => o.id === otherId);
      const at = other && portPoint(other, handle);
      if (!at) continue;
      const size = b.size ?? defaultBlockSize(b.definition);
      b.position =
        at.side === 'left'
          ? { x: at.x - gap - size.width, y: at.y - size.height / 2 }
          : at.side === 'right'
            ? { x: at.x + gap, y: at.y - size.height / 2 }
            : at.side === 'top'
              ? { x: at.x - size.width / 2, y: at.y - gap - size.height }
              : { x: at.x - size.width / 2, y: at.y + gap };
      w.waypoints = [];
    }
  return project;
}

/**
 * A sheet redrawn from its connectivity alone: every net is linked again end to
 * end, so no junction or bend left over from before the grouping survives.
 */
function redraw(sheet: Project): Project {
  const links = flattenWires(sheet);
  let fresh: Project = { ...sheet, wires: [], junctions: [], nets: [] };
  for (const w of links)
    fresh = linkEnds(
      fresh,
      { id: w.source, handle: w.sourceHandle },
      { id: w.target, handle: w.targetHandle },
    );
  return normalizeProject(normalizeProject(fresh));
}

/** Redraw the routes on the top sheet and inside each instance in `ids`. */
export function reroute(project: Project, ids: string[]): Project {
  for (const id of ids)
    project = writeScope(project, [id], redraw(scopeView(project, [id])));
  return syncInstances(redraw(project));
}

/** Put the ports of subsystem `name` on the given sides of its block (by port name). */
export function setSides(
  project: Project,
  name: string,
  sides: Record<string, 'left' | 'right' | 'top' | 'bottom'>,
): Project {
  for (const sub of project.subsystems ?? [])
    if (sub.name === name)
      for (const b of sub.blocks)
        if (b.definition.boundary && b.definition.name in sides)
          b.definition.boundary = {
            ...b.definition.boundary,
            side: sides[b.definition.name],
          };
  return syncInstances(project);
}

/** Move top-level blocks so their centers land on the given points. */
export function centers(
  project: Project,
  at: Record<string, [number, number]>,
): Project {
  return {
    ...project,
    blocks: project.blocks.map((b) => {
      if (!(b.id in at)) return b;
      const size = b.size ?? defaultBlockSize(b.definition);
      const [x, y] = at[b.id];
      return {
        ...b,
        size,
        position: { x: x - size.width / 2, y: y - size.height / 2 },
      };
    }),
  };
}

/**
 * Move blocks inside subsystem `name` so their centers land on the given points.
 * A subsystem port is named `@` plus its port name (`@+`, `@heat`).
 */
export function insideCenters(
  project: Project,
  name: string,
  at: Record<string, [number, number]>,
): Project {
  return {
    ...project,
    subsystems: project.subsystems?.map((sub) =>
      sub.name !== name
        ? sub
        : {
            ...sub,
            blocks: sub.blocks.map((b) => {
              const key = b.definition.boundary
                ? `@${b.definition.name}`
                : b.id;
              if (!(key in at)) return b;
              const size = b.size ?? defaultBlockSize(b.definition);
              const [x, y] = at[key];
              return {
                ...b,
                size,
                position: { x: x - size.width / 2, y: y - size.height / 2 },
              };
            }),
          },
    ),
  };
}
