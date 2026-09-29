/**
 * Signal buses: several signals carried on one wire, as Simulink draws them.
 *
 * A port carries `width` signals (absent = one). Widths are never typed by hand:
 * `propagateBuses` derives them from the diagram after every edit.
 *
 * - Mux concatenates its inputs into one vector (any input may itself be a vector).
 * - Demux splits a vector into N equal parts, in order.
 * - Bus Creator is a Mux whose inputs have names; the names travel with the bus
 *   as `elements`, and a bus inside a bus gets dotted names (`motor.speed`).
 * - Bus Selector picks elements out of a bus by name. Naming a sub-bus
 *   (`motor`) gives a vector of everything under it.
 * - Subsystem ports pass a bus through unchanged.
 *
 * Every other port carries one signal. A bus that reaches one is a model error
 * (`busProblems`), reported with the block that would fix it.
 *
 * In Modelica a bus is an array connector (`RealOutput y[3]`); the bus blocks'
 * equations are generated from their ports here and, authoritatively, in
 * server/buses.py.
 */
import type { Block, Definition, Port, Project } from './model';
import { netComponents } from './net';
import { reconcileNets } from './net-registry';
import { defaultBlockSize } from './block-design';

export const BUS_KINDS = new Set(['mux', 'demux', 'busCreator', 'busSelector']);
/** Most inputs a Mux or Bus Creator takes, or outputs a Demux or Bus Selector gives. */
export const MAX_BUS_PORTS = 32;
export const MIN_BUS_PORTS = 2;

export const isBusBlock = (d: Definition) =>
  BUS_KINDS.has(d.kind) && !d.generated && !d.subsystem && !d.boundary;

export const widthOf = (p?: Pick<Port, 'width'>) => p?.width ?? 1;

/** The names of a bus's signals; an unnamed vector's are signal1, signal2, … */
export function elementNames(p: Pick<Port, 'width' | 'elements'>): string[] {
  const w = widthOf(p);
  if (w === 1) return [];
  return p.elements?.length === w
    ? p.elements
    : Array.from({ length: w }, (_, i) => `signal${i + 1}`);
}

/** A valid Bus Creator element name: a letter, then letters, digits, or _. */
export const ELEMENT_NAME = /^[A-Za-z][A-Za-z0-9_]{0,39}$/;

const inputs = (d: Definition) =>
  d.ports.filter((p) => p.direction === 'input');
const outputs = (d: Definition) =>
  d.ports.filter((p) => p.direction === 'output');

const port = (
  id: string,
  name: string,
  direction: 'input' | 'output',
): Port => ({
  id,
  name,
  direction,
  domain: 'signal',
  side: direction === 'input' ? 'left' : 'right',
});

/** How many signals a bus block joins or splits: its inputs (Mux, Bus Creator) or outputs. */
export function busPortCount(d: Definition) {
  return d.kind === 'mux' || d.kind === 'busCreator'
    ? inputs(d).length
    : outputs(d).length;
}

/**
 * The ports of a bus block with `n` signal ports. Existing ports keep their IDs
 * (and so their wires); ports are added or removed at the end.
 */
export function busPortsWithCount(d: Definition, n: number): Port[] {
  n = Math.max(
    d.kind === 'busSelector' ? 1 : MIN_BUS_PORTS,
    Math.min(MAX_BUS_PORTS, Math.round(n)),
  );
  if (d.kind === 'mux')
    return [
      ...Array.from({ length: n }, (_, i) =>
        port(`u${i + 1}`, String(i + 1), 'input'),
      ),
      port('y', 'y', 'output'),
    ];
  if (d.kind === 'demux')
    return [
      port('u', 'u', 'input'),
      ...Array.from({ length: n }, (_, i) =>
        port(`y${i + 1}`, String(i + 1), 'output'),
      ),
    ];
  if (d.kind === 'busCreator') {
    const kept = inputs(d).slice(0, n);
    const names = new Set(kept.map((p) => p.name));
    const ids = new Set(kept.map((p) => p.id));
    for (let k = 1; kept.length < n; k++) {
      const id = `u${k}`,
        name = `signal${k}`;
      if (ids.has(id) || names.has(name)) continue;
      kept.push(port(id, name, 'input'));
      ids.add(id);
      names.add(name);
    }
    return [...kept, outputs(d)[0] ?? port('y', 'bus', 'output')];
  }
  const kept = outputs(d).slice(0, n);
  return [inputs(d)[0] ?? port('u', 'bus', 'input'), ...kept];
}

