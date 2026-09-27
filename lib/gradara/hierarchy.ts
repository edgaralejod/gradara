/**
 * Subsystems: a block whose inside is another diagram of the same document.
 *
 * A definition is stored once in `project.subsystems`; instance blocks refer to it
 * with `definition.subsystem.ref`. Boundary blocks inside (inport, outport,
 * connport) become the instance's ports, keyed by the boundary block's ID.
 *
 * Editing works through a scope: `scopeView` presents the inside of a
 * subsystem as an ordinary Project, so every canvas tool works unchanged, and
 * `writeScope` puts the edited sheet back and brings every instance up to date.
 * The server mirror of these rules is server/hierarchy.py.
 */
import { domainColors, isCausal } from './model';
import type {
  Block,
  Definition,
  Domain,
  Port,
  Project,
  SubsystemDefinition,
  Wire,
} from './model';
import { netComponents } from './net';
import { reconcileNets } from './net-registry';
import { defaultBlockSize, snapBlockPosition } from './block-design';
import { blockSize } from './canvas';
import { portPoint } from './ports';

import {
  boundaryDefinition,
  boundaryKinds,
  type BoundaryKind,
} from './port-blocks';
export { boundaryDefinition, boundaryKinds, type BoundaryKind };

export const isBoundary = (block: Block) =>
  block.definition.kind in boundaryKinds && !!block.definition.boundary;

export const isInstance = (block: Block) => !!block.definition.subsystem;

export const newId = (prefix: string) =>
  `${prefix}${crypto.randomUUID().replaceAll('-', '').slice(0, 10)}`;

export const subsystemsOf = (project: Project) => project.subsystems ?? [];

export const findSubsystem = (project: Project, id: string) =>
  subsystemsOf(project).find((s) => s.id === id);

export function boundaryBlocks(diagram: { blocks: Block[] }) {
  return diagram.blocks
    .filter(isBoundary)
    .sort(
      (a, b) =>
        a.definition.boundary!.order - b.definition.boundary!.order ||
        a.position.y - b.position.y ||
        a.id.localeCompare(b.id),
    );
}

/** The ports an instance exposes, in boundary order. */
export function instancePorts(subsystem: SubsystemDefinition): Port[] {
  return boundaryBlocks(subsystem).map((block) => {
    const inner = block.definition.ports[0];
    const direction = boundaryKinds[block.definition.kind as BoundaryKind];
    return {
      id: block.id,
      name: block.definition.name,
      direction,
      domain: inner.domain,
      ...(inner.unit ? { unit: inner.unit } : {}),
      side:
        block.definition.boundary?.side ??
        (direction === 'input'
          ? 'left'
          : direction === 'output'
            ? 'right'
            : 'left'),
    };
  });
}

/** The definition an instance block carries; instance parameter values survive. */
export function instanceDefinition(
  subsystem: SubsystemDefinition,
  previous?: Definition,
): Definition {
  const ports = instancePorts(subsystem);
  const physical = ports.find((p) => p.direction === 'physical');
  const values = new Map(previous?.parameters.map((p) => [p.id, p.value]));
  return {
    kind: 'subsystem',
    name: previous?.name ?? subsystem.name.slice(0, 100),
    description: `Subsystem ${subsystem.name}: ${subsystem.blocks.filter((b) => !isBoundary(b)).length} blocks inside.`,
    domain:
      physical?.domain ??
      (ports.some((p) => p.domain === 'boolean') &&
      !ports.some((p) => p.domain === 'signal')
        ? 'boolean'
        : 'signal'),
    symbol: subsystem.name.slice(0, 24),
    ports,
    parameters: (subsystem.parameters ?? []).map(
      ({ targets: _targets, ...p }) => ({
        ...p,
        value: values.get(p.id) ?? p.value,
      }),
    ),
    equations: '',
    category: 'routing',
    subsystem: { ref: subsystem.id },
  };
}

/** Every definition an instance can show: its variants' insides, or just its own. */
export function refsOf(definition: Definition): string[] {
  const sub = definition.subsystem;
  if (!sub) return [];
  return [...new Set([sub.ref, ...(sub.variants ?? []).map((v) => v.ref)])];
}

/**
 * An instance's definition brought up to date: the active inside's ports, then
 * ports only other variants have, and the active variant's remembered values
 * kept equal to the instance's parameter values.
 */
