import type { ExampleSpec } from './types';

export const physicalBuses: ExampleSpec[] = [
  {
    id: 'physical-bus',
    title: 'Physical bus',
    area: 'Electrical',
    summary:
      'A supply’s two rails and a heater’s heat flow travel to the load as one bus line.',
    description:
      'The Physical bus on the left bundles three connections: the + and − terminals of a 12 V supply as pos and neg, and the 20 W heater’s heat port as heat. One bus line carries them across the sheet to a second Physical bus, flipped so its bus terminal faces left, which gives them back by name: pos and neg feed a 6 Ω load and a voltage sensor, and heat warms a 10 J/K heat capacity. Elements with the same name on the two blocks are one node, whatever order they are listed in. The same works through a subsystem: give it a physical bus port and the bus carries the elements its inside uses. Set the elements, their names and types, in each block’s properties.',
    duration: 1,
    blocks: [
      [
        'src',
        'dcSource',
        'Supply 12 V',
        [136, 184],
        { V: 12 },
        { label: 'left' },
      ],
      ['gnd', 'ground', 'Ground', [136, 312]],
      [
        'heater',
        'fixedHeatFlow',
        'Heater 20 W',
        [136, 424],
        { Q_flow: 20 },
        { label: 'left' },
      ],
      [
        'out',
        'physicalBus',
        'Bus out',
        [360, 296],
        {},
        {
          elements: [
            ['pos', 'electrical'],
            ['neg', 'electrical'],
            ['heat', 'thermal'],
          ],
        },
      ],
      [
        'inb',
        'physicalBus',
        'Bus in',
        [664, 296],
        {},
        {
          flip: true,
          elements: [
            ['heat', 'thermal'],
            ['pos', 'electrical'],
            ['neg', 'electrical'],
          ],
        },
      ],
      [
        'load',
        'resistor',
        'Load 6 Ω',
        [888, 184],
        { R: 6 },
        { rotation: 90, label: 'left' },
      ],
      [
        'vs',
        'voltageSensor',
        'Load voltage',
        [1032, 184],
        {},
        { label: 'right' },
      ],
      [
        'cap',
        'heatCapacitor',
        'Heat capacity',
        [888, 424],
        { C: 10, T0: 293.15 },
        { label: 'left' },
      ],
      [
        'ts',
        'temperatureSensor',
        'Temperature',
        [1032, 424],
        {},
        { label: 'right' },
      ],
    ],
    links: [
      ['src.p', 'out.e1'],
      ['src.n', 'out.e2'],
      ['src.n', 'gnd.p'],
      ['heater.port', 'out.e3'],
      ['out.bus', 'inb.bus'],
      ['inb.e2', 'load.p'],
      ['inb.e3', 'load.n'],
      ['vs.p', 'load.p'],
      ['vs.n', 'load.n'],
      ['inb.e1', 'cap.port'],
      ['ts.port', 'cap.port'],
    ],
    plots: [
      { label: 'Load voltage', series: ['vs.y'], labels: ['pos − neg'] },
      { label: 'Heat capacity', series: ['ts.T'], labels: ['Temperature'] },
    ],
    checks: [
      {
        signal: 'vs.y',
        value: 12,
        tol: 1e-6,
        why: 'pos and neg reach the load through the bus: it sees the 12 V supply',
      },
      {
        signal: 'ts.T',
        value: 293.15 + 20 / 10,
        tol: 1e-3,
        why: 'the heater’s 20 W reaches the 10 J/K capacity through the bus: 2 K in 1 s',
      },
    ],
    about: ['physicalBus'],
  },
];
