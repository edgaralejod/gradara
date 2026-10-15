/**
 * The servo position-control template (models/examples/servo.json): the DC speed
 * loop's machine under a sampled PID position controller built for C export. Run
 * with `npx tsx scripts/build-servo-example.ts`.
 */
import { writeFileSync } from 'node:fs';
import type { Project } from '../lib/gradara/model';
import { assemble } from './block-examples/assemble';
import type { ExampleSpec } from './block-examples/types';

const spec: ExampleSpec = {
  id: 'servo',
  title: 'Servo position control',
  area: 'Machines',
  summary: 'A DC motor position servo with a sampled PID.',
  description:
    'DC motor position servo: a 1 rad step at 0.2 s, a sampled PID at 1 kHz with a clamped integral and a ±24 V output limit, a controlled voltage source, the same permanent-magnet DC machine as the speed loop, and a measured shaft angle. The controller is built for C export; its exported step function reproduces the sampled equations exactly.',
  duration: 2,
  blocks: [
    [
      'reference',
      'step',
      'Position request',
      [72, 216],
      { height: 1, startTime: 0.2 },
    ],
    [
      'controller',
      'discretePID',
      'Position controller (PID)',
      [248, 216],
      {
        kp: 30,
        ki: 1,
        kd: 3,
        filterTime: 0.01,
        limit: 24,
        samplePeriod: 0.001,
      },
      { ports: { measured: 'bottom' }, label: 'above' },
    ],
    [
      'drive',
      'signalVoltage',
      'Voltage drive',
      [416, 216],
      {},
      { label: [-84, 8] },
    ],
    [
      'isens',
      'currentSensor',
      'Armature current',
      [528, 176],
      {},
      { label: 'above' },
    ],
    [
      'motor',
      'dcPmMachine',
      'DC motor',
      [680, 192],
      {
        VaNominal: 24,
        IaNominal: 2,
        wNominal: 144,
        Ra: 1.2,
        La: 0.02,
        Jr: 0.02,
      },
      { label: 'above' },
    ],
    [
      'friction',
      'rotDamper',
      'Friction 0.002',
      [856, 192],
      { d: 0.002 },
      { label: 'above' },
    ],
    ['housing', 'rotFixed', 'Housing', [920, 240]],
    ['ground', 'ground', 'Ground', [528, 352]],
    ['sensor', 'angleSensor', 'Angle sensor', [680, 376], {}, { flip: true }],
  ],
  links: [
    ['reference.y', 'controller.reference'],
    ['controller.y', 'drive.v'],
    ['drive.p', 'isens.p'],
    ['isens.n', 'motor.pin_ap'],
    ['motor.pin_an', 'ground.p'],
    ['drive.n', 'ground.p'],
    ['motor.flange', 'friction.flange_a'],
    ['friction.flange_b', 'housing.flange'],
    ['motor.flange', 'sensor.flange'],
    ['sensor.y', 'controller.measured'],
  ],
  plots: [
    {
      label: 'Shaft angle',
      series: ['sensor.y', 'reference.y'],
      labels: ['Measured angle', 'Position request'],
    },
    {
      label: 'Controller output',
      series: ['controller.y'],
      labels: ['Drive voltage command'],
    },
    {
      label: 'Armature current',
      series: ['isens.y'],
      labels: ['Armature current'],
    },
  ],
  checks: [],
  about: [],
};

let project: Project = assemble(spec);
project = {
  ...project,
  version: 1,
  exampleId: 'servo',
  name: spec.title,
  description: spec.description,
  revision: 0,
  annotations: [
    {
      x: 24,
      y: 56,
      text: '01  POSITION CONTROL',
      detail: '1 rad step · sampled PID at 1 kHz · exportable to C',
    },
    {
      x: 416,
      y: 56,
      text: '02  ELECTRICAL DRIVE',
      detail: '±24 V drive · armature dynamics',
    },
    {
      x: 616,
      y: 480,
      text: '03  MECHANICAL LOAD',
      detail: 'Rotor inertia · friction · measured angle',
    },
  ],
};
const reference = project.blocks.find((b) => b.id === 'reference')!.definition;
reference.parameters[0].name = 'Target angle';
reference.parameters[0].unit = 'rad';
reference.ports[0].unit = 'rad';
project.blocks
  .find((b) => b.id === 'controller')!
  .definition.ports.find((p) => p.id === 'y')!.unit = 'V';
const feedback = project.nets?.find((n) =>
  n.wireIds.some((id) => {
    const w = project.wires.find((x) => x.id === id);
    return w?.source === 'sensor' && w.sourceHandle === 'y';
  }),
);
if (feedback) {
  feedback.name = 'θ measured';
  feedback.hidden = false;
}

writeFileSync(
  'models/examples/servo.json',
  JSON.stringify(project, null, 2) + '\n',
);
