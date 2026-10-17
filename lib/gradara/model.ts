import portUnits from './port-units.json';
import type { SimulationSettings } from './solver';
import { extraBlocks } from './extra-blocks';
import { mslBlocks } from './msl-blocks';
import { portBlocks } from './port-blocks';
import { tagBlocks } from './tag-blocks';
import { physicalBusBlocks } from './physical-bus';
import { retiredBlocks as retired } from './retired-blocks';
export type Domain =
  | 'signal'
  | 'boolean'
  | 'electrical'
  | 'mechanical'
  | 'translational'
  | 'thermal'
  | 'magnetic'
  | 'threePhase'
  /** Named physical connections of any domain in one line (physical-bus.ts). */
  | 'physicalBus';
/** Domains carried by input/output ports; every other domain is a physical terminal. */
export const causalDomains: ReadonlySet<Domain> = new Set([
  'signal',
  'boolean',
]);
export const isCausal = (domain: Domain) => causalDomains.has(domain);
/** Readable names for the domains, used in the library, inspector, and legends. */
export const domainLabels: Record<Domain, string> = {
  signal: 'signal',
  boolean: 'Boolean',
  electrical: 'electrical',
  mechanical: 'rotational',
  translational: 'translational',
  thermal: 'thermal',
  magnetic: 'magnetic',
  threePhase: '3-phase',
  physicalBus: 'physical bus',
};
/** A domain's name at the start of a line or in a menu: "Signal", "3-phase". */
export const domainTitle = (domain: Domain) =>
  domainLabels[domain].charAt(0).toUpperCase() + domainLabels[domain].slice(1);
/** A built-in block that instantiates a Modelica Standard Library class (see server/msl.py). */
export type ModelicaWrapper = {
  class: string;
  /** MSL parameter name → expression over this block's parameter IDs. */
  modifiers?: Record<string, string>;
  /** Block port ID → MSL connector name, when they differ. */
  ports?: Record<string, string>;
};
export type Port = {
  id: string;
  name: string;
  direction: 'input' | 'output' | 'physical';
  domain: Domain;
  side?: 'left' | 'right' | 'bottom' | 'top';
  unit?: string;
  offset?: number;
  /**
   * Signals carried by a bus port (two or more). Absent means one signal. Only bus
   * blocks, subsystem ports, and boundary blocks take a width; `propagateBuses`
   * (buses.ts) derives it from what is connected.
   */
  width?: number;
  /** Element names of a named bus (from a Bus Creator), one per signal. */
  elements?: string[];
};
export type Parameter = {
  id: string;
  name: string;
  value: number;
  unit: string;
  min?: number;
  max?: number;
};
export type LibraryCategoryId =
  | 'sources'
  | 'math'
  | 'continuous'
  | 'discrete'
  | 'nonlinear'
  | 'routing'
  | 'subsystems'
  | 'control'
  | 'electrical'
  | 'semiconductors'
  | 'converters'
  | 'machines'
  | 'threePhase'
  | 'mechanical'
  | 'translational'
  | 'thermal'
  | 'magnetic'
  | 'logic';
export type Definition = {
  kind: string;
  name: string;
  description: string;
  domain: Domain;
  symbol: string;
  ports: Port[];
  parameters: Parameter[];
  equations: string;
  declarations?: string;
  generated?: boolean;
  controller?: boolean;
  category?: LibraryCategoryId;
  keywords?: string[];
  modelica?: ModelicaWrapper;
  /** A subsystem instance; its ports mirror the boundary blocks of `subsystem.ref` (of every variant). */
  subsystem?: SubsystemRef;
  /** A boundary block inside a subsystem (kinds inport, outport, connport). */
  boundary?: { side?: Port['side']; order: number };
  /** C for code generation of a custom block, written once by the AI (see server/ctemplate.py). */
  ctemplate?: CTemplate;
  /** The tag of a Goto, From, or connection label (lib/gradara/tag-blocks.ts). */
  tag?: string;
};
/**
 * One alternative inside for a subsystem instance. A diagram variant has its own
 * definition; a parameter variant shares another variant's `ref` with different
 * promoted `values`. `unused` lists instance ports this variant leaves idle.
 */
