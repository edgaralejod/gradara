import type { ExampleSpec } from './types';

/** Signal rows: the same 176 × 112 lattice as the other signal examples. */
const col = (i: number) => 80 + 176 * i;
const row = (j: number) => 96 + 112 * j;

export const buses: ExampleSpec[] = [
  {
    id: 'mux-demux',
    title: 'Mux and Demux',
    area: 'Signals',
    summary:
      'Three signals carried across the sheet on one vector wire, then split apart again.',
    description:
      'The Mux joins the ramp, the sine, and the constant into one vector, drawn as a heavy line: one wire where there would be three. The Demux splits it back in the same order, so its outputs are the three sources again. The Sum adds the first two. Set the number of inputs or outputs in each block’s properties; a Demux splits its input into equal parts, so its output count must divide the vector’s width.',
    duration: 2,
    blocks: [
      ['ramp', 'ramp', 'Ramp', [col(0), row(0)], { slope: 1, startTime: 0 }],
      [
        'sine',
        'sine',
        'Sine',
        [col(0), row(1)],
        { amplitude: 1, frequency: 1 },
      ],
      ['level', 'constant', 'Level', [col(0), row(2)], { value: 2 }],
      ['mux', 'mux', 'Mux', [col(1) + 32, row(1)], {}, { signals: 3 }],
      ['demux', 'demux', 'Demux', [col(3), row(1)], {}, { signals: 3 }],
      ['add', 'sum', 'Sum', [col(4), row(0) + 40], {}, { label: 'above' }],
    ],
    links: [
      ['ramp.y', 'mux.u1'],
      ['sine.y', 'mux.u2'],
      ['level.y', 'mux.u3'],
      ['mux.y', 'demux.u'],
      ['demux.y1', 'add.a'],
      ['demux.y2', 'add.b'],
    ],
    plots: [
      {
        label: 'Split signals',
        series: ['demux.y1', 'demux.y2', 'demux.y3', 'add.y'],
        labels: ['Ramp', 'Sine', 'Level', 'Ramp + sine'],
      },
    ],
    checks: [
      {
        signal: 'demux.y1',
        value: 2,
        tol: 1e-6,
        why: 'first signal: the ramp, 1 × 2 s',
      },
      {
        signal: 'demux.y2',
        at: 0.25,
        value: 1,
        tol: 1e-3,
        why: 'second signal: sin(2π · 0.25) = 1',
      },
      {
        signal: 'demux.y3',
        value: 2,
        tol: 1e-9,
        why: 'third signal: the constant 2',
      },
      {
        signal: 'add.y',
        at: 1,
        value: 1,
        tol: 1e-3,
        why: 'ramp 1 + sin(2π) = 1',
      },
    ],
    about: ['mux', 'demux'],
  },
  {
    id: 'buses',
    title: 'Signal buses',
    area: 'Signals',
    summary:
      'Named signals bundled into a bus with a Bus Creator, and picked out by name with a Bus Selector.',
    description:
      'The Bus Creator names each input (speed, torque, current) and carries all three on one bus wire. The Bus Selector picks speed and current by name, whatever their order in the bus, and the Gain scales the speed by 0.5. Rename a signal or choose different ones in the blocks’ properties. A bus can hold another bus: its signals get dotted names such as motor.speed, and selecting motor gives them all as a vector.',
    duration: 2,
    blocks: [
      ['speed', 'ramp', 'Speed', [col(0), row(0)], { slope: 2, startTime: 0 }],
      ['torque', 'constant', 'Torque', [col(0), row(1)], { value: 0.5 }],
      [
        'current',
        'sine',
        'Current',
        [col(0), row(2)],
        { amplitude: 1, frequency: 1 },
      ],
      [
        'sensors',
        'busCreator',
        'Sensors',
        [col(1) + 56, row(1)],
        {},
        { signals: ['speed', 'torque', 'current'] },
      ],
      [
        'pick',
        'busSelector',
        'Pick',
        [col(3), row(1)],
        {},
        { signals: ['speed', 'current'] },
      ],
      ['scale', 'gain', 'Scale', [col(4) + 32, row(0) + 56], { k: 0.5 }],
    ],
    links: [
      ['speed.y', 'sensors.u1'],
      ['torque.y', 'sensors.u2'],
      ['current.y', 'sensors.u3'],
      ['sensors.y', 'pick.u'],
      ['pick.y1', 'scale.u'],
    ],
    plots: [
      {
        label: 'Selected signals',
        series: ['pick.y1', 'pick.y2', 'scale.y'],
        labels: ['speed', 'current', '0.5 × speed'],
      },
    ],
    checks: [
      {
        signal: 'pick.y1',
        value: 4,
        tol: 1e-6,
        why: 'speed: the ramp, 2 × 2 s',
      },
      {
        signal: 'pick.y2',
        at: 0.25,
        value: 1,
        tol: 1e-3,
        why: 'current: sin(2π · 0.25) = 1',
      },
      { signal: 'scale.y', value: 2, tol: 1e-6, why: '0.5 × speed 4' },
    ],
    about: ['busCreator', 'busSelector'],
  },
];