export function instanceDefinitionFor(
  project: Project,
  block: Block,
): Definition | undefined {
  const ref = block.definition.subsystem?.ref;
  const sub = ref ? findSubsystem(project, ref) : undefined;
  if (!sub) return undefined;
  const base = instanceDefinition(sub, block.definition);
  const current = block.definition.subsystem!;
  if (!current.variants) return base;
  const ports = [...base.ports];
  const seen = new Set(ports.map((p) => p.id));
  for (const v of current.variants) {
    const other = v.ref === ref ? undefined : findSubsystem(project, v.ref);
    for (const p of other ? instancePorts(other) : [])
      if (!seen.has(p.id)) {
        seen.add(p.id);
        ports.push(p);
      }
  }
  const values = Object.fromEntries(
    base.parameters.map((p) => [p.id, p.value]),
  );
  return {
    ...base,
    ports,
    subsystem: {
      ...current,
      variants: current.variants.map((v) =>
        v.id === current.active ? { ...v, values } : v,
      ),
    },
  };
}

/** Subsystem definition ID that a path of instance IDs ends in (undefined at the top). */
export function subsystemAt(project: Project, path: string[]) {
  let diagram: { blocks: Block[] } = project;
  let ref: string | undefined;
  for (const id of path) {
    const block = diagram.blocks.find((b) => b.id === id);
    ref = block?.definition.subsystem?.ref;
    const next = ref ? findSubsystem(project, ref) : undefined;
    if (!next) return undefined;
    diagram = next;
  }
  return ref;
}

/** The longest prefix of `path` that still leads somewhere. */
export function validPath(project: Project, path: string[]) {
  for (let n = path.length; n > 0; n--)
    if (subsystemAt(project, path.slice(0, n))) return path.slice(0, n);
  return [];
}

/** Breadcrumb entries: the model, then each instance down the path. */
export function breadcrumb(project: Project, path: string[]) {
  const crumbs = [{ path: [] as string[], name: project.name }];
  let diagram: { blocks: Block[] } = project;
  path.forEach((id, i) => {
    const block = diagram.blocks.find((b) => b.id === id);
    const sub = block?.definition.subsystem
      ? findSubsystem(project, block.definition.subsystem.ref)
      : undefined;
    if (!block || !sub) return;
    const sr = block.definition.subsystem!;
    const variant = sr.variants?.find((v) => v.id === sr.active);
    crumbs.push({
      path: path.slice(0, i + 1),
      name: variant
        ? `${block.definition.name} [${variant.name}]`
        : block.definition.name,
    });
    diagram = sub;
  });
  return crumbs;
}

/** The inside of a subsystem as an ordinary Project; the document itself at the top. */
export function scopeView(project: Project, path: string[]): Project {
  const ref = path.length ? subsystemAt(project, path) : undefined;
  const sub = ref ? findSubsystem(project, ref) : undefined;
  if (!sub) return project;
  return {
    ...project,
    blocks: sub.blocks,
    wires: sub.wires,
    junctions: sub.junctions ?? [],
    nets: sub.nets,
    annotations: [],
  };
}

type Sheet = Pick<Project, 'blocks' | 'wires' | 'junctions' | 'nets'>;

/** Bring instances in one sheet up to date; drop wires to ports that no longer exist. */
function syncSheet<T extends Sheet>(project: Project, sheet: T): T {
  let changed = false;
  const blocks = sheet.blocks.map((block) => {
    const definition = instanceDefinitionFor(project, block);
    if (!definition) return block;
    if (JSON.stringify(definition) === JSON.stringify(block.definition))
      return block;
    changed = true;
    const size = defaultBlockSize(definition);
    const grow =
      !block.size ||
      block.size.height < size.height ||
      block.size.width < size.width;
    return { ...block, definition, ...(grow ? { size } : {}) };
  });
  if (!changed) return sheet;
  const ports = new Map(
    blocks.map((b) => [b.id, new Set(b.definition.ports.map((p) => p.id))]),
  );
  const alive = (id: string, handle: string) =>
    !ports.has(id) || ports.get(id)!.has(handle);
  const wires = sheet.wires.filter(
    (w) => alive(w.source, w.sourceHandle) && alive(w.target, w.targetHandle),
  );
  const next = { ...sheet, blocks, wires };
  if (wires.length === sheet.wires.length) return next;
  const reconciled = reconcileNets(
    { ...project, ...next } as Project,
    {
      ...project,
      ...sheet,
    } as Project,
  );
  return { ...next, nets: reconciled.nets };
}

