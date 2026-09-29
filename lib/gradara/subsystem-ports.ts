/**
 * Subsystem ports, edited from either side of the boundary.
 *
 * Inside, a port is a boundary block (a pill). Outside, it is a port of every
 * instance. These operations change the pills and keep the instance in the open
 * sheet up to date at once; `writeScope` brings every other instance along.
 * Ports are numbered like Simulink's: inputs, outputs, and terminals each from 1.
 */
import type {
  Block,
  Definition,
  Domain,
  Port,
  Project,
  SubsystemDefinition,
  Wire,
} from './model';
import {
  boundaryBlocks,
  boundaryDefinition,
  findSubsystem,
  instanceDefinitionFor,
  isBoundary,
  newId,
  refsOf,
  renumberBoundaries,
  subsystemsOf,
  type BoundaryKind,
} from './hierarchy';
import { boundaryDomains } from './port-blocks';
import { defaultBlockSize, snapBlockPosition } from './block-design';
import { blockSize } from './canvas';
import { reconcileNets } from './net-registry';

export const portKindLabels: Record<BoundaryKind, string> = {
  inport: 'Input',
  outport: 'Output',
  connport: 'Terminal',
};

export type Side = NonNullable<Port['side']>;

/**
 * How ports are presented: every port is an input or an output of the subsystem,
 * and its type is what it carries. A physical type makes it a terminal, which is
 * an input or output only in where it sits (left or right) on the block.
 */
export type PortRole = 'input' | 'output';
export const portTypes: Domain[] = [
  'signal',
  'boolean',
  'electrical',
  'mechanical',
  'translational',
  'thermal',
  'magnetic',
  'threePhase',
];
const causal = (d: Domain) => d === 'signal' || d === 'boolean';
export const roleOf = (kind: BoundaryKind, side?: Side): PortRole =>
  kind === 'outport' || (kind === 'connport' && side === 'right')
    ? 'output'
    : 'input';
/** The boundary block behind a role and type. */
export function kindFor(role: PortRole, type: Domain) {
  return causal(type)
    ? { kind: (role === 'input' ? 'inport' : 'outport') as BoundaryKind }
    : {
        kind: 'connport' as BoundaryKind,
        side: (role === 'input' ? 'left' : 'right') as Side,
      };
}

export type PortChange = {
  /** Input or output, keeping the type where it can. */
  role?: PortRole;
  /** What the port carries; a physical type makes it a terminal. */
  type?: Domain;
  name?: string;
  kind?: BoundaryKind;
  domain?: Domain;
  side?: Side;
  /** 1-based number among ports of the same kind. */
  number?: number;
};

type Sheet = { blocks: Block[]; wires: Wire[] };

const defaultDomain = (kind: BoundaryKind): Domain =>
  kind === 'connport' ? 'electrical' : 'signal';

/** Default side outside: inputs left, outputs right, terminals left. */
export const defaultSide = (kind: BoundaryKind): Side =>
  kind === 'outport' ? 'right' : 'left';

const mirror = {
  left: 'right',
  right: 'left',
  top: 'bottom',
  bottom: 'top',
} as const;

/** A boundary definition of `kind`, keeping the name, number, and side it had. */
function rebuild(
  d: Definition,
  kind: BoundaryKind,
  domain: Domain,
  order: number,
  side: Side | undefined,
): Definition {
  const next = boundaryDefinition(kind, d.name, domain, order);
  const outside = side ?? (kind === 'connport' ? 'left' : undefined);
  return {
    ...next,
    name: d.name,
    symbol: d.symbol,
    ...(d.category ? { category: d.category } : {}),
    boundary: { order, ...(outside ? { side: outside } : {}) },
    ports: next.ports.map((p) => ({
      ...p,
      // A terminal pill's connector faces into the sheet.
      ...(kind === 'connport' && outside ? { side: mirror[outside] } : {}),
    })),
  };
}

