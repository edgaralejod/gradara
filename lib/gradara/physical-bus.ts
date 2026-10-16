// SPDX-License-Identifier: Apache-2.0
import type { Block, Definition, Domain, Port, Project } from './model';

/**
 * Physical buses: named physical connections of any domain bundled into one line, as a
 * Simscape Bus does. A Physical bus block has one terminal per connection (its
 * elements) and one bus terminal. Wire two of them bus to bus, through junctions or
 * through a subsystem's physical bus port, and the elements with the same name on
 * either end become one node: a motor's abc, its shaft and its thermal port can travel
 * as one line and come out by name. Physical connections have no direction, so one
 * block both bundles and splits. The service does the joining (server/physical_buses.py).
 */
export const PHYSICAL_BUS = 'physicalBus';
export const BUS_PORT = 'bus';

/** The physical domains an element can carry. */
export const ELEMENT_DOMAINS: Domain[] = [
  'electrical',
  'mechanical',
  'translational',
  'thermal',
  'magnetic',
  'threePhase',
];

/** Letters, digits and _, starting with a letter: an element name the service accepts. */
export const ELEMENT_PATTERN = /^[A-Za-z][A-Za-z0-9_]{0,31}$/;

/** One element: its terminal's ID (kept while it exists; new elements omit it), name and type. */
export type Element = { id?: string; name: string; domain: Domain };

export const isPhysicalBus = (d: Definition) =>
  d.kind === PHYSICAL_BUS && !d.subsystem && !d.boundary && !d.generated;

/** The element terminals of a Physical bus block, in order. */
export const elementPorts = (d: Definition) =>
  d.ports.filter((p) => p.id !== BUS_PORT);

/** The next free element port ID: e1, e2, … */
function nextId(ports: Port[]) {
  const taken = new Set(ports.map((p) => p.id));
  for (let n = 1; ; n++) if (!taken.has(`e${n}`)) return `e${n}`;
}

/** A Physical bus definition with these elements; an element without an ID gets a new one. */
export function physicalBusDefinition(elements: Element[]): Definition {
  const kept: Port[] = [];
  const given = elements.flatMap((e) => (e.id ? [{ id: e.id } as Port] : []));
  elements.forEach((e) => {
    kept.push({
      id: e.id && e.id !== BUS_PORT ? e.id : nextId([...given, ...kept]),
      name: e.name,
      direction: 'physical',
      domain: e.domain,
      side: 'left',
    });
  });
  return {
    kind: PHYSICAL_BUS,
    name: 'Physical bus',
    description:
      'Bundles named physical connections of any type into one bus line, or splits them out again. Elements with the same name on the bus blocks of one bus line are joined.',
    domain: 'physicalBus',
    symbol: 'bus',
    ports: [
      ...kept,
      {
        id: BUS_PORT,
        name: 'bus',
        direction: 'physical',
        domain: 'physicalBus',
        side: 'right',
      },
    ],
    parameters: [],
    equations: '',
    category: 'routing',
    keywords: [
      'bus',
      'physical',
      'bundle',
      'simscape bus',
      'connection',
      'cable',
      'harness',
    ],
  };
}

export const physicalBusBlocks: Definition[] = [
  physicalBusDefinition([
    { name: 'p1', domain: 'electrical' },
    { name: 'p2', domain: 'electrical' },
  ]),
];

const wiredPorts = (project: Project, id: string) =>
  new Set(
    project.wires.flatMap((w) => [
      ...(w.source === id ? [w.sourceHandle] : []),
      ...(w.target === id ? [w.targetHandle] : []),
    ]),
  );

/** Element IDs of a block that have wires: their type follows the wire. */
export const wiredElements = (project: Project, id: string) =>
  wiredPorts(project, id);

/** What is wrong with a list of elements, or undefined: names must be unique and valid. */
export function elementsError(elements: Element[]) {
  if (!elements.length) return 'A physical bus needs at least one element.';
  const bad = elements.find((e) => !ELEMENT_PATTERN.test(e.name));
  if (bad)
    return `“${bad.name}” is not a valid name: a letter, then letters, digits, or _.`;
  const names = elements.map((e) => e.name);
  const twice = names.find((n, i) => names.indexOf(n) !== i);
  if (twice) return `Two elements are named ${twice}.`;
  return undefined;
}

/**
 * Set a Physical bus block's elements. An element keeps its ID, so its wires stay
 * with it when others are added, removed or reordered; a removed element's wires go
 * with it, and a wired element keeps its type. Returns `project` itself when the list
 * is invalid or unchanged.
 */
export function setElements(
  project: Project,
  id: string,
  elements: Element[],
): Project {
  const block = project.blocks.find((b) => b.id === id);
  if (!block || !isPhysicalBus(block.definition) || elementsError(elements))
    return project;
  const old = new Map(elementPorts(block.definition).map((p) => [p.id, p]));
  const wired = wiredPorts(project, id);
  const next = elements.map((e) => {
    const was = e.id ? old.get(e.id) : undefined;
    if (e.id && !was) return { name: e.name, domain: e.domain };
    return was && wired.has(was.id) ? { ...e, domain: was.domain } : e;
  });
  const definition = {
    ...physicalBusDefinition(next),
    name: block.definition.name,
  };
  if (
    JSON.stringify(definition.ports) === JSON.stringify(block.definition.ports)
  )
    return project;
  const live = new Set(definition.ports.map((p) => p.id));
  const keep = (w: Project['wires'][number]) =>
    !(w.source === id && !live.has(w.sourceHandle)) &&
    !(w.target === id && !live.has(w.targetHandle));
  return {
    ...project,
    blocks: project.blocks.map((b) => (b.id === id ? { ...b, definition } : b)),
    wires: project.wires.filter(keep),
  };
}