/** Instances reachable from the top, used to drop definitions nothing refers to. */
function referenced(project: Project) {
  const used = new Set<string>();
  const visit = (sheet: Sheet) => {
    for (const block of sheet.blocks)
      for (const ref of refsOf(block.definition)) {
        if (used.has(ref)) continue;
        used.add(ref);
        const sub = findSubsystem(project, ref);
        if (sub) visit(sub);
      }
  };
  visit(project);
  return used;
}

/** Every instance in the document matches its definition; the format version follows. */
export function syncInstances(project: Project): Project {
  if (!project.subsystems?.length && project.version === 1) return project;
  const top = syncSheet(project, project);
  const withTop = top === project ? project : { ...project, ...top };
  const used = referenced(withTop);
  const subsystems = subsystemsOf(withTop)
    .filter((s) => used.has(s.id))
    .map((s) => syncSheet(withTop, s));
  if (!subsystems.length) {
    const { subsystems: _s, ...flat } = withTop;
    return { ...flat, version: 1 };
  }
  return { ...withTop, subsystems, version: 2 };
}

/** Put an edited sheet back at `path` and update every instance. */
export function writeScope(
  project: Project,
  path: string[],
  view: Project,
): Project {
  const ref = path.length ? subsystemAt(project, path) : undefined;
  if (!ref) return syncInstances(view);
  const subsystems = subsystemsOf(view).map((s) =>
    s.id === ref
      ? {
          ...s,
          blocks: view.blocks,
          wires: view.wires,
          junctions: view.junctions,
          nets: view.nets,
        }
      : s,
  );
  return syncInstances({
    ...project,
    name: view.name,
    duration: view.duration,
    description: view.description,
    revision: view.revision,
    subsystems,
  });
}

export const usageCount = (project: Project, id: string) =>
  [project, ...subsystemsOf(project)].reduce(
    (n, sheet) =>
      n + sheet.blocks.filter((b) => refsOf(b.definition).includes(id)).length,
    0,
  );

function uniqueName(names: Set<string>, base: string) {
  let name = base.trim() || 'port';
  for (let i = 2; names.has(name); i++) name = `${base}${i}`;
  names.add(name);
  return name;
}

function bounds(blocks: Block[]) {
  const xs = blocks.flatMap((b) => [
    b.position.x,
    b.position.x + blockSize(b).width,
  ]);
  const ys = blocks.flatMap((b) => [
    b.position.y,
    b.position.y + blockSize(b).height,
  ]);
  return {
    left: Math.min(...xs),
    right: Math.max(...xs),
    top: Math.min(...ys),
    bottom: Math.max(...ys),
  };
}

/**
 * Replace the selected blocks with one subsystem instance. Every net the
 * selection boundary cuts becomes a port: signal nets driven inside become
 * outputs, those driven outside inputs, and physical nets physical ports of their
 * domain. Connectivity is preserved exactly.
 */
