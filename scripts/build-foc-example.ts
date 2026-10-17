/**
 * The field-oriented control template (models/examples/foc.json): a Modelica
 * permanent-magnet synchronous machine under cascaded speed and d/q current control,
 * built from library blocks and routed by the workbench. Run with
 * `npx tsx scripts/build-foc-example.ts`.
 */
import { writeFileSync } from 'node:fs';
import { logPlotted } from '../lib/gradara/logging';
import type { Project } from '../lib/gradara/model';
import { assemble } from './block-examples/assemble';
import type { ExampleSpec } from './block-examples/types';

// The old signal-port PMSM: R = 0.35 Ω, Ld = Lq = 1 mH, ψ = 0.035 Wb, 4 pole pairs. The
// Modelica machine states the magnet by its open-circuit voltage at a nominal frequency:
// ψ = √2 · Vs / (2π · fs). 100 Hz electrical is 1500 rpm with four pole pairs.
const POLE_PAIRS = 4;
const FS = 100;
const PSI = 0.035;
const VS_OPEN_CIRCUIT = (PSI * 2 * Math.PI * FS) / Math.SQRT2;

const spec: ExampleSpec = {
  id: 'foc',
  title: 'PMSM · Field-oriented control',
  area: 'Machines',
  summary: 'Field-oriented control of a permanent-magnet synchronous machine.',
  description:
    'A 1500 rpm speed command with cascaded d/q current control. The speed PI asks for q-axis current (torque); the d-axis reference is zero. Two current PIs set the d/q voltages, which turn back into three phase voltages through the inverse Park (the Park transform fed −θe) and inverse Clarke transforms and drive a controlled three-phase source, the ideal model of an inverter. The machine is the Modelica permanent-magnet synchronous machine with its inductances and magnet voltage set explicitly; its load is a damper plus a torque step that raises the load from 0.05 N·m to 0.4 N·m at 0.45 s. Measured phase currents come back through the Clarke and Park transforms; the rotor angle comes from an angle sensor scaled by the pole pairs.',
  duration: 1.2,
  // Port-anchored: every block sits where its input meets the output that feeds it, so
  // the forward path and the shaft run straight; the feedback path reads right to left
  // with its blocks flipped.
  blocks: [
    // Speed loop.
    [
      'reference',
      'step',
      'Speed command',
      [80, 160],
      { height: 1500, startTime: 0.03 },
    ],
    ['units', 'gain', 'rpm → rad/s', [224, 160], { k: Math.PI / 30 }],
    [
      'speedPI',
      'piController',
      'Speed PI',
      [392, 160],
      { k: 0.16, Ti: 0.2, yMax: 8, yMin: -8 },
      { ports: { measured: 'bottom' }, label: 'above' },
    ],
    // Current loops.
    [
      'qPI',
      'piController',
      'q-axis PI',
      [568, 160],
      { k: 2, Ti: 2 / 700, yMax: 27, yMin: -27 },
      { ports: { measured: 'bottom' }, label: 'above' },
    ],
    ['dReference', 'constant', 'id* = 0 A', [368, 336], { value: 0 }],
    [
      'dPI',
      'piController',
      'd-axis PI',
      [568, 336],
      { k: 2, Ti: 2 / 700, yMax: 27, yMin: -27 },
      { ports: { measured: 'bottom' }, label: 'above' },
    ],
    ['inversePark', 'park', 'Inverse Park', [808, 144], {}, { label: 'above' }],
    // The zero-sequence constant points down into the top of the inverse Clarke.
    [
      'zero',
      'constant',
      'Zero sequence 0',
      [1032, 16],
      { value: 0 },
      { rotation: 90, label: 'left' },
    ],
    [
      'inverseClarke',
      'inverseClarke',
      'Inverse Clarke',
      [1000, 144],
      {},
      { ports: { zero: ['top', 75] } },
    ],
    // Power and mechanics.
    [
      'inverter',
      'threePhaseSignalVoltage',
      'Inverter (ideal)',
      [1208, 144],
      {},
      { label: 'above' },
    ],
    [
      'isens',
      'threePhaseCurrentSensor',
      'Phase currents',
      [1384, 144],
      {},
      { label: 'above' },
    ],
    [
      'motor',
      'pmSyncMachine',
      'PMSM',
      [1560, 144],
      {
        p: POLE_PAIRS,
        fsNominal: FS,
        VsOpenCircuit: VS_OPEN_CIRCUIT,
        Rs: 0.35,
        Lssigma: 1e-4,
        Lmd: 9e-4,
        Lmq: 9e-4,
        Jr: 0.002,
      },
      { label: 'above' },
    ],
    [
      'neutral',
      'star',
      'Neutral',
      [1560, 304],
      {},
      { rotation: 90, label: 'left' },
    ],
    ['ground', 'ground', 'Ground', [1560, 392]],
    [
      'torque',
      'torqueSensor',
      'Shaft torque',
      [1720, 144],
      {},
      { label: 'above' },
    ],
    ['damper', 'rotDamper', 'Friction 0.001', [1912, 144], { d: 0.001 }],
    ['housing', 'rotFixed', 'Housing', [2000, 208]],
    // The load hangs over the shaft, its flange straight down onto it.
    [
      'load',
      'torqueStep',
      'Load −0.05, −0.4 N·m at 0.45 s',
      [1832, 40],
      { offsetTorque: -0.05, stepTorque: -0.35, startTime: 0.45 },
      { rotation: 90, label: 'right' },
    ],
    // Measurement, read right to left.
    [
      'speed',
      'rotSpeedSensor',
      'Speed',
      [1720, 464],
      {},
      { flip: true, label: 'above' },
    ],
    [
      'angle',
      'angleSensor',
      'Rotor angle',
      [1720, 600],
      {},
      { flip: true, label: 'above' },
    ],
    [
      'poles',
      'gain',
      'θe = p·φ',
      [1496, 600],
      { k: POLE_PAIRS },
      { flip: true },
    ],
    // −θe rises straight into the inverse Park's angle input.
    [
      'minus',
      'unaryMinus',
      '−θe',
      [808, 528],
      {},
      { rotation: 270, label: 'left' },
    ],
    // Current feedback.
    [
      'clarke',
      'clarke',
      'Clarke',
      [1208, 440],
      {},
      { flip: true, label: 'above' },
    ],
    ['park', 'park', 'Park', [1000, 440], {}, { flip: true, label: 'above' }],
  ],
  links: [
    ['reference.y', 'units.u'],
    ['units.y', 'speedPI.reference'],
    ['speedPI.y', 'qPI.reference'],
    ['dReference.y', 'dPI.reference'],
    ['dPI.y', 'inversePark.alpha'],
    ['qPI.y', 'inversePark.beta'],
    ['inversePark.id', 'inverseClarke.alpha'],
    ['inversePark.iq', 'inverseClarke.beta'],
    ['zero.y', 'inverseClarke.zero'],
    ['inverseClarke.va', 'inverter.va'],
    ['inverseClarke.vb', 'inverter.vb'],
    ['inverseClarke.vc', 'inverter.vc'],
    ['inverter.plug_p', 'isens.plug_p'],
    ['isens.plug_n', 'motor.plug_sp'],
    ['motor.plug_sn', 'neutral.plug_p'],
    ['inverter.plug_n', 'neutral.plug_p'],
    ['neutral.pin_n', 'ground.p'],
    ['motor.flange', 'torque.a'],
    ['torque.b', 'damper.flange_a'],
    ['damper.flange_b', 'housing.flange'],
    ['torque.b', 'load.flange'],
    ['torque.b', 'speed.flange'],
    ['torque.b', 'angle.flange'],
    ['speed.w', 'speedPI.measured'],
    ['angle.y', 'poles.u'],
    ['poles.y', 'park.theta'],
    ['poles.y', 'minus.u'],
    ['minus.y', 'inversePark.theta'],
    ['isens.ia', 'clarke.ia'],
    ['isens.ib', 'clarke.ib'],
    ['isens.ic', 'clarke.ic'],
    ['clarke.alpha', 'park.alpha'],
    ['clarke.beta', 'park.beta'],
    ['park.id', 'dPI.measured'],
    ['park.iq', 'qPI.measured'],
  ],
  plots: [
    {
      label: 'Speed',
      series: ['speed.w', 'units.y'],
      labels: ['Rotor speed (rad/s)', 'Speed command (rad/s)'],
    },
    {
      label: 'd/q currents',
      series: ['park.iq', 'speedPI.y', 'park.id'],
      labels: ['iq · measured', 'iq · command', 'id · measured'],
    },
    {
      label: 'Phase currents',
      series: ['isens.ia', 'isens.ib', 'isens.ic'],
      labels: ['Phase a', 'Phase b', 'Phase c'],
    },
    {
      label: 'Shaft torque',
      series: ['torque.y'],
      labels: ['Torque to the load'],
    },
    { label: 'd/q voltages', series: ['qPI.y', 'dPI.y'], labels: ['vq', 'vd'] },
  ],
  checks: [],
  about: [],
};

