/**
 * The DC motor speed-control template (models/examples/dc.json): the first model
 * a new user sees. A sampled PI drives a Modelica permanent-magnet DC machine
 * through a controlled voltage source; a speed sensor closes the loop. Built from
 * library blocks and routed by the workbench. Run with
 * `npx tsx scripts/build-dc-example.ts`.
 */
import { writeFileSync } from 'node:fs';
import { logPlotted } from '../lib/gradara/logging';
import type { Project } from '../lib/gradara/model';
import { assemble } from './block-examples/assemble';
import type { ExampleSpec } from './block-examples/types';

const spec: ExampleSpec = {
  id: 'dc',
  title: 'Motor speed control',
  area: 'Machines',
  summary: 'A DC motor under sampled PI speed control.',
  description:
    'A 100 rad/s speed command at 0.2 s, a sampled PI at 1 kHz with a ±24 V output limit, a controlled voltage source, and a permanent-magnet DC machine: 24 V, 2 A nominal, 1.2 Ω and 20 mH armature, 0.02 kg·m² on the shaft, so its constant is (24 V − 1.2 Ω · 2 A) / 144 rad/s = 0.15 V·s/rad. Viscous friction of 0.002 N·m·s loads the shaft, and a speed sensor closes the loop. Change the target speed or a gain and run again.',
  duration: 4,
  blocks: [
    [
      'reference',
      'step',
      'Speed reference',
      [72, 216],
      { height: 100, startTime: 0.2 },
    ],
    [
      'controller',
      'pi',
      'Speed controller (PI)',
      [248, 216],
      { kp: 0.6, ki: 2, limit: 24, samplePeriod: 0.001 },
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
    [
      'sensor',
      'rotSpeedSensor',
      'Speed sensor',
      [680, 376],
      {},
      { flip: true },
    ],
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
    ['sensor.w', 'controller.measured'],
  ],
  plots: [
    {
      label: 'Speed',
      series: ['sensor.w', 'reference.y'],
      labels: ['Rotor speed', 'Speed command'],
    },
    {
      label: 'Control voltage',
      series: ['controller.y'],
      labels: ['Control voltage'],
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
  exampleId: 'dc',
  name: spec.title,
  description: spec.description,
  revision: 0,
  annotations: [
    {
      x: 24,
      y: 56,
      text: '01  SPEED CONTROL',
      detail: '100 rad/s reference · bounded PI',
    },
    {
      x: 416,
      y: 56,
      text: '02  ELECTRICAL DRIVE',
      detail: '24 V drive · armature dynamics',
    },
    {
      x: 616,
      y: 480,
      text: '03  MECHANICAL LOAD',
      detail: 'Rotor inertia · friction · measured speed',
    },
  ],
};
const reference = project.blocks.find((b) => b.id === 'reference')!.definition;
reference.parameters[0].name = 'Target speed';
reference.parameters[0].unit = 'rad/s';
reference.ports[0].unit = 'rad/s';
project.blocks
  .find((b) => b.id === 'controller')!
  .definition.ports.find((p) => p.id === 'y')!.unit = 'V';
const feedback = project.nets?.find((n) =>
  n.wireIds.some((id) => {
    const w = project.wires.find((x) => x.id === id);
    return w?.source === 'sensor' && w.sourceHandle === 'w';
  }),
);
if (feedback) {
  feedback.name = 'ω measured';
  feedback.hidden = false;
}

writeFileSync(
  'models/examples/dc.json',
  JSON.stringify(logPlotted(project), null, 2) + '\n',
);