export function groupIntoSubsystem(
  view: Project,
  blockIds: string[],
  name?: string,
): { project: Project; instanceId: string; subsystemId: string } | undefined {
  const inside = new Set(
    blockIds.filter((id) => view.blocks.some((b) => b.id === id)),
  );
  if (!inside.size) return undefined;
  const junctionIds = new Set((view.junctions ?? []).map((j) => j.id));
  const blockOf = (id: string) => view.blocks.find((b) => b.id === id);
  // A junction belongs inside when every block on its net that it touches is inside.
  const componentOf = new Map<string, string[]>();
  for (const component of netComponents(view))
    for (const key of component) componentOf.set(key, component);
  const endpointKey = (id: string, handle: string) =>
    junctionIds.has(id) ? `j:${id}` : `${id}.${handle}`;
  const blockOfKey = (key: string) =>
    key.startsWith('j:') ? undefined : key.slice(0, key.lastIndexOf('.'));
  const insideJunctions = new Set<string>();
  for (const j of junctionIds) {
    const component = componentOf.get(`j:${j}`) ?? [];
    const blocks = component.map(blockOfKey).filter((b): b is string => !!b);
    if (blocks.length && blocks.every((b) => inside.has(b)))
      insideJunctions.add(j);
  }
  const isInside = (id: string) => inside.has(id) || insideJunctions.has(id);

  const subsystemId = newId('sub_');
  const instanceId = newId('b_');
  const innerWires: Wire[] = [];
  const outerWires: Wire[] = [];
  const boundaries = new Map<
    string,
    { block: Block; handle: string; direction: Port['direction'] }
  >();
  const names = new Set<string>();
  let order = 0;
  const boundaryFor = (component: string[], insideKey: string) => {
    const id = component.join('|');
    const existing = boundaries.get(id);
    if (existing) return existing;
    const ports = component
      .filter((k) => !k.startsWith('j:'))
      .map((k) => {
        const blockId = blockOfKey(k)!;
        const handle = k.slice(k.lastIndexOf('.') + 1);
        return {
          blockId,
          port: blockOf(blockId)?.definition.ports.find((p) => p.id === handle),
        };
      })
      .filter((e) => e.port);
    const domain = ports[0]?.port?.domain ?? 'signal';
    const driver = ports.find((e) => e.port!.direction === 'output');
    const kind: BoundaryKind = !isCausal(domain)
      ? 'connport'
      : driver && inside.has(driver.blockId)
        ? 'outport'
        : 'inport';
    const net = view.nets?.find((n) =>
      n.wireIds.some((w) => {
        const wire = view.wires.find((x) => x.id === w);
        return (
          wire &&
          component.includes(endpointKey(wire.source, wire.sourceHandle))
        );
      }),
    );
    const insidePort = insideKey.startsWith('j:')
      ? undefined
      : blockOf(blockOfKey(insideKey)!)?.definition.ports.find(
          (p) => p.id === insideKey.slice(insideKey.lastIndexOf('.') + 1),
        );
    const name = uniqueName(
      names,
      net?.name ??
        (insidePort && !/^(u|y|in|out)$/.test(insidePort.name)
          ? insidePort.name
          : kind === 'inport'
            ? 'in'
            : kind === 'outport'
              ? 'out'
              : (insidePort?.name ?? domain)),
    );
    const boundaryId = newId('p_');
    const definition = boundaryDefinition(kind, name, domain, order++);
    const block: Block = {
      id: boundaryId,
      definition,
      position: { x: 0, y: 0 },
      size: defaultBlockSize(definition),
    };
    const entry = {
      block,
      handle: definition.ports[0].id,
      direction: boundaryKinds[kind],
    };
    boundaries.set(id, entry);
    return entry;
  };

  const seenInner = new Set<string>();
  const seenOuter = new Set<string>();
  // A cut wire keeps its ID outside (so its net keeps its name and visibility) and
  // maps to a new wire inside, which inherits the same net.
  const innerFor = new Map<string, string>();
  const outerIds = new Set<string>();
  for (const wire of view.wires) {
    const a = isInside(wire.source),
      b = isInside(wire.target);
    if (a && b) {
      innerWires.push(wire);
      continue;
    }
    if (!a && !b) {
      outerWires.push(wire);
      continue;
    }
    const [inId, inHandle, outId, outHandle] = a
      ? [wire.source, wire.sourceHandle, wire.target, wire.targetHandle]
      : [wire.target, wire.targetHandle, wire.source, wire.sourceHandle];
    const component = componentOf.get(endpointKey(inId, inHandle)) ?? [];
    const boundary = boundaryFor(component, endpointKey(inId, inHandle));
    const innerKey = `${boundary.block.id}|${inId}.${inHandle}`;
    if (!seenInner.has(innerKey)) {
      seenInner.add(innerKey);
      // Signal wires run from the driver to the consumer.
      const fromBoundary = boundary.direction === 'input';
      const innerId = newId('w_');
      innerFor.set(wire.id, innerId);
      innerWires.push({
        id: innerId,
        ...(fromBoundary || boundary.direction === 'physical'
          ? {
              source: boundary.block.id,
              sourceHandle: boundary.handle,
              target: inId,
              targetHandle: inHandle,
            }
          : {
              source: inId,
              sourceHandle: inHandle,
              target: boundary.block.id,
              targetHandle: boundary.handle,
            }),
      });
    }
    const outerKey = `${boundary.block.id}|${outId}.${outHandle}`;
    if (!seenOuter.has(outerKey)) {
      seenOuter.add(outerKey);
      const outerId = outerIds.has(wire.id) ? newId('w_') : wire.id;
      outerIds.add(outerId);
      outerWires.push({
        id: outerId,
        ...(boundary.direction === 'input'
          ? {
              source: outId,
              sourceHandle: outHandle,
              target: instanceId,
              targetHandle: boundary.block.id,
            }
          : {
              source: instanceId,
              sourceHandle: boundary.block.id,
              target: outId,
              targetHandle: outHandle,
            }),
      });
    }
  }
  const innerBlocks = view.blocks.filter((b) => inside.has(b.id));
  const box = bounds(innerBlocks);
  // Boundary blocks sit outside the grouped blocks, level with what they connect to.
  const gap = 96;
  for (const { block, direction } of boundaries.values()) {
    const wire = innerWires.find(
      (w) => w.source === block.id || w.target === block.id,
    )!;
    const [otherId, handle] =
      wire.source === block.id
        ? [wire.target, wire.targetHandle]
        : [wire.source, wire.sourceHandle];
    const other = blockOf(otherId);
    const point = other ? portPoint(other, handle) : undefined;
    const size = blockSize(block);
    const right =
      direction === 'output' ||
      (direction === 'physical' && point?.side === 'right');
    const x = right ? box.right + gap : box.left - gap - size.width;
    const y = (point?.y ?? box.top) - size.height / 2;
    block.position = snapBlockPosition({ x, y }, size);
    if (direction === 'physical' && right && block.definition.boundary) {
      block.definition = boundaryDefinition(
        'connport',
        block.definition.name,
        block.definition.domain,
        block.definition.boundary.order,
        'right',
      );
    }
  }
  const subsystem: SubsystemDefinition = {
    id: subsystemId,
    name: name ?? nextSubsystemName(view),
    blocks: [...innerBlocks, ...[...boundaries.values()].map((b) => b.block)],
    wires: innerWires,
    junctions: (view.junctions ?? []).filter((j) => insideJunctions.has(j.id)),
  };
  const reconciledInner = reconcileNets({
    ...view,
    ...subsystem,
    nets: view.nets
      ?.map((n) => ({
        ...n,
        wireIds: n.wireIds
          .map((w) => innerFor.get(w) ?? w)
          .filter((w) => innerWires.some((x) => x.id === w)),
      }))
      .filter((n) => n.wireIds.length),
  } as Project);
  subsystem.nets = reconciledInner.nets;
  const definition = instanceDefinition(subsystem);
  const size = defaultBlockSize(definition);
  const instance: Block = {
    id: instanceId,
    definition,
    size,
    position: snapBlockPosition(
      {
        x: (box.left + box.right) / 2 - size.width / 2,
        y: (box.top + box.bottom) / 2 - size.height / 2,
      },
      size,
    ),
  };
  const next: Project = {
    ...view,
    version: 2,
    blocks: [...view.blocks.filter((b) => !inside.has(b.id)), instance],
    wires: outerWires,
    junctions: (view.junctions ?? []).filter((j) => !insideJunctions.has(j.id)),
    subsystems: [...subsystemsOf(view), subsystem],
  };
  return { project: next, instanceId, subsystemId };
}