export type Variant = {
  id: string;
  name: string;
  ref: string;
  values: Record<string, number>;
  unused?: string[];
};
/** An instance's definition reference; with variants, `ref` is the active variant's. */
export type SubsystemRef = {
  ref: string;
  variants?: Variant[];
  active?: string;
};
/** A named choice of variant per instance, keyed `<sheet>/<instance ID>` (sheet empty at the top). */
export type Configuration = {
  id: string;
  name: string;
  choices: Record<string, string>;
};
/** Statements over placeholders ({u.port}, {y.port}, {p.id}, {x.state}, {h}, {t}); checked on the server. */
export type CTemplate = {
  signature: string;
  state: { name: string; type: 'real' | 'bool' | 'int'; init: number }[];
  output: string[];
  update: string[];
  feedthrough: boolean;
  notes: string;
};
/** A subsystem parameter that sets parameters of blocks inside it. */
export type PromotedParameter = Parameter & {
  targets: { blockId: string; parameterId: string }[];
};
/** The inside of a subsystem, stored once per document and shared by its instances. */
export type SubsystemDefinition = {
  id: string;
  name: string;
  blocks: Block[];
  wires: Wire[];
  junctions?: Junction[];
  nets?: Net[];
  parameters?: PromotedParameter[];
};
export type Block = {
  id: string;
  definition: Definition;
  position: { x: number; y: number };
  size?: { width: number; height: number };
  /** Clockwise quarter turns; presentation only. Size stores the rotated bounds. */
  rotation?: 0 | 90 | 180 | 270;
  /**
   * Mirrored left to right before the rotation, as Simulink's Flip Block; presentation
   * only. Signal flow then reads right to left, as on a feedback path.
   */
  flip?: boolean;
  /** Canvas offset from the centered label below the block; never part of simulation. */
  labelOffset?: { x: number; y: number };
  /**
   * Output ports left unconnected on purpose, drawn with a terminator mark as in
   * Simulink. Presentation only; a wire to the port removes the mark (terminators.ts).
   */
  terminated?: string[];
  /**
   * Output port IDs recorded for Results, wired or not: a terminated output can be
   * logged (logging.ts). Nothing else is recorded unless a wire is logged.
   */
  logged?: string[];
};
export type Wire = {
  id: string;
  source: string;
  sourceHandle: string;
  target: string;
  targetHandle: string;
  /** Bends the user pinned. Absent or [] means an automatic route from the sheet router. */
  waypoints?: { x: number; y: number }[];
  junctions?: { x: number; y: number }[];
};
export type Junction = {
  id: string;
  position: { x: number; y: number };
  domain: Domain;
};
/** One connected net, independent of the number or shape of its drawn wires. */
export type Net = {
  id: string;
  /** User override; absent means a name derived from the anchor block and port. */
  name?: string;
  /** Names retained when previously named physical nets are joined. */
  aliases?: string[];
  /** A port key (block.port) or junction key (j:id) that owns identity on a split. */
  anchor: string;
  wireIds: string[];
  label?: { wireId: string; fraction: number; side: -1 | 1 };
  /** Hides the label even when the net has a custom name. */
  hidden?: boolean;
  /** Shows the label of a net that only has its automatic name. */
  showName?: boolean;
  /** Capture this signal/control net on the next run; physical nets require sensors. */
  logged?: boolean;
};
export type Project = {
  /** 2 when the document has subsystems; version 1 documents are flat. */
  version: 1 | 2;
  subsystems?: SubsystemDefinition[];
  /** Named variant choices; see Configuration. */
  configurations?: Configuration[];
  name: string;
  blocks: Block[];
  wires: Wire[];
  junctions?: Junction[];
  /** Absent only in legacy documents; populated when the document is opened. */
  nets?: Net[];
  duration: number;
  /** Solver settings (lib/gradara/solver.ts); absent means the defaults. */
  simulation?: SimulationSettings;
  /** Record the physical variables of every physical block for Results (logging.ts). */
  logPhysical?: boolean;
  revision: number;
  /** Stable saved-document identity; separate from its optional template origin. */
  modelId?: string;
  exampleId?: string;
  description?: string;
  annotations?: { x: number; y: number; text: string; detail?: string }[];
  plots?: { id: string; label: string; series: string[]; labels?: string[] }[];
};
export const domainColors: Record<Domain, string> = {
  signal: '#1f5fbf',
  electrical: '#b86e00',
  mechanical: '#00897b',
  thermal: '#d1352b',
  boolean: '#a064e0',
  translational: '#5a6b00',
  magnetic: '#c02a8a',
  threePhase: '#3f4650',
  physicalBus: '#6d5a2f',
};
/**
 * Blocks no longer offered in the library. Models that contain them still open and
 * run (a document carries its blocks' definitions). The sinks add no equations, and
 * Results records any output you log, wired or not; the rest were
 * duplicates of Modelica Standard Library blocks (see retired-blocks.ts).
 */