let project: Project = assemble(spec);
project = {
  ...project,
  version: 1,
  exampleId: 'foc',
  name: spec.title,
  description: spec.description,
  revision: 0,
  annotations: [
    {
      x: 24,
      y: -48,
      text: '01  SPEED CONTROL',
      detail: 'Speed error → PI → torque-producing current',
    },
    {
      x: 480,
      y: -48,
      text: '02  CURRENT CONTROL',
      detail: 'd / q regulators · dq → abc',
    },
    {
      x: 1120,
      y: -48,
      text: '03  POWER & MECHANICS',
      detail: 'Ideal inverter · Modelica PMSM · load step',
    },
    { x: 920, y: 288, text: 'CURRENT FEEDBACK', detail: 'abc → αβ → dq' },
    {
      x: 1384,
      y: 696,
      text: 'θe  ·  ELECTRICAL ANGLE',
      detail: 'p · φ from the angle sensor',
    },
  ],
};
// The Park block rotates by its angle input; fed −θe it is the inverse transform, so
// its terminals read d, q in and α, β out.
const inverse = project.blocks.find((b) => b.id === 'inversePark')!.definition;
for (const [id, name] of [
  ['alpha', 'd'],
  ['beta', 'q'],
  ['id', 'α'],
  ['iq', 'β'],
  ['theta', '−θe'],
] as const)
  inverse.ports.find((p) => p.id === id)!.name = name;
const reference = project.blocks.find((b) => b.id === 'reference')!.definition;
reference.parameters[0].name = 'Target speed';
reference.parameters[0].unit = 'rpm';
reference.ports[0].unit = 'rpm';
for (const [id, unit] of [
  ['speedPI', 'A'],
  ['qPI', 'V'],
  ['dPI', 'V'],
  ['poles', 'rad'],
] as const)
  project.blocks
    .find((b) => b.id === id)!
    .definition.ports.find((p) => p.id === 'y')!.unit = unit;

writeFileSync(
  'models/examples/foc.json',
  JSON.stringify(logPlotted(project), null, 2) + '\n',
);