export function nextSubsystemName(project: Project) {
  const names = new Set(
    [project, ...subsystemsOf(project)].flatMap((s) =>
      s.blocks.map((b) => b.definition.name),
    ),
  );
  for (let i = 1; ; i++)
    if (!names.has(`Subsystem ${i}`)) return `Subsystem ${i}`;
}

/** Replace an instance with a copy of its inside, wired to what the instance was wired to. */
export function ungroupSubsystem(
  view: Project,
  instanceId: string,
): { project: Project; blockIds: string[] } | undefined {
  const instance = view.blocks.find((b) => b.id === instanceId);
  const sub = instance?.definition.subsystem
    ? findSubsystem(view, instance.definition.subsystem.ref)
    : undefined;
  if (!instance || !sub) return undefined;
  const taken = new Set([
    ...view.blocks.map((b) => b.id),
    ...(view.junctions ?? []).map((j) => j.id),
  ]);
  const rename = new Map<string, string>();
  for (const b of sub.blocks)
    rename.set(b.id, taken.has(b.id) ? newId('b_') : b.id);
  for (const j of sub.junctions ?? [])
    rename.set(j.id, taken.has(j.id) ? newId('j_') : j.id);
  const inner = boundaryBlocks(sub);
  const box = bounds(
    sub.blocks.filter((b) => !isBoundary(b)).length
      ? sub.blocks.filter((b) => !isBoundary(b))
      : sub.blocks,
  );
  const size = blockSize(instance);
  const dx = instance.position.x + size.width / 2 - (box.left + box.right) / 2;
  const dy = instance.position.y + size.height / 2 - (box.top + box.bottom) / 2;
  // Promoted values set on this instance flow back into the inner parameters.
  const values = new Map(
    instance.definition.parameters.map((p) => [p.id, p.value]),
  );
  const overrides = new Map<string, Map<string, number>>();
  for (const p of sub.parameters ?? [])
    for (const t of p.targets) {
      if (!overrides.has(t.blockId)) overrides.set(t.blockId, new Map());
      overrides.get(t.blockId)!.set(t.parameterId, values.get(p.id) ?? p.value);
    }
  const blocks = sub.blocks
    .filter((b) => !isBoundary(b))
    .map((b) => ({
      ...structuredClone(b),
      id: rename.get(b.id)!,
      position: { x: b.position.x + dx, y: b.position.y + dy },
      definition: {
        ...structuredClone(b.definition),
        parameters: b.definition.parameters.map((p) => ({
          ...p,
          value: overrides.get(b.id)?.get(p.id) ?? p.value,
        })),
      },
    }));
  const boundaryIds = new Set(inner.map((b) => b.id));
  const wires: Wire[] = [];
  const carried = new Map<string, string>();
  for (const w of sub.wires) {
    if (boundaryIds.has(w.source) || boundaryIds.has(w.target)) continue;
    // Keep wire IDs where free, so net names and visibility survive the round trip.
    const wireId = view.wires.some((x) => x.id === w.id) ? newId('w_') : w.id;
    carried.set(w.id, wireId);
    wires.push({
      ...structuredClone(w),
      id: wireId,
      source: rename.get(w.source) ?? w.source,
      target: rename.get(w.target) ?? w.target,
      waypoints: w.waypoints?.map((p) => ({ x: p.x + dx, y: p.y + dy })),
      junctions: w.junctions?.map((p) => ({ x: p.x + dx, y: p.y + dy })),
    });
  }
  const outer = view.wires.filter(
    (w) => w.source !== instanceId && w.target !== instanceId,
  );
  for (const port of inner) {
    const outside = view.wires
      .filter(
        (w) =>
          (w.source === instanceId && w.sourceHandle === port.id) ||
          (w.target === instanceId && w.targetHandle === port.id),
      )
      .map((w) =>
        w.source === instanceId
          ? { id: w.target, handle: w.targetHandle }
          : { id: w.source, handle: w.sourceHandle },
      );
    const insideEnds = sub.wires
      .filter((w) => w.source === port.id || w.target === port.id)
      .map((w) =>
        w.source === port.id
          ? { id: rename.get(w.target) ?? w.target, handle: w.targetHandle }
          : { id: rename.get(w.source) ?? w.source, handle: w.sourceHandle },
      );
    if (!outside.length || !insideEnds.length) continue;
    const kind = port.definition.kind as BoundaryKind;
    if (kind === 'outport') {
      // One inside driver feeds every outside consumer.
      for (const o of outside)
        wires.push({
          id: newId('w_'),
          source: insideEnds[0].id,
          sourceHandle: insideEnds[0].handle,
          target: o.id,
          targetHandle: o.handle,
        });
    } else {
      const hub = outside[0];
      for (const i of insideEnds)
        wires.push({
          id: newId('w_'),
          source: hub.id,
          sourceHandle: hub.handle,
          target: i.id,
          targetHandle: i.handle,
        });
      for (const o of outside.slice(1))
        if (kind === 'connport')
          wires.push({
            id: newId('w_'),
            source: hub.id,
            sourceHandle: hub.handle,
            target: o.id,
            targetHandle: o.handle,
          });
    }
  }
  const junctions = [
    ...(view.junctions ?? []),
    ...(sub.junctions ?? []).map((j) => ({
      ...j,
      id: rename.get(j.id)!,
      position: { x: j.position.x + dx, y: j.position.y + dy },
    })),
  ];
  const next: Project = {
    ...view,
    blocks: [...view.blocks.filter((b) => b.id !== instanceId), ...blocks],
    wires: [...outer, ...wires],
    junctions,
    // Inner nets come back with their names and visibility.
    nets: [
      ...(view.nets ?? []),
      ...(sub.nets ?? []).map((n) => ({
        ...n,
        wireIds: n.wireIds.map((id) => carried.get(id) ?? id),
      })),
    ],
  };
  return { project: next, blockIds: blocks.map((b) => b.id) };
}

