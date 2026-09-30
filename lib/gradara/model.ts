import { controlBlocks } from './control-blocks';
import { extraBlocks } from './extra-blocks';
import { mslBlocks } from './msl-blocks';
import { portBlocks } from './port-blocks';
import { powerBlocks } from './power-blocks';
export type Domain =
  | 'signal'
  | 'boolean'
  | 'electrical'
  | 'mechanical'
  | 'translational'
  | 'thermal'
  | 'magnetic'
  | 'threePhase';
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
};
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
  /** Canvas offset from the centered label below the block; never part of simulation. */
  labelOffset?: { x: number; y: number };
  /**
   * Output ports left unconnected on purpose, drawn with a terminator mark as in
   * Simulink. Presentation only; a wire to the port removes the mark (terminators.ts).
   */
  terminated?: string[];
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
};
const p = (
  id: string,
  name: string,
  value: number,
  unit = '',
  min?: number,
): Parameter => ({ id, name, value, unit, min });
const input = (id = 'u', name = 'in'): Port => ({
  id,
  name,
  direction: 'input',
  domain: 'signal',
});
const output = (id = 'y', name = 'out'): Port => ({
  id,
  name,
  direction: 'output',
  domain: 'signal',
});
const physical = (
  id: string,
  name: string,
  domain: Domain,
  side: Port['side'],
): Port => ({ id, name, domain, side, direction: 'physical' });
/**
 * Blocks no longer offered in the library. Models that contain them still open and
 * run (a document carries its blocks' definitions); these add no equations, and
 * Results already lists every block output and logged signal.
 */
export const RETIRED_KINDS = new Set(['scope', 'display', 'terminator']);

