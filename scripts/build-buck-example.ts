/**
 * The synchronous buck converter template (models/examples/buck.json): a PWM
 * generator driving two Modelica switches, an LC filter and a load. Built from
 * library blocks and routed by the workbench. Run with
 * `npx tsx scripts/build-buck-example.ts`.
 */
import { writeFileSync } from 'node:fs';
import type { Project } from '../lib/gradara/model';
import { assemble } from './block-examples/assemble';
import type { ExampleSpec } from './block-examples/types';

const spec: ExampleSpec = {
  id: 'buck',
  title: 'Buck converter · Ideal switches',
  area: 'Converters',
  summary: 'A synchronous buck converter switched at 10 kHz.',
  description:
    '24 V synchronous buck: a PWM generator at 10 kHz and 50 % duty drives two complementary ideal switches, a 1 mH / 100 µF filter and a 10 Ω load. Start from zero stored energy. Expect approximately 12 V and 1.2 A after settling. No losses, dead time, or parasitics: the switches have zero on-resistance and zero off-conductance. Change the duty cycle constant to move the output.',
  duration: 0.02,
  blocks: [
    [
      'supply',
      'dcSource',
      '24 V supply',
      [72, 352],
      { V: 24 },
      { label: 'left' },
    ],
    ['duty', 'constant', 'Duty 50 %', [160, 128], { value: 0.5 }],
    [
      'pwm',
      'pwmSignal',
      '10 kHz PWM',
      [320, 128],
      { f: 10000 },
      { label: 'above' },
    ],
    [
      'highSide',
      'closingSwitch',
      'High-side switch',
      [480, 240],
      { Ron: 0, Goff: 0 },
      { rotation: 90, label: 'left' },
    ],
    [
      'lowSide',
      'closingSwitch',
      'Low-side switch',
      [480, 464],
      { Ron: 0, Goff: 0 },
      { rotation: 90, label: 'left' },
    ],
    [
      'inductor',
      'inductor',
      '1 mH inductor',
      [640, 352],
      { L: 0.001 },
      { label: 'above' },
    ],
    [
      'current',
      'currentSensor',
      'Inductor current',
      [784, 352],
      {},
      { label: 'above' },
    ],
    [
      'capacitor',
      'capacitor',
      '100 µF capacitor',
      [912, 464],
      { C: 0.0001 },
      { rotation: 90, label: 'left' },
    ],
    [
      'load',
      'resistor',
      '10 Ω load',
      [1048, 464],
      { R: 10 },
      { rotation: 90, label: 'right' },
    ],
    [
      'voltageProbe',
      'voltageSensor',
      'Output voltage',
      [1184, 464],
      {},
      { label: 'right' },
    ],
    ['ground', 'ground', 'Ground', [480, 600]],
  ],
  links: [
    ['duty.y', 'pwm.dutyCycle'],
    ['pwm.fire', 'highSide.control'],
    ['pwm.notFire', 'lowSide.control'],
    ['supply.p', 'highSide.p'],
    ['highSide.n', 'lowSide.p'],
    ['highSide.n', 'inductor.p'],
    ['inductor.n', 'current.p'],
    ['current.n', 'capacitor.p'],
    ['current.n', 'load.p'],
    ['current.n', 'voltageProbe.p'],
    ['lowSide.n', 'ground.p'],
    ['supply.n', 'ground.p'],
    ['capacitor.n', 'ground.p'],
    ['load.n', 'ground.p'],
    ['voltageProbe.n', 'ground.p'],
  ],
  plots: [
    {
      label: 'Output voltage',
      series: ['voltageProbe.y'],
      labels: ['Output voltage'],
    },
    {
      label: 'Inductor current',
      series: ['current.y'],
      labels: ['Inductor current'],
    },
    {
      label: 'Switch gates',
      series: ['pwm.fire', 'pwm.notFire'],
      labels: ['High-side gate', 'Low-side gate'],
    },
  ],
  checks: [],
  about: [],
};

let project: Project = assemble(spec);
project = {
  ...project,
  version: 1,
  exampleId: 'buck',
  name: spec.title,
  description: spec.description,
  revision: 0,
  annotations: [
    {
      x: 128,
      y: -24,
      text: 'GATE DRIVE',
      detail: '10 kHz · 50 % duty · complementary gates',
    },
    { x: 480, y: -24, text: 'IDEAL SWITCHING STAGE', detail: '24 V input' },
    {
      x: 760,
      y: 224,
      text: 'OUTPUT FILTER & LOAD',
      detail: '12 V nominal · 1.2 A nominal',
    },
  ],
};
for (const net of project.nets ?? []) {
  const owned = net.wireIds.map((id) =>
    project.wires.find((w) => w.id === id)!,
  );
  const touches = (id: string, handle: string) =>
    owned.some(
      (w) =>
        (w.source === id && w.sourceHandle === handle) ||
        (w.target === id && w.targetHandle === handle),
    );
  net.name = touches('supply', 'p')
    ? 'Vin'
    : touches('highSide', 'n')
      ? 'SW'
      : touches('capacitor', 'p')
        ? 'Vout'
        : touches('ground', 'p')
          ? 'GND'
          : undefined;
  net.hidden = !net.name;
  if (!net.name) delete net.label;
}

writeFileSync(
  'models/examples/buck.json',
  JSON.stringify(project, null, 2) + '\n',
);