function withBoundary<T extends Sheet>(
  sheet: T,
  id: string,
  make: (d: Definition) => Definition,
  dropWires: boolean,
): T {
  const block = sheet.blocks.find((b) => b.id === id);
  if (!block || !isBoundary(block)) return sheet;
  const definition = make(block.definition);
  if (definition === block.definition) return sheet;
  return {
    ...sheet,
    blocks: sheet.blocks.map((b) =>
      b.id === id
        ? { ...b, definition, size: b.size ?? defaultBlockSize(definition) }
        : b,
    ),
    wires: dropWires
      ? sheet.wires.filter((w) => w.source !== id && w.target !== id)
      : sheet.wires,
  };
}

/** Change a port between input, output, and terminal. Its wires go; it becomes the last of its new kind. */
export function setPortKind<T extends Sheet>(
  sheet: T,
  id: string,
  kind: BoundaryKind,
): T {
  return renumberBoundaries(
    withBoundary(
      sheet,
      id,
      (d) => {
        if (d.kind === kind) return d;
        const domain = boundaryDomains(kind).includes(d.ports[0].domain)
          ? d.ports[0].domain
          : defaultDomain(kind);
        const side =
          kind === 'connport'
            ? d.boundary?.side === 'right'
              ? 'right'
              : 'left'
            : undefined;
        return rebuild(d, kind, domain, Number.MAX_SAFE_INTEGER, side);
      },
      true,
    ),
  );
}

/** Change what a port carries: signal or Boolean, or a physical domain. Its wires go. */
export function setPortDomain<T extends Sheet>(
  sheet: T,
  id: string,
  domain: Domain,
): T {
  return withBoundary(
    sheet,
    id,
    (d) => {
      const kind = d.kind as BoundaryKind;
      if (
        d.ports[0].domain === domain ||
        !boundaryDomains(kind).includes(domain)
      )
        return d;
      return rebuild(d, kind, domain, d.boundary!.order, d.boundary?.side);
    },
    true,
  );
}

/** Which side of the subsystem block the port sits on. Wires stay. */
export function setPortSide<T extends Sheet>(
  sheet: T,
  id: string,
  side: Side,
): T {
  return withBoundary(
    sheet,
    id,
    (d) =>
      d.boundary?.side === side
        ? d
        : rebuild(
            d,
            d.kind as BoundaryKind,
            d.ports[0].domain,
            d.boundary!.order,
            side,
          ),
    false,
  );
}

/** Give a port another number among its kind; the others shift, as in Simulink. */
export function setPortNumber<T extends Sheet>(
  sheet: T,
  id: string,
  number: number,
): T {
  const block = sheet.blocks.find((b) => b.id === id);
  if (!block || !isBoundary(block)) return sheet;
  const same = boundaryBlocks(sheet).filter(
    (b) => b.definition.kind === block.definition.kind,
  );
  const from = same.findIndex((b) => b.id === id);
  const to = Math.max(0, Math.min(same.length - 1, Math.round(number) - 1));
  if (from === to) return sheet;
  const orders = same.map((b) => b.definition.boundary!.order);
  const moved = [...same];
  moved.splice(to, 0, ...moved.splice(from, 1));
  const order = new Map(moved.map((b, i) => [b.id, orders[i]]));
  return renumberBoundaries({
    ...sheet,
    blocks: sheet.blocks.map((b) =>
      order.has(b.id)
        ? {
            ...b,
            definition: {
              ...b.definition,
              boundary: { ...b.definition.boundary!, order: order.get(b.id)! },
            },
          }
        : b,
    ),
  });
}

/** Rename a port; names stay unique among the sheet's ports. */
export function renamePort<T extends Sheet>(
  sheet: T,
  id: string,
  name: string,
): T {
  const wanted = name.trim().slice(0, 60);
  if (!wanted) return sheet;
  const taken = new Set(
    boundaryBlocks(sheet)
      .filter((b) => b.id !== id)
      .map((b) => b.definition.name),
  );
  let unique = wanted;
  for (let i = 2; taken.has(unique); i++) unique = `${wanted}${i}`;
  return withBoundary(
    sheet,
    id,
    (d) =>
      d.name === unique
        ? d
        : {
            ...d,
            name: unique,
            ports: d.ports.map((p) => ({ ...p, name: unique })),
          },
    false,
  );
}