/** The elements of a Physical bus block. */
export const elementsOf = (block: Block): Element[] =>
  elementPorts(block.definition).map((p) => ({
    id: p.id,
    name: p.name,
    domain: p.domain,
  }));

/** A name for a new element: the first of p1, p2, … not in use. */
export function freeElementName(elements: Element[]) {
  const taken = new Set(elements.map((e) => e.name));
  for (let n = 1; ; n++) if (!taken.has(`p${n}`)) return `p${n}`;
}

type Sheet = {
  blocks: Block[];
  wires: Project['wires'];
  junctions?: Project['junctions'];
};

/** Each bus line on a sheet: the block and junction ends one physical bus net joins. */
export function busLines(sheet: Sheet): { id: string; handle: string }[][] {
  const junctions = new Map((sheet.junctions ?? []).map((j) => [j.id, j]));
  const ports = new Map<string, Port>();
  for (const b of sheet.blocks)
    for (const p of b.definition.ports) ports.set(`${b.id}\u0000${p.id}`, p);
  const key = (id: string, handle: string) =>
    junctions.has(id) ? `${id}\u0000node` : `${id}\u0000${handle}`;
  const isBus = (k: string) => {
    const [id] = k.split('\u0000');
    return junctions.has(id)
      ? junctions.get(id)!.domain === 'physicalBus'
      : ports.get(k)?.domain === 'physicalBus';
  };
  const parent = new Map<string, string>();
  const find = (x: string): string => {
    if (!parent.has(x)) parent.set(x, x);
    let r = x;
    while (parent.get(r) !== r) r = parent.get(r)!;
    parent.set(x, r);
    return r;
  };
  for (const w of sheet.wires) {
    const a = key(w.source, w.sourceHandle);
    const b = key(w.target, w.targetHandle);
    if (isBus(a) || isBus(b)) parent.set(find(a), find(b));
  }
  for (const b of sheet.blocks)
    for (const p of b.definition.ports)
      if (p.domain === 'physicalBus') find(`${b.id}\u0000${p.id}`);
  const groups = new Map<string, { id: string; handle: string }[]>();
  for (const k of parent.keys()) {
    const [id, handle] = k.split('\u0000');
    const root = find(k);
    groups.set(root, [...(groups.get(root) ?? []), { id, handle }]);
  }
  return [...groups.values()];
}

/**
 * What one end of a bus line carries, element name → type: a Physical bus block's
 * elements, or what a subsystem's bus port carries inside (read from the sheet
 * `insideOf` returns for the instance).
 */
export function carried(
  sheet: Sheet,
  end: { id: string; handle: string },
  insideOf: (block: Block) => Sheet | undefined,
  seen: Set<Sheet> = new Set(),
): Map<string, Domain> {
  const out = new Map<string, Domain>();
  const block = sheet.blocks.find((b) => b.id === end.id);
  if (!block) return out;
  if (isPhysicalBus(block.definition)) {
    for (const p of elementPorts(block.definition))
      if (!out.has(p.name)) out.set(p.name, p.domain);
    return out;
  }
  const inside = block.definition.subsystem ? insideOf(block) : undefined;
  if (!inside || seen.has(inside)) return out;
  const next = new Set(seen).add(inside);
  for (const line of busLines(inside))
    if (line.some((e) => e.id === end.handle))
      for (const e of line)
        for (const [n, d] of carried(inside, e, insideOf, next))
          if (!out.has(n)) out.set(n, d);
  return out;
}

/** Problems with the physical buses on one sheet, as the service reports them. */
export function physicalBusIssues(
  sheet: Sheet,
  insideOf: (block: Block) => Sheet | undefined,
) {
  const issues: { message: string; blockIds: string[]; hint: string }[] = [];
  for (const b of sheet.blocks) {
    if (!isPhysicalBus(b.definition)) continue;
    const problem = elementsError(elementsOf(b));
    if (problem)
      issues.push({
        message: `${b.definition.name}: ${problem}`,
        blockIds: [b.id],
        hint: 'Give each element its own name in the block’s properties.',
      });
  }
  for (const line of busLines(sheet)) {
    const seen = new Map<string, { domain: Domain; at: string }>();
    const reported = new Set<string>();
    for (const end of line)
      for (const [name, domain] of carried(sheet, end, insideOf)) {
        const was = seen.get(name);
        if (was && was.domain !== domain && !reported.has(name)) {
          reported.add(name);
          issues.push({
            message: `The physical bus carries ${name} as ${domainLabelsLower(was.domain)} on one end and ${domainLabelsLower(domain)} on the other.`,
            blockIds: [...new Set([was.at, end.id])].sort(),
            hint: 'Elements with one name are joined, so they must be the same type; rename one.',
          });
        }
        if (!was) seen.set(name, { domain, at: end.id });
      }
  }
  return issues;
}

const LOWER: Partial<Record<Domain, string>> = {
  electrical: 'electrical',
  mechanical: 'rotational',
  translational: 'translational',
  thermal: 'thermal',
  magnetic: 'magnetic',
  threePhase: '3-phase',
};
const domainLabelsLower = (d: Domain) => LOWER[d] ?? d;