/** Give one instance its own copy of the definition, so edits stop affecting the others. */
export function makeUnique(view: Project, instanceId: string): Project {
  const instance = view.blocks.find((b) => b.id === instanceId);
  const sub = instance?.definition.subsystem
    ? findSubsystem(view, instance.definition.subsystem.ref)
    : undefined;
  if (!instance || !sub) return view;
  const copy: SubsystemDefinition = {
    ...structuredClone(sub),
    id: newId('sub_'),
    name: instance.definition.name,
  };
  // Variants that showed the shared inside (parameter variants of it) move to the copy too.
  const current = instance.definition.subsystem!;
  const subsystem = {
    ...current,
    ref: copy.id,
    ...(current.variants
      ? {
          variants: current.variants.map((v) =>
            v.ref === sub.id ? { ...v, ref: copy.id } : v,
          ),
        }
      : {}),
  };
  return {
    ...view,
    blocks: view.blocks.map((b) =>
      b.id === instanceId
        ? { ...b, definition: { ...b.definition, subsystem } }
        : b,
    ),
    subsystems: [...subsystemsOf(view), copy],
  };
}

/** Colour of a boundary pill: the domain colour, shared with its wires and ports. */
export const boundaryColor = (block: Block) =>
  domainColors[block.definition.ports[0]?.domain ?? 'signal'];