/** Apply one change to a port, from inside the subsystem. */
export function editPort<T extends Sheet>(
  sheet: T,
  id: string,
  change: PortChange,
): T {
  let next = sheet;
  if (change.role || change.type) {
    const block = sheet.blocks.find((b) => b.id === id);
    if (block && isBoundary(block)) {
      const now = portSummary(block);
      const role = change.role ?? now.role;
      const type = change.type ?? now.domain;
      const target = kindFor(role, type);
      if (target.kind !== now.kind) next = setPortKind(next, id, target.kind);
      next = setPortDomain(next, id, type);
      if (target.side && (target.kind !== now.kind || role !== now.role))
        next = setPortSide(next, id, target.side);
    }
  }
  if (change.kind) next = setPortKind(next, id, change.kind);
  if (change.domain) next = setPortDomain(next, id, change.domain);
  if (change.side) next = setPortSide(next, id, change.side);
  if (change.name !== undefined) next = renamePort(next, id, change.name);
  if (change.number) next = setPortNumber(next, id, change.number);
  return next;
}

/** Where a new pill goes: in its kind's column, below the last one. */
function placeFor(
  sheet: Sheet,
  kind: BoundaryKind,
  side: Side,
  size: { width: number; height: number },
) {
  const inner = sheet.blocks.filter((b) => !isBoundary(b));
  const pills = sheet.blocks.filter(isBoundary);
  const left = inner.length ? Math.min(...inner.map((b) => b.position.x)) : 200;
  const right = inner.length
    ? Math.max(...inner.map((b) => b.position.x + blockSize(b).width))
    : 200;
  const onRight =
    kind === 'outport' || (kind === 'connport' && side === 'right');
  const column = pills.filter((b) => {
    const k = b.definition.kind as BoundaryKind;
    const s =
      b.definition.boundary?.side ?? (k === 'outport' ? 'right' : 'left');
    return (k === 'outport' || (k === 'connport' && s === 'right')) === onRight;
  });
  const x = column.length
    ? column[0].position.x
    : onRight
      ? right + 100
      : left - 100 - size.width;
  const y = column.length
    ? Math.max(...column.map((b) => b.position.y + blockSize(b).height)) + 40
    : inner.length
      ? Math.min(...inner.map((b) => b.position.y))
      : 80;
  return snapBlockPosition({ x, y }, size);
}

/** Add a port to a sheet: a new pill named in1, out1, terminal1, … by default. */
export function addPort<T extends Sheet>(
  sheet: T,
  spec: {
    kind: BoundaryKind;
    domain?: Domain;
    name?: string;
    side?: Side;
    /** Where to put the pill; by default, below the others of its column. */
    position?: { x: number; y: number };
  },
  id = newId('p_'),
): T {
  const kind = spec.kind;
  const domain =
    spec.domain && boundaryDomains(kind).includes(spec.domain)
      ? spec.domain
      : defaultDomain(kind);
  const base =
    kind === 'inport' ? 'in' : kind === 'outport' ? 'out' : 'terminal';
  const names = new Set(boundaryBlocks(sheet).map((b) => b.definition.name));
  const count = boundaryBlocks(sheet).filter(
    (b) => b.definition.kind === kind,
  ).length;
  let name = spec.name?.trim().slice(0, 60) || `${base}${count + 1}`;
  for (let i = 2; names.has(name); i++)
    name = `${spec.name?.trim() || base}${spec.name?.trim() ? i : count + i}`;
  const side =
    spec.side && spec.side !== defaultSide(kind)
      ? spec.side
      : kind === 'connport'
        ? 'left'
        : undefined;
  const definition = rebuild(
    boundaryDefinition(kind, name, domain, 0),
    kind,
    domain,
    Number.MAX_SAFE_INTEGER,
    side,
  );
  const size = defaultBlockSize(definition);
  const block: Block = {
    id,
    definition,
    position: spec.position
      ? snapBlockPosition(
          {
            x: spec.position.x - size.width / 2,
            y: spec.position.y - size.height / 2,
          },
          size,
        )
      : placeFor(sheet, kind, side ?? defaultSide(kind), size),
    size,
  };
  return renumberBoundaries({ ...sheet, blocks: [...sheet.blocks, block] });
}