/** Bus Selector outputs for `names`, in that order; a name already selected keeps its port ID. */
export function selectorPorts(d: Definition, names: string[]): Port[] {
  const byName = new Map(outputs(d).map((p) => [p.name, p]));
  const used = new Set<string>();
  const ids = new Set(outputs(d).map((p) => p.id));
  let next = 1;
  const freshId = () => {
    while (ids.has(`y${next}`)) next++;
    ids.add(`y${next}`);
    return `y${next}`;
  };
  const out: Port[] = [];
  for (const name of names.slice(0, MAX_BUS_PORTS)) {
    if (used.has(name)) continue;
    used.add(name);
    const old = byName.get(name);
    out.push(old ? { ...old } : port(freshId(), name, 'output'));
  }
  return [inputs(d)[0] ?? port('u', 'bus', 'input'), ...out];
}

/** Bus Creator inputs renamed: `name` for the input `portId`. */
export function renamedBusInput(
  d: Definition,
  portId: string,
  name: string,
): Port[] {
  return d.ports.map((p) => (p.id === portId ? { ...p, name } : p));
}

/**
 * Replace a bus block's ports on a sheet: the block keeps its center and takes
 * its standard size, and wires to ports that no longer exist are removed.
 * Widths and equations follow on the next `propagateBuses`.
 */
export function withBusPorts(
  project: Project,
  blockId: string,
  ports: Port[],
): Project {
  const block = project.blocks.find((b) => b.id === blockId);
  if (!block) return project;
  const definition = { ...block.definition, ports };
  const standard = defaultBlockSize(definition);
  const turned = !!block.rotation && block.rotation % 180 !== 0;
  const size = turned
    ? { width: standard.height, height: standard.width }
    : standard;
  const old = block.size ?? size;
  const position = {
    x: block.position.x + (old.width - size.width) / 2,
    y: block.position.y + (old.height - size.height) / 2,
  };
  const ids = new Set(ports.map((p) => p.id));
  const alive = (id: string, handle: string) =>
    id !== blockId || ids.has(handle);
  const next: Project = {
    ...project,
    blocks: project.blocks.map((b) =>
      b.id === blockId ? { ...b, definition, size, position } : b,
    ),
    wires: project.wires.filter(
      (w) => alive(w.source, w.sourceHandle) && alive(w.target, w.targetHandle),
    ),
  };
  return reconcileNets(next, project);
}

type Signal = { width?: number; elements?: string[] };

const signalOf = (p?: Port): Signal =>
  p ? { width: p.width, elements: p.elements } : {};

/** Set a port's width and names; true when that changed it. */
function assign(p: Port, s: Signal): boolean {
  const width = s.width && s.width > 1 ? s.width : undefined;
  const elements =
    width && s.elements?.length === width ? [...s.elements] : undefined;
  if (
    p.width === width &&
    JSON.stringify(p.elements) === JSON.stringify(elements)
  )
    return false;
  if (width) p.width = width;
  else delete p.width;
  if (elements) p.elements = elements;
  else delete p.elements;
  return true;
}

/** What comes out of a bus block, from what goes in. */
function busOutputs(d: Definition): Map<string, Signal> {
  const out = new Map<string, Signal>();
  const ins = inputs(d),
    outs = outputs(d);
  if (d.kind === 'mux' || d.kind === 'busCreator') {
    const width = ins.reduce((n, p) => n + widthOf(p), 0);
    const elements =
      d.kind === 'busCreator'
        ? ins.flatMap((p) =>
            widthOf(p) === 1
              ? [p.name]
              : elementNames(p).map((e) => `${p.name}.${e}`),
          )
        : undefined;
    for (const p of outs) out.set(p.id, { width, elements });
  } else if (d.kind === 'demux') {
    const u = ins[0];
    const w = widthOf(u),
      n = outs.length;
    const part = n && w % n === 0 ? w / n : 1;
    const names = u?.elements;
    outs.forEach((p, k) =>
      out.set(p.id, {
        width: part,
        elements:
          part > 1 && names ? names.slice(k * part, (k + 1) * part) : undefined,
      }),
    );
  } else if (d.kind === 'busSelector') {
    const available = ins[0] ? elementNames(ins[0]) : [];
    for (const p of outs) {
      const under = available
        .filter((e) => e.startsWith(`${p.name}.`))
        .map((e) => e.slice(p.name.length + 1));
      out.set(
        p.id,
        !available.includes(p.name) && under.length > 1
          ? { width: under.length, elements: under }
          : {},
      );
    }
  }
  return out;
}