export const RETIRED_KINDS = new Set(retired.map((d) => d.kind));

const allBlocks: Definition[] = [
  ...extraBlocks,
  ...mslBlocks,
  ...portBlocks,
  ...tagBlocks,
  ...physicalBusBlocks,
  ...retired,
];
// Physical units of ports whose meaning the block fixes (a speed sensor reads
// rad/s; a controlled voltage source takes V). One table serves the library and
// the server (lib/gradara/port-units.json), so results from documents saved
// before a unit existed still show it.
const PORT_UNITS = portUnits as unknown as Record<
  string,
  Record<string, string> | string
>;
for (const d of allBlocks)
  for (const port of d.ports)
    if (!port.unit && typeof PORT_UNITS[d.kind] === 'object')
      port.unit =
        (PORT_UNITS[d.kind] as Record<string, string>)[port.id] || undefined;
export const library: Definition[] = allBlocks.filter(
  (d) => !RETIRED_KINDS.has(d.kind),
);
/** Retired definitions, for documents made before they left the library. */
export const retiredBlocks: Definition[] = allBlocks.filter((d) =>
  RETIRED_KINDS.has(d.kind),
);
/** A library definition, or a retired one an older document may still use. */
export const definitionFor = (kind: string) =>
  library.find((d) => d.kind === kind) ??
  retiredBlocks.find((d) => d.kind === kind);
const block = (kind: string, id: string, x: number, y: number): Block => ({
  id,
  definition: structuredClone(library.find((d) => d.kind === kind)!),
  position: { x, y },
});
export function initialProject(): Project {
  const blocks = [
    // On the sheet grid, with each connection a straight run where one is possible.
    block('step', 'reference', 0, 48),
    block('pi', 'controller', 240, 64),
    block('signalVoltage', 'drive', 472, 48),
    block('dcPmMachine', 'motor', 704, 48),
    block('rotDamper', 'friction', 952, 48),
    block('rotFixed', 'housing', 1120, 48),
    block('rotSpeedSensor', 'sensor', 224, 336),
    block('ground', 'ground', 512, 280),
  ];
  const pairs = [
    ['reference', 'y', 'controller', 'reference'],
    ['controller', 'y', 'drive', 'v'],
    ['drive', 'p', 'motor', 'pin_ap'],
    ['drive', 'n', 'ground', 'p'],
    ['motor', 'pin_an', 'ground', 'p'],
    ['motor', 'flange', 'friction', 'flange_a'],
    ['friction', 'flange_b', 'housing', 'flange'],
    ['motor', 'flange', 'sensor', 'flange'],
    ['sensor', 'w', 'controller', 'measured'],
  ];
  const set = (id: string, values: Record<string, number>) => {
    const definition = blocks.find((b) => b.id === id)!.definition;
    for (const parameter of definition.parameters)
      if (parameter.id in values) parameter.value = values[parameter.id];
  };
  const reference = blocks[0].definition;
  reference.name = 'Speed reference';
  reference.parameters[0].name = 'Target speed';
  reference.parameters[0].unit = 'rad/s';
  set('reference', { height: 100, startTime: 0.2 });
  set('controller', { kp: 0.6, ki: 2, limit: 24, samplePeriod: 0.001 });
  // A 24 V, 2 A machine whose constant (24 V − 1.2 Ω · 2 A) / 144 rad/s is 0.15 V·s/rad.
  set('motor', {
    VaNominal: 24,
    IaNominal: 2,
    wNominal: 144,
    Ra: 1.2,
    La: 0.02,
    Jr: 0.02,
  });
  set('friction', { d: 0.002 });
  return {
    version: 1,
    name: 'Motor speed control',
    blocks,
    wires: pairs.map(([source, sourceHandle, target, targetHandle], i) => ({
      id: `wire${i}`,
      source,
      sourceHandle,
      target,
      targetHandle,
    })),
    duration: 4,
    revision: 1,
  };
}
export function portOf(project: Project, blockId: string, portId: string) {
  return project.blocks
    .find((b) => b.id === blockId)
    ?.definition.ports.find((p) => p.id === portId);
}
export function compatible(a?: Port, b?: Port) {
  return (
    !!a &&
    !!b &&
    a.domain === b.domain &&
    ((a.direction === 'physical' && b.direction === 'physical') ||
      (a.direction === 'output' && b.direction === 'input') ||
      (a.direction === 'input' && b.direction === 'output'))
  );
}
