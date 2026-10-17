// SPDX-License-Identifier: Apache-2.0
import type { Block, Project } from './model';
import { isTagKind } from './tag-blocks';

/**
 * What Results records: only what you ask for, as in Simulink. You log an output port
 * (`Block.logged`), wired or not, so a sensor's output capped by a terminator can be
 * logged; or a signal wire (`Net.logged`), the same thing seen from the wire. With
 * `Project.logPhysical`, the run also records the physical variables of every physical
 * block, shown apart from logged signals. A sensor is not logged because it is a sensor.
 */

type Sheet = Pick<Project, 'blocks' | 'wires' | 'nets'>;

const outputs = (b: Block) =>
  b.definition.ports.filter((p) => p.direction === 'output').map((p) => p.id);

/** The net a block output drives, if any. */
function drivenNet(sheet: Sheet, blockId: string, portId: string) {
  const wire = sheet.wires.find(
    (w) =>
      (w.source === blockId && w.sourceHandle === portId) ||
      (w.target === blockId && w.targetHandle === portId),
  );
  return wire
    ? sheet.nets?.find((n) => n.wireIds.includes(wire.id))
    : undefined;
}

/** Whether an output is logged: on the port itself or on the wire it drives. */
export function isOutputLogged(sheet: Sheet, block: Block, portId: string) {
  return (
    !!block.logged?.includes(portId) ||
    !!drivenNet(sheet, block.id, portId)?.logged
  );
}

const withLogged = (block: Block, ports: string[]): Block => {
  if (ports.length) return { ...block, logged: ports };
  const { logged: _gone, ...rest } = block;
  return rest;
};

/**
 * Log or stop logging outputs of blocks on a sheet. Stopping also clears the log mark
 * of the wire an output drives, so an output is either logged or not.
 */
export function setOutputsLogged<T extends Sheet>(
  sheet: T,
  targets: { blockId: string; portId?: string }[],
  on: boolean,
): T {
  const wanted = new Map<string, Set<string> | 'all'>();
  for (const t of targets) {
    if (!t.portId) wanted.set(t.blockId, 'all');
    else if (wanted.get(t.blockId) !== 'all')
      wanted.set(
        t.blockId,
        new Set([...((wanted.get(t.blockId) as Set<string>) ?? []), t.portId]),
      );
  }
  const picked = (b: Block) => {
    const w = wanted.get(b.id);
    if (!w) return [];
    return outputs(b).filter((id) => w === 'all' || w.has(id));
  };
  let changed = false;
  const blocks = sheet.blocks.map((b) => {
    const ports = picked(b);
    if (!ports.length) return b;
    const now = new Set(b.logged ?? []);
    for (const id of ports) on ? now.add(id) : now.delete(id);
    const next = outputs(b).filter((id) => now.has(id));
    if (next.join() === (b.logged ?? []).join()) return b;
    changed = true;
    return withLogged(b, next);
  });
  let nets = sheet.nets;
  if (!on && sheet.nets) {
    const off = new Set(
      sheet.blocks.flatMap((b) =>
        picked(b).flatMap((id) => drivenNet(sheet, b.id, id)?.id ?? []),
      ),
    );
    if (sheet.nets.some((n) => off.has(n.id) && n.logged)) {
      changed = true;
      nets = sheet.nets.map((n) =>
        off.has(n.id) && n.logged ? { ...n, logged: undefined } : n,
      );
    }
  }
  return changed ? { ...sheet, blocks, nets } : sheet;
}

/** Blocks whose outputs "Log all block outputs" takes: not tags or subsystem ports. */
const loggable = (b: Block) =>
  !isTagKind(b.definition.kind) &&
  !b.definition.boundary &&
  outputs(b).length > 0;

/** Log every block output on every sheet of the document. */
export function logAllOutputs(project: Project): Project {
  const all = <T extends Sheet>(sheet: T) =>
    setOutputsLogged(
      sheet,
      sheet.blocks.filter(loggable).map((b) => ({ blockId: b.id })),
      true,
    );
  const top = all(project);
  const subsystems = project.subsystems?.map((s) => all(s));
  return subsystems ? { ...top, subsystems } : top;
}

/** Drop log marks on ports that no longer exist or are no longer outputs. */
export function settleLogged<T extends Pick<Project, 'blocks'>>(sheet: T): T {
  if (!sheet.blocks.some((b) => b.logged)) return sheet;
  let changed = false;
  const blocks = sheet.blocks.map((b) => {
    if (!b.logged) return b;
    const keep = b.logged.filter((id) => outputs(b).includes(id));
    if (keep.length === b.logged.length) return b;
    changed = true;
    return withLogged(b, keep);
  });
  return changed ? { ...sheet, blocks } : sheet;
}

/** The Modelica connector a port is recorded under (a result key's last part). */
const connectorOf = (b: Block, portId: string) =>
  b.definition.modelica?.ports?.[portId] ?? portId;

/**
 * Log the outputs the document's saved plots show, and spell each plot key the way the
 * run records it (`block.connector`, after any instance path). For examples and
 * templates, whose plots should open with data.
 */
export function logPlotted(project: Project): Project {
  let doc = project;
  const plots = (doc.plots ?? []).map((plot) => ({
    ...plot,
    series: plot.series.map((key) => {
      const parts = key.split('.');
      if (parts.length < 2) return key;
      const path = parts.slice(0, -2);
      const [blockId, last] = parts.slice(-2);
      let sheet: Sheet = doc;
      for (const id of path) {
        const ref = sheet.blocks.find((b) => b.id === id)?.definition.subsystem
          ?.ref;
        const inner = ref
          ? doc.subsystems?.find((s) => s.id === ref)
          : undefined;
        if (!inner) return key;
        sheet = inner;
      }
      const block = sheet.blocks.find((b) => b.id === blockId);
      const port = block?.definition.ports.find(
        (p) =>
          p.direction === 'output' &&
          (p.id === last || connectorOf(block, p.id) === last),
      );
      if (!block || !port) return key;
      const logged = setOutputsLogged(
        sheet,
        [{ blockId, portId: port.id }],
        true,
      );
      if (path.length === 0) doc = { ...doc, ...logged };
      else {
        const ref = (logged as { id?: string }).id;
        doc = {
          ...doc,
          subsystems: doc.subsystems?.map((s) =>
            s.id === ref
              ? { ...s, blocks: logged.blocks, nets: logged.nets }
              : s,
          ),
        };
      }
      return [...path, blockId, connectorOf(block, port.id)].join('.');
    }),
  }));
  return { ...doc, plots };
}