/** 1-based positions of a Bus Selector output's signals in its input bus. */
export function selectedIndices(bus: Port | undefined, name: string): number[] {
  const available = bus ? elementNames(bus) : [];
  const exact = available.indexOf(name);
  if (exact >= 0) return [exact + 1];
  return available
    .map((e, i) => (e.startsWith(`${name}.`) ? i + 1 : 0))
    .filter(Boolean);
}

/** The Modelica equations of a bus block, from its ports (mirrored in server/buses.py). */
export function busEquations(d: Definition): string {
  const ins = inputs(d),
    outs = outputs(d);
  if (d.kind === 'mux' || d.kind === 'busCreator') {
    const y = outs[0]?.id ?? 'y';
    return ins.every((p) => widthOf(p) === 1)
      ? `${y} = {${ins.map((p) => p.id).join(', ')}};`
      : `${y} = cat(1, ${ins.map((p) => (widthOf(p) === 1 ? `{${p.id}}` : p.id)).join(', ')});`;
  }
  const u = ins[0];
  if (d.kind === 'demux') {
    const part = Math.max(1, Math.floor(widthOf(u) / Math.max(1, outs.length)));
    return outs
      .map((p, k) =>
        part === 1
          ? `${p.id} = ${u?.id ?? 'u'}[${k + 1}];`
          : `${p.id} = ${u?.id ?? 'u'}[${k * part + 1}:${(k + 1) * part}];`,
      )
      .join('\n');
  }
  return outs
    .map((p) => {
      const at = selectedIndices(u, p.name);
      return at.length > 1
        ? `${p.id} = ${u?.id ?? 'u'}[{${at.join(', ')}}];`
        : `${p.id} = ${u?.id ?? 'u'}[${at[0] ?? 1}];`;
    })
    .join('\n');
}

type Sheet = Pick<Project, 'blocks' | 'wires' | 'junctions'>;

/** Port key → the output port that drives its net, for one sheet. */
function drivers(project: Project, sheet: Sheet) {
  const view = { ...project, ...sheet, junctions: sheet.junctions ?? [] };
  const blocks = new Map(sheet.blocks.map((b) => [b.id, b]));
  const found = new Map<string, Port | undefined>();
  for (const component of netComponents(view as Project)) {
    const ends = component
      .filter((k) => !k.startsWith('j:'))
      .map((k) => {
        const i = k.lastIndexOf('.');
        const block = blocks.get(k.slice(0, i));
        return {
          key: k,
          port: block?.definition.ports.find((p) => p.id === k.slice(i + 1)),
        };
      });
    const driver = ends.find((e) => e.port?.direction === 'output')?.port;
    for (const e of ends) found.set(e.key, driver);
  }
  return found;
}

/** Inputs whose width follows what drives them. */
const adapts = (b: Block) =>
  isBusBlock(b.definition) ||
  (b.definition.kind === 'outport' && !!b.definition.boundary);

const hasBus = (project: Project) =>
  [project, ...(project.subsystems ?? [])].some((s) =>
    s.blocks.some(
      (b) =>
        isBusBlock(b.definition) ||
        b.definition.ports.some((p) => p.width !== undefined),
    ),
  );

/**
 * Give every bus-capable port the width of what it is connected to, through
 * subsystems, and regenerate the bus blocks' equations. Returns the same object
 * when nothing changes. A subsystem used with different widths takes the first
 * instance's; `busProblems` then reports the others.
 */
