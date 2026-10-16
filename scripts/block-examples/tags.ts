import type { ExampleSpec } from './types';

export const tags: ExampleSpec[] = [
  {
    id: 'tags',
    title: 'Goto, From, and connection labels',
    area: 'Signals',
    summary:
      'A signal and a supply rail carried across the sheet by tag, without wires.',
    description:
      'The Goto [ref] takes the sine; both From [ref] blocks give it back on the far side of the sheet, without a wire, and the gains scale it by 2 and −1. Below, the label [VBUS] on the source joins the label [VBUS] by the load: one node, so the voltage sensor reads the 10 V of the source. The right-hand label is flipped so its terminal faces the load. Tags reach into the subsystems on a sheet, never out of them: a From inside a subsystem reads a Goto on its sheet or on any sheet above it, and a Goto inside a subsystem is not seen outside it. Set a tag in the block’s properties.',
    duration: 1,
    blocks: [
      ['sine', 'sine', 'Sine', [80, 96], { amplitude: 1, frequency: 1 }],
      ['to', 'goto', 'Goto', [240, 96], {}, { tag: 'ref' }],
      ['back', 'from', 'From', [560, 96], {}, { tag: 'ref' }],
      ['double', 'gain', 'Gain 2', [720, 96], { k: 2 }],
      ['back2', 'from', 'From', [560, 208], {}, { tag: 'ref' }],
      ['invert', 'gain', 'Gain −1', [720, 208], { k: -1 }],
      ['src', 'dcSource', 'DC 10 V', [120, 440], { V: 10 }, { label: 'left' }],
      ['rail', 'connectionLabel', 'Label', [256, 352], {}, { tag: 'VBUS' }],
      ['gnd', 'ground', 'Ground', [120, 560]],
      [
        'rail2',
        'connectionLabel',
        'Label',
        [504, 352],
        {},
        { tag: 'VBUS', flip: true },
      ],
      [
        'load',
        'resistor',
        'Load 10 Ω',
        [640, 440],
        { R: 10 },
        { rotation: 90, label: 'left' },
      ],
      ['gnd2', 'ground', 'Ground (load)', [640, 560]],
      [
        'vs',
        'voltageSensor',
        'Rail voltage',
        [784, 440],
        {},
        { label: 'right' },
      ],
    ],
    links: [
      ['sine.y', 'to.u'],
      ['back.y', 'double.u'],
      ['back2.y', 'invert.u'],
      ['src.p', 'rail.p'],
      ['src.n', 'gnd.p'],
      ['rail2.p', 'load.p'],
      ['load.n', 'gnd2.p'],
      ['vs.p', 'load.p'],
      ['vs.n', 'load.n'],
    ],
    plots: [
      {
        label: 'Signals by tag',
        series: ['sine.y', 'double.y', 'invert.y'],
        labels: ['Sine (Goto)', '2 × From', '−1 × From'],
      },
      { label: 'Rail', series: ['vs.y'], labels: ['VBUS'] },
    ],
    checks: [
      {
        signal: 'double.y',
        at: 0.25,
        value: 2,
        tol: 1e-3,
        why: 'the From gives back the sine: 2 · sin(2π · 0.25) = 2',
      },
      {
        signal: 'invert.y',
        at: 0.25,
        value: -1,
        tol: 1e-3,
        why: 'the second From reads the same Goto',
      },
      {
        signal: 'vs.y',
        value: 10,
        tol: 1e-6,
        why: 'the two labels [VBUS] are one node: the load sees the source',
      },
    ],
    about: ['goto', 'from', 'connectionLabel'],
  },
];