export function removePort<T extends Sheet>(sheet: T, id: string): T {
  if (!sheet.blocks.some((b) => b.id === id && isBoundary(b))) return sheet;
  return renumberBoundaries({
    ...sheet,
    blocks: sheet.blocks.filter((b) => b.id !== id),
    wires: sheet.wires.filter((w) => w.source !== id && w.target !== id),
  });
}

/** Keep a sheet's net records in step after its wires changed. */
function reconciled<T extends Sheet & { nets?: Project['nets'] }>(
  view: Project,
  before: T,
  after: T,
): T {
  if (
    after.wires.length === before.wires.length &&
    after.blocks === before.blocks
  )
    return after;
  const nets = reconcileNets(
    { ...view, ...after } as Project,
    { ...view, ...before } as Project,
  ).nets;
  return { ...after, nets };
}

/**
 * Change the insides of an instance (every variant it can show) and bring that
 * instance in the open sheet up to date. Wires to ports that went away or changed
 * direction or domain are removed.
 */
export function editInstance(
  view: Project,
  instanceId: string,
  change: (sheet: SubsystemDefinition) => SubsystemDefinition,
): Project {
  const block = view.blocks.find((b) => b.id === instanceId);
  if (!block) return view;
  const refs = new Set(refsOf(block.definition));
  if (!refs.size) return view;
  const subsystems = subsystemsOf(view).map((s) =>
    refs.has(s.id) ? reconciled(view, s, change(s)) : s,
  );
  const next = { ...view, subsystems };
  const definition = instanceDefinitionFor(next, block);
  if (!definition) return view;
  const before = new Map(block.definition.ports.map((p) => [p.id, p]));
  const kept = new Set(
    definition.ports
      .filter((p) => {
        const old = before.get(p.id);
        return (
          !old || (old.direction === p.direction && old.domain === p.domain)
        );
      })
      .map((p) => p.id),
  );
  const size = defaultBlockSize(definition);
  const current = block.size ?? blockSize(block);
  const blocks = view.blocks.map((b) =>
    b.id === instanceId
      ? {
          ...b,
          definition,
          size: {
            width: Math.max(current.width, size.width),
            height: Math.max(current.height, size.height),
          },
        }
      : b,
  );
  const wires = view.wires.filter(
    (w) =>
      (w.source !== instanceId || kept.has(w.sourceHandle)) &&
      (w.target !== instanceId || kept.has(w.targetHandle)),
  );
  return reconciled(view, view, { ...next, blocks, wires });
}

/** Add a port to an instance from outside. Returns the new port's ID. */
export function addInstancePort(
  view: Project,
  instanceId: string,
  spec: { kind: BoundaryKind; domain?: Domain; name?: string; side?: Side },
): { project: Project; portId: string } {
  const portId = newId('p_');
  return {
    project: editInstance(view, instanceId, (s) => addPort(s, spec, portId)),
    portId,
  };
}

export const editInstancePort = (
  view: Project,
  instanceId: string,
  portId: string,
  change: PortChange,
) => editInstance(view, instanceId, (s) => editPort(s, portId, change));

export const removeInstancePort = (
  view: Project,
  instanceId: string,
  portId: string,
) => editInstance(view, instanceId, (s) => removePort(s, portId));

/** The pills behind an instance's ports (from its active inside), for listing them. */
export function instancePortBlocks(view: Project, instance: Block): Block[] {
  const ref = instance.definition.subsystem?.ref;
  const sub = ref ? findSubsystem(view, ref) : undefined;
  return sub ? boundaryBlocks(sub) : [];
}

/** A port as the outside sees it: kind, number, and side. */
export function portSummary(block: Block) {
  const kind = block.definition.kind as BoundaryKind;
  return {
    id: block.id,
    kind,
    name: block.definition.name,
    domain: block.definition.ports[0].domain,
    number: Number(block.definition.symbol) || undefined,
    side: block.definition.boundary?.side ?? defaultSide(kind),
    role: roleOf(kind, block.definition.boundary?.side),
  };
}
