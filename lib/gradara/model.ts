import { controlBlocks } from './control-blocks';
import { extraBlocks } from './extra-blocks';
import { powerBlocks } from './power-blocks';
export type Domain = 'signal' | 'electrical' | 'mechanical' | 'thermal';
export type Port = {
  id: string;
  name: string;
  direction: 'input' | 'output' | 'physical';
  domain: Domain;
  side?: 'left' | 'right' | 'bottom' | 'top';
  unit?: string;
  offset?: number;
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
  | 'control'
  | 'sinks'
  | 'electrical'
  | 'mechanical';
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
};
export type Block = {
  id: string;
  definition: Definition;
  position: { x: number; y: number };
  size?: { width: number; height: number };
  /** Canvas offset from the centered label below the block; never part of simulation. */
  labelOffset?: { x: number; y: number };
};
export type Wire = {
  id: string;
  source: string;
  sourceHandle: string;
  target: string;
  targetHandle: string;
  /** Undefined permits automatic orthogonal routing; [] explicitly preserves a straight route. */
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
  hidden?: boolean;
  /** Capture this signal/control net on the next run; physical nets require sensors. */
  logged?: boolean;
};
export type Project = {
  version: 1;
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
  signal: '#336184',
  electrical: '#aa6b20',
  mechanical: '#298b82',
  thermal: '#cf6b68',
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
export const library: Definition[] = [
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
      'Sampled speed control with output saturation and a bounded integral state.',
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
];
const block = (kind: string, id: string, x: number, y: number): Block => ({
  id,
  definition: structuredClone(library.find((d) => d.kind === kind)!),
  position: { x, y },
});
export function initialProject(): Project {
  const blocks = [
    block('step', 'reference', 0, 85),
    block('pi', 'controller', 225, 65),
    block('voltage', 'drive', 470, 85),
    block('motor', 'motor', 705, 85),
    block('inertia', 'load', 705, 335),
    block('sensor', 'sensor', 225, 335),
    block('ground', 'ground', 495, 345),
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