export function propagateBuses(project: Project): Project {
  if (!hasBus(project)) return project;
  const doc = structuredClone(project);
  const sheets: Sheet[] = [doc, ...(doc.subsystems ?? [])];
  const byId = new Map((doc.subsystems ?? []).map((s) => [s.id, s]));
  for (let pass = 0; pass < 24; pass++) {
    let changed = false;
    const driven = new Map<Sheet, Map<string, Port | undefined>>();
    for (const sheet of sheets) {
      const d = drivers(doc, sheet);
      driven.set(sheet, d);
      for (const b of sheet.blocks) {
        if (!adapts(b)) continue;
        for (const p of b.definition.ports)
          if (p.direction === 'input')
            changed = assign(p, signalOf(d.get(`${b.id}.${p.id}`))) || changed;
      }
      for (const b of sheet.blocks) {
        if (!isBusBlock(b.definition)) continue;
        const out = busOutputs(b.definition);
        for (const p of outputs(b.definition))
          changed = assign(p, out.get(p.id) ?? {}) || changed;
        const equations = busEquations(b.definition);
        if (b.definition.equations !== equations) {
          b.definition.equations = equations;
          changed = true;
        }
      }
    }
    // Subsystem boundaries: an inport takes the width its first connected instance
    // receives; every instance port then shows its boundary's width.
    const uses = new Map<string, { sheet: Sheet; block: Block }[]>();
    for (const sheet of sheets)
      for (const block of sheet.blocks) {
        const ref = block.definition.subsystem?.ref;
        if (ref && byId.has(ref))
          uses.set(ref, [...(uses.get(ref) ?? []), { sheet, block }]);
      }
    for (const [ref, instances] of uses) {
      const sub = byId.get(ref)!;
      for (const boundary of sub.blocks) {
        if (!boundary.definition.boundary) continue;
        const inner = boundary.definition.ports[0];
        if (!inner || inner.domain !== 'signal') continue;
        let signal: Signal;
        if (boundary.definition.kind === 'inport') {
          const fed = instances
            .map(({ sheet, block }) =>
              driven.get(sheet)!.get(`${block.id}.${boundary.id}`),
            )
            .find(Boolean);
          signal = signalOf(fed);
          changed = assign(inner, signal) || changed;
        } else if (boundary.definition.kind === 'outport')
          signal = signalOf(inner);
        else continue;
        for (const { block } of instances) {
          const outer = block.definition.ports.find(
            (p) => p.id === boundary.id,
          );
          if (outer) changed = assign(outer, signal) || changed;
        }
      }
    }
    if (!changed) break;
  }
  const same = <T>(a: T, b: T) => JSON.stringify(a) === JSON.stringify(b);
  const keep = <T extends Sheet>(before: T, after: T): T => {
    const blocks = after.blocks.map((b, i) =>
      same(before.blocks[i], b) ? before.blocks[i] : b,
    );
    return blocks.every((b, i) => b === before.blocks[i])
      ? before
      : { ...before, blocks };
  };
  const top = keep(project, doc);
  const subsystems = project.subsystems?.map((s, i) =>
    keep(s, doc.subsystems![i]),
  );
  const subsChanged = subsystems?.some((s, i) => s !== project.subsystems![i]);
  if (top === project && !subsChanged) return project;
  return { ...top, ...(subsystems ? { subsystems } : {}) };
}

export type BusProblem = {
  id: string;
  message: string;
  blockIds: string[];
  ports: { blockId: string; portId: string }[];
  hint: string;
};

/**
 * Bus mistakes on one sheet: a bus into a one-signal input, a Demux that cannot
 * split its input evenly, a Bus Selector naming an element the bus lacks, and
 * repeated Bus Creator names. Mirrors `bus_problems` in server/buses.py.
 */
