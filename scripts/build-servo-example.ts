import { writeFileSync } from 'node:fs';
import {
  library,
  type Block,
  type Port,
  type Project,
  type Wire,
} from '../lib/gradara/model';
import { defaultBlockSize } from '../lib/gradara/block-design';
import { reconcileNets } from '../lib/gradara/net-registry';

// Same topology and geometry as the DC speed example, with a position loop.
const blocks: Block[] = [];
function block(
  id: string,
  kind: string,
  name: string,
  x: number,
  y: number,
  params: Record<string, number> = {},
  above = false,
) {
  const definition = structuredClone(library.find((d) => d.kind === kind)!);
  if (!definition) throw new Error(`Missing ${kind}`);
  definition.name = name;
  for (const p of definition.parameters)
    if (p.id in params) p.value = params[p.id];
  const size = defaultBlockSize(definition);
  const b: Block = { id, definition, position: { x, y }, size };
  if (above) b.labelOffset = { x: 0, y: -size.height - 36 };
  blocks.push(b);
  return b;
}
function side(b: Block, port: string, s: Port['side'], offset?: number) {
  const p = b.definition.ports.find((p) => p.id === port)!;
  p.side = s;
  if (offset === undefined) delete p.offset;
  else p.offset = offset;
}

block('reference', 'step', 'Position request', 40, 192, {
  height: 1,
  startTime: 0.2,
});
const controller = block(
  'controller',
  'discretePID',
  'Position controller',
  240,
  176,
  { kp: 30, ki: 1, kd: 3, filterTime: 0.01, limit: 24, samplePeriod: 0.001 },
  true,
);
side(controller, 'measured', 'bottom');
block('drive', 'voltage', 'Voltage drive', 472, 176, {}, true);
const motor = block(
  'motor',
  'motor',
  'DC motor',
  704,
  176,
  { R: 1.2, L: 0.02, k: 0.15 },
  true,
);
// Separate the negative electrical terminal and the mechanical shaft.
side(motor, 'n', 'bottom', 25);
side(motor, 'flange', 'bottom', 75);
block('load', 'inertia', 'Load inertia', 736, 416, {
  J: 0.02,
  damping: 0.002,
});
block('sensor', 'angleSensor', 'Angle sensor', 240, 416);
block('ground', 'ground', 'Ground', 584, 336);

const wires: Wire[] = [];
function wire(
  id: string,
  source: string,
  sourceHandle: string,
  target: string,
  targetHandle: string,
  points: number[][] = [],
) {
  wires.push({
    id,
    source,
    sourceHandle,
    target,
    targetHandle,
    waypoints: points.map(([x, y]) => ({ x, y })),
  });
}
wire('wire0', 'reference', 'y', 'controller', 'reference');
wire('wire1', 'controller', 'y', 'drive', 'u');
wire('wire2', 'drive', 'p', 'motor', 'p');
wire('wire3', 'drive', 'n', 'servo_return', 'node', [[536, 320]]);
wire('wire4', 'motor', 'n', 'servo_return', 'node', [[736, 320]]);
wire('wire5', 'motor', 'flange', 'load', 'a');
wire('wire6', 'load', 'b', 'sensor', 'flange');
wire('wire7', 'sensor', 'y', 'controller', 'measured', [
  [176, 464],
  [176, 344],
  [304, 344],
]);
wire('servo_ground', 'servo_return', 'node', 'ground', 'p');

let project: Project = {
  version: 1,
  name: 'Servo position control',
  exampleId: 'servo',
  description:
    'DC motor position servo: a 1 rad step at 0.2 s, a sampled PID at 1 kHz with a clamped integral and a ±24 V output limit, an ideal voltage drive, and a measured shaft angle. The controller is built for C export; its exported step function reproduces the sampled equations exactly.',
  duration: 2,
  revision: 0,
  blocks,
  wires,
  junctions: [
    {
      id: 'servo_return',
      domain: 'electrical',
      position: { x: 604, y: 320 },
    },
  ],
  annotations: [
    {
      x: 40,
      y: 64,
      text: '01  POSITION CONTROL',
      detail: '1 rad step · sampled PID at 1 kHz · exportable to C',
    },
    {
      x: 472,
      y: 64,
      text: '02  ELECTRICAL DRIVE',
      detail: '±24 V drive · armature dynamics',
    },
    {
      x: 240,
      y: 552,
      text: '03  MECHANICAL LOAD',
      detail: 'Shaft inertia · damping · measured angle',
    },
  ],
  plots: [
    {
      id: 'angle',
      label: 'Shaft angle',
      series: ['sensor.y', 'reference.y'],
      labels: ['Measured angle', 'Position request'],
    },
    {
      id: 'voltage',
      label: 'Controller output',
      series: ['controller.y'],
      labels: ['Drive voltage command'],
    },
    {
      id: 'current',
      label: 'Armature current',
      series: ['motor.i'],
      labels: ['Armature current'],
    },
  ],
};
project = reconcileNets(project);
for (const [i, net] of (project.nets ?? []).entries()) {
  net.id = `net_servo_${i}`;
  const feedback = net.wireIds.includes('wire7');
  net.hidden = !feedback;
  if (feedback) {
    net.name = 'θ measured';
    net.label = { wireId: 'wire7', fraction: 0.5729166666666666, side: -1 };
  } else {
    delete net.name;
    delete net.label;
  }
}
writeFileSync(
  'models/examples/servo.json',
  JSON.stringify(project, null, 2) + '\n',
);