const allBlocks: Definition[] = [
  ...powerBlocks,
  ...controlBlocks,
  {
    kind: 'step',
    name: 'Step',
    description: 'A step change from zero to a final value.',
    domain: 'signal',
    symbol: 'step',
    ports: [output()],
    parameters: [
      p('height', 'Height', 1),
      p('startTime', 'Start time', 0.2, 's', 0),
    ],
    equations: 'y = if time < startTime then 0 else height;',
    keywords: ['source', 'reference'],
  },
  {
    kind: 'pi',
    name: 'PI controller',
    description:
      'Sampled PI control with output saturation and a bounded integral state.',
    domain: 'signal',
    symbol: 'PI',
    controller: true,
    ports: [input('reference', 'ref'), input('measured', 'meas'), output()],
    parameters: [
      p('kp', 'Proportional gain', 0.6),
      p('ki', 'Integral gain', 2),
      p('limit', 'Voltage limit', 24, 'V', 0.1),
      p('samplePeriod', 'Sample period', 0.001, 's', 0.0001),
    ],
    declarations: 'discrete Real integral(start=0, fixed=true);\nReal error;',
    equations:
      'error = reference - measured;\nwhen sample(0, samplePeriod) then\n  integral = max(-limit, min(limit, pre(integral) + samplePeriod*ki*error));\n  y = max(-limit, min(limit, kp*error + integral));\nend when;',
  },
  {
    kind: 'voltage',
    name: 'Voltage drive',
    description: 'An ideal voltage source driven by a control signal.',
    domain: 'electrical',
    symbol: 'V',
    ports: [
      input(),
      physical('p', '+', 'electrical', 'right'),
      physical('n', '−', 'electrical', 'bottom'),
    ],
    parameters: [],
    equations: 'v = u;',
  },
  {
    kind: 'motor',
    name: 'DC motor',
    description:
      'Armature resistance and inductance coupled to a rotational shaft.',
    domain: 'electrical',
    symbol: 'M',
    ports: [
      physical('p', '+', 'electrical', 'left'),
      physical('n', '−', 'electrical', 'bottom'),
      physical('flange', 'shaft', 'mechanical', 'bottom'),
    ],
    parameters: [
      p('R', 'Resistance', 1.2, 'Ω', 0.001),
      p('L', 'Inductance', 0.02, 'H', 0.00001),
      p('k', 'Motor constant', 0.15, 'N·m/A', 0.0001),
    ],
    equations: 'L*der(i) = v - R*i - k*w;\ntau = k*i;',
  },
  {
    kind: 'inertia',
    name: 'Inertia & load',
    description: 'A rotating load with inertia and viscous friction.',
    domain: 'mechanical',
    symbol: 'J',
    ports: [
      physical('a', 'shaft', 'mechanical', 'top'),
      physical('b', 'shaft', 'mechanical', 'left'),
    ],
    parameters: [
      p('J', 'Inertia', 0.02, 'kg·m²', 0.00001),
      p('damping', 'Viscous friction', 0.002, 'N·m·s', 0),
    ],
    equations: 'J*der(w) = tau - damping*w;',
  },
  {
    kind: 'sensor',
    name: 'Speed sensor',
    description: 'Measures shaft speed without loading the mechanical system.',
    domain: 'mechanical',
    symbol: 'ω',
    ports: [
      physical('flange', 'shaft', 'mechanical', 'right'),
      { ...output(), side: 'left' },
    ],
    parameters: [],
    equations: 'y = der(flange.phi);\nflange.tau = 0;',
  },
  {
    kind: 'ground',
    name: 'Ground',
    description: 'Electrical reference potential.',
    domain: 'electrical',
    symbol: 'ground',
    ports: [physical('p', '0 V', 'electrical', 'top')],
    parameters: [],
    equations: 'p.v = 0;',
  },
  {
    kind: 'gain',
    name: 'Gain',
    description: 'Multiply an input by an adjustable gain.',
    domain: 'signal',
    symbol: 'K',
    ports: [input(), output()],
    parameters: [p('k', 'Gain', 1)],
    equations: 'y = k*u;',
  },
  {
    kind: 'filter',
    name: 'Low-pass filter',
    description: 'First-order continuous filter.',
    domain: 'signal',
    symbol: '1/(τs+1)',
    ports: [input(), output()],
    parameters: [p('tau', 'Time constant', 0.05, 's', 0.00001)],
    declarations: 'Real x(start=0, fixed=true);',
    equations: 'der(x) = (u-x)/tau;\ny = x;',
  },
  {
    kind: 'saturation',
    name: 'Saturation',
    description: 'Clamp a signal between lower and upper limits.',
    domain: 'signal',
    symbol: 'sat',
    ports: [input(), output()],
    parameters: [p('lower', 'Lower limit', -24), p('upper', 'Upper limit', 24)],
    equations: 'y = max(lower, min(upper, u));',
  },
  ...extraBlocks,
  ...mslBlocks,
  ...portBlocks,
];
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
    // The controller is unsized, so it opens at its 128 × 96 minimum, grown about
    // its center to (224, 48).
    block('step', 'reference', 0, 48),
    block('pi', 'controller', 240, 64),
    block('voltage', 'drive', 472, 48),
    block('motor', 'motor', 704, 48),
    block('inertia', 'load', 728, 336),
    block('sensor', 'sensor', 224, 336),
    block('ground', 'ground', 512, 280),
  ];
  const pairs = [
    ['reference', 'y', 'controller', 'reference'],
    ['controller', 'y', 'drive', 'u'],
    ['drive', 'p', 'motor', 'p'],
    ['drive', 'n', 'ground', 'p'],
    ['motor', 'n', 'ground', 'p'],
    ['motor', 'flange', 'load', 'a'],
    ['load', 'b', 'sensor', 'flange'],
    ['sensor', 'y', 'controller', 'measured'],
  ];
  const reference = blocks[0].definition;
  reference.name = 'Speed reference';
  reference.parameters[0].name = 'Target speed';
  reference.parameters[0].unit = 'rad/s';
  reference.parameters[0].value = 100;
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