export function busProblems(project: Project): BusProblem[] {
  const out: BusProblem[] = [];
  const blocks = new Map(project.blocks.map((b) => [b.id, b]));
  const d = drivers(project, project);
  const driverBlock = new Map<Port, Block>();
  for (const b of project.blocks)
    for (const p of b.definition.ports) driverBlock.set(p, b);
  for (const [key, driver] of d) {
    if (!driver) continue;
    const i = key.lastIndexOf('.');
    const block = blocks.get(key.slice(0, i));
    const p = block?.definition.ports.find((q) => q.id === key.slice(i + 1));
    if (!block || !p || p.direction !== 'input' || p.domain !== 'signal')
      continue;
    const w = widthOf(driver),
      here = widthOf(p);
    if (w === here) continue;
    const from = driverBlock.get(driver)?.definition.name ?? 'Its source';
    const name = `${block.definition.name}.${p.name}`;
    out.push({
      id: `bus-width-${block.id}-${p.id}`,
      message:
        here === 1
          ? `${name} takes one signal, but ${from} sends a bus of ${w}.`
          : `${name} expects ${here} signals but receives ${w}.`,
      blockIds: [block.id],
      ports: [{ blockId: block.id, portId: p.id }],
      hint:
        here === 1
          ? 'Split the bus with a Demux, or pick signals out of it with a Bus Selector.'
          : 'A subsystem used in several places must receive the same bus width everywhere.',
    });
  }
  for (const block of project.blocks) {
    const def = block.definition;
    if (!isBusBlock(def)) continue;
    const u = inputs(def)[0];
    const connected = !!u && !!d.get(`${block.id}.${u.id}`);
    if (def.kind === 'demux' && connected) {
      const w = widthOf(u),
        n = outputs(def).length;
      if (w === 1 || w % n !== 0)
        out.push({
          id: `bus-demux-${block.id}`,
          message:
            w === 1
              ? `${def.name} receives one signal; there is nothing to split.`
              : `${def.name} cannot split ${w} signals into ${n} equal parts.`,
          blockIds: [block.id],
          ports: [],
          hint:
            w === 1
              ? 'Feed it a vector from a Mux or a bus from a Bus Creator.'
              : `Set its outputs to ${w}, or to a number that divides ${w}.`,
        });
    }
    if (def.kind === 'busSelector' && connected) {
      if (widthOf(u) === 1)
        out.push({
          id: `bus-selector-scalar-${block.id}`,
          message: `${def.name} receives one signal, not a bus.`,
          blockIds: [block.id],
          ports: [],
          hint: 'Connect it to the output of a Bus Creator or a Mux.',
        });
      else
        for (const p of outputs(def))
          if (!selectedIndices(u, p.name).length)
            out.push({
              id: `bus-selector-${block.id}-${p.id}`,
              message: `${def.name}: the incoming bus has no signal named ${p.name}.`,
              blockIds: [block.id],
              ports: [{ blockId: block.id, portId: p.id }],
              hint: 'Choose its signals again in the block’s properties.',
            });
    }
    if (def.kind === 'busCreator') {
      const seen = new Set<string>();
      for (const p of inputs(def)) {
        if (!ELEMENT_NAME.test(p.name))
          out.push({
            id: `bus-name-${block.id}-${p.id}`,
            message: `${def.name}: “${p.name}” is not a valid signal name.`,
            blockIds: [block.id],
            ports: [{ blockId: block.id, portId: p.id }],
            hint: 'Use a letter, then letters, digits, or _.',
          });
        if (seen.has(p.name))
          out.push({
            id: `bus-duplicate-${block.id}-${p.id}`,
            message: `${def.name} names two signals ${p.name}.`,
            blockIds: [block.id],
            ports: [{ blockId: block.id, portId: p.id }],
            hint: 'Give each signal in a bus its own name.',
          });
        seen.add(p.name);
      }
    }
  }
  return out;
}

/** Wires drawn heavy: every wire of a net whose ends carry a bus, junction to junction too. */
export function busWireIds(project: Project): Set<string> {
  const ports = new Map<string, Port>();
  for (const b of project.blocks)
    for (const p of b.definition.ports) ports.set(`${b.id}.${p.id}`, p);
  const wide = new Set(
    project.wires
      .filter(
        (w) =>
          widthOf(ports.get(`${w.source}.${w.sourceHandle}`)) > 1 ||
          widthOf(ports.get(`${w.target}.${w.targetHandle}`)) > 1,
      )
      .map((w) => w.id),
  );
  for (const net of project.nets ?? [])
    if (net.wireIds.some((id) => wide.has(id)))
      net.wireIds.forEach((id) => wide.add(id));
  return wide;
}