/**
 * Library "Subsystem" blocks and version 1 placeholders become real subsystems
 * that pass each input to the output with the same position, so they keep their
 * ports, wires, and behavior.
 */
export function realizePlaceholders(project: Project): Project {
  const placeholders = project.blocks.filter(
    (b) =>
      b.definition.kind === 'subsystem' &&
      !b.definition.subsystem &&
      !b.definition.generated,
  );
  if (!placeholders.length) return project;
  let subsystems = subsystemsOf(project);
  const blocks = project.blocks.map((block) => {
    if (!placeholders.includes(block)) return block;
    const inputs = block.definition.ports.filter(
      (p) => p.direction === 'input',
    );
    const outputs = block.definition.ports.filter(
      (p) => p.direction === 'output',
    );
    const inner: Block[] = [
      ...inputs.map((p, i) => ({
        id: p.id,
        definition: boundaryDefinition('inport', p.name, p.domain, i),
        position: { x: 40, y: 80 + i * 64 },
      })),
      ...outputs.map((p, i) => ({
        id: p.id,
        definition: boundaryDefinition(
          'outport',
          p.name,
          p.domain,
          inputs.length + i,
        ),
        position: { x: 280, y: 80 + i * 64 },
      })),
    ].map((b) => ({ ...b, size: defaultBlockSize(b.definition) }));
    const wires: Wire[] = inputs.slice(0, outputs.length).map((p, i) => ({
      id: newId('w_'),
      source: p.id,
      sourceHandle: 'y',
      target: outputs[i].id,
      targetHandle: 'u',
    }));
    const sub: SubsystemDefinition = {
      id: newId('sub_'),
      name: nextSubsystemName({ ...project, subsystems }),
      blocks: inner,
      wires,
      junctions: [],
    };
    sub.nets = reconcileNets({ ...project, ...sub } as Project).nets;
    subsystems = [...subsystems, sub];
    const definition = instanceDefinition(sub, {
      ...block.definition,
      name: block.definition.name,
      parameters: [],
    });
    return { ...block, definition };
  });
  return { ...project, version: 2, blocks, subsystems };
}

/** Definitions an instance needs, including those nested inside it. */
export function subsystemClosure(project: Project, refs: string[]) {
  const out = new Map<string, SubsystemDefinition>();
  const visit = (ref: string) => {
    if (out.has(ref)) return;
    const sub = findSubsystem(project, ref);
    if (!sub) return;
    out.set(ref, sub);
    for (const b of sub.blocks) refsOf(b.definition).forEach(visit);
  };
  refs.forEach(visit);
  return [...out.values()];
}

/** Definitions the sheet at `path` sits inside: pasting one of them there would nest it in itself. */
export function ancestorRefs(project: Project, path: string[]) {
  return path
    .map((_, i) => subsystemAt(project, path.slice(0, i + 1)))
    .filter((r): r is string => !!r);
}

/** Add definitions a pasted fragment brings along; refuse one that would contain itself. */
export function withPastedSubsystems(
  view: Project,
  path: string[],
  fragment: { blocks: Block[]; subsystems?: SubsystemDefinition[] },
): Project | 'recursive' {
  const refs = fragment.blocks.flatMap((b) => refsOf(b.definition));
  if (!refs.length) return view;
  const incoming = fragment.subsystems ?? [];
  const closure = new Set([...refs, ...incoming.map((s) => s.id)]);
  if (ancestorRefs(view, path).some((r) => closure.has(r))) return 'recursive';
  const known = new Set(subsystemsOf(view).map((s) => s.id));
  const missing = incoming.filter((s) => !known.has(s.id));
  return missing.length
    ? { ...view, version: 2, subsystems: [...subsystemsOf(view), ...missing] }
    : view;
}

/** Change a boundary block's domain; wires of the old domain on it go. */
export function setBoundaryDomain(
  view: Project,
  id: string,
  domain: Domain,
): Project {
  const block = view.blocks.find((b) => b.id === id);
  if (
    !block ||
    !isBoundary(block) ||
    block.definition.ports[0].domain === domain
  )
    return view;
  const d = block.definition;
  const next = boundaryDefinition(
    d.kind as BoundaryKind,
    d.name,
    domain,
    d.boundary!.order,
    d.boundary!.side,
  );
  return {
    ...view,
    blocks: view.blocks.map((b) =>
      b.id === id ? { ...b, definition: { ...next, name: d.name } } : b,
    ),
    wires: view.wires.filter((w) => w.source !== id && w.target !== id),
  };
}

/** Which side of the subsystem block a physical port sits on. */
const mirror = {
  left: 'right',
  right: 'left',
  top: 'bottom',
  bottom: 'top',
} as const;

export function setBoundarySide(
  view: Project,
  id: string,
  side: NonNullable<Port['side']>,
): Project {
  const block = view.blocks.find((b) => b.id === id);
  if (!block || !isBoundary(block)) return view;
  return {
    ...view,
    blocks: view.blocks.map((b) =>
      b.id === id
        ? {
            ...b,
            definition: {
              ...b.definition,
              boundary: { ...b.definition.boundary!, side },
              // The pill sits on that side of the sheet, so its terminal faces inward.
              ports: b.definition.ports.map((p) => ({
                ...p,
                side: mirror[side],
              })),
            },
          }
        : b,
    ),
  };
}

/** Expose an inner block parameter on the subsystem block; each instance sets its own value. */
export function promoteParameter(
  view: Project,
  subsystemId: string,
  blockId: string,
  parameterId: string,
): Project {
  const sub = findSubsystem(view, subsystemId);
  const block = sub?.blocks.find((b) => b.id === blockId);
  const parameter = block?.definition.parameters.find(
    (p) => p.id === parameterId,
  );
  if (!sub || !block || !parameter) return view;
  const existing = sub.parameters ?? [];
  if (
    existing.some((p) =>
      p.targets.some(
        (t) => t.blockId === blockId && t.parameterId === parameterId,
      ),
    )
  )
    return view;
  const taken = new Set(existing.map((p) => p.id));
  const base = `${block.definition.name}_${parameter.id}`
    .replace(/[^A-Za-z0-9_]/g, '_')
    .replace(/^[^A-Za-z]/, 'p');
  let id = base;
  for (let i = 2; taken.has(id); i++) id = `${base}${i}`;
  const promoted = {
    id,
    name: `${block.definition.name} ${parameter.name.toLowerCase()}`,
    value: parameter.value,
    unit: parameter.unit,
    ...(parameter.min !== undefined ? { min: parameter.min } : {}),
    ...(parameter.max !== undefined ? { max: parameter.max } : {}),
    targets: [{ blockId, parameterId }],
  };
  return {
    ...view,
    subsystems: subsystemsOf(view).map((s) =>
      s.id === subsystemId ? { ...s, parameters: [...existing, promoted] } : s,
    ),
  };
}

/** Stop exposing a parameter; the inner block keeps the value it had inside. */
export function demoteParameter(
  view: Project,
  subsystemId: string,
  promotedId: string,
): Project {
  return {
    ...view,
    subsystems: subsystemsOf(view).map((s) =>
      s.id === subsystemId
        ? {
            ...s,
            parameters: (s.parameters ?? []).filter((p) => p.id !== promotedId),
          }
        : s,
    ),
  };
}

/** For blocks inside `subsystemId`: blockId → parameterId → the promoted parameter that sets it. */
export function promotedTargets(
  project: Project,
  subsystemId: string | undefined,
) {
  const out = new Map<string, Map<string, { id: string; name: string }>>();
  const sub = subsystemId ? findSubsystem(project, subsystemId) : undefined;
  for (const p of sub?.parameters ?? [])
    for (const t of p.targets) {
      if (!out.has(t.blockId)) out.set(t.blockId, new Map());
      out.get(t.blockId)!.set(t.parameterId, { id: p.id, name: p.name });
    }
  return out;
}
