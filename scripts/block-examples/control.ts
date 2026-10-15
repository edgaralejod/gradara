import type { ExampleSpec } from './types';

/** One loop per row: set point, controller, plant, and a gain that names the output. */
function loop(
  tag: string,
  y: number,
  controller: [string, string, Record<string, number>],
): { blocks: ExampleSpec['blocks']; links: ExampleSpec['links'] } {
  const [kind, name, params] = controller;
  return {
    blocks: [
      [
        `ref${tag}`,
        'step',
        `Set point (${name})`,
        [80, y - 16],
        { height: 1, startTime: 0.1 },
      ],
      [`c${tag}`, kind, name, [320, y], params],
      [
        `plant${tag}`,
        'filter',
        `Plant (${name})`,
        [560, y],
        { tau: 0.5 },
        { label: 'above' },
      ],
      [`y${tag}`, 'gain', `y (${name})`, [760, y], { k: 1 }],
    ],
    links: [
      [`ref${tag}.y`, `c${tag}.reference`],
      [`c${tag}.y`, `plant${tag}.u`],
      [`plant${tag}.y`, `y${tag}.u`],
      [`plant${tag}.y`, `c${tag}.measured`],
    ],
  };
}

const loops = [
  loop('1', 160, [
    'piController',
    'PI',
    { k: 1, Ti: 0.5, yMax: 10, yMin: -10 },
  ]),
  loop('2', 352, [
    'pidController',
    'PID',
    { k: 1, Ti: 0.5, Td: 0.05, Nd: 5, yMax: 10, yMin: -10 },
  ]),
  loop('3', 544, [
    'pi',
    'PI (sampled)',
    { kp: 1, ki: 2, limit: 10, samplePeriod: 0.001 },
  ]),
  loop('4', 736, [
    'discretePID',
    'PID (sampled)',
    {
      kp: 1,
      ki: 2,
      kd: 0.05,
      filterTime: 0.01,
      limit: 10,
      samplePeriod: 0.001,
    },
  ]),
];

export const control: ExampleSpec[] = [
  {
    id: 'control-loops',
    title: 'PI and PID loops',
    area: 'Control',
    summary:
      'The same first-order plant under continuous PI and PID controllers and their sampled counterparts.',
    description:
      'Each plant is a lag with τ = 0.5 s and each loop follows a unit step at 0.1 s. Every controller takes the reference and the measurement and forms the error itself. The continuous PI and PID are the Modelica library controllers: gain 1, integral time 0.5 s (so the integral gain is 2), and for the PID a derivative time of 0.05 s filtered at a tenth of it; the sampled ones run at 1 kHz with the same gains and reproduce exactly in exported C. All four reach the set point with no steady error, because each has integral action. Change a gain and run again to compare.',
    duration: 4,
    blocks: loops.flatMap((l) => l.blocks),
    links: loops.flatMap((l) => l.links),
    plots: [
      {
        label: 'Plant outputs',
        series: ['ref1.y', 'y1.y', 'y2.y', 'y3.y', 'y4.y'],
        labels: ['Set point', 'PI', 'PID', 'PI (sampled)', 'PID (sampled)'],
      },
      {
        label: 'Controller outputs',
        series: ['c1.y', 'c2.y', 'c3.y', 'c4.y'],
        labels: ['PI', 'PID', 'PI (sampled)', 'PID (sampled)'],
      },
    ],
    checks: [
      ...['y1', 'y2', 'y3', 'y4'].map((signal) => ({
        signal: `${signal}.y`,
        value: 1,
        tol: 0.01,
        why: 'integral action removes the error',
      })),
      { signal: 'y1.y', at: 0.09, value: 0, tol: 1e-9, why: 'before the step' },
      {
        signal: 'c1.y',
        at: 0.11,
        value: 1 + 0.01 * 2,
        tol: 0.05,
        why: 'just after the step, the PI output is k·e plus a little integral',
      },
    ],
    about: ['piController', 'pidController', 'pi', 'discretePID'],
  },
  {
    id: 'space-phasors',
    title: 'Clarke and Park transforms',
    area: 'Control',
    summary:
      'Balanced three-phase signals become a rotating α, β pair, then constant d and q, and go back out through a controlled three-phase source.',
    description:
      'Three sines 120° apart stand for balanced phase currents. The Clarke transform turns them into α = cos ωt and β = sin ωt, a vector turning at 50 Hz. The Park transform rotates that vector by the angle θ = ωt, so in the turning frame it stands still: d = 1 and q = 0. The inverse Clarke transform (with a zero-sequence input of 0) rebuilds the three phases from α and β and drives a controlled three-phase source, the ideal model of an inverter, into a 10 Ω star load: each phase current is the phase voltage over 10 Ω.',
    duration: 0.04,
    blocks: [
      [
        'ia',
        'sine',
        'ia',
        [80, 96],
        { amplitude: 1, frequency: 50, phase: Math.PI / 2 },
      ],
      [
        'ib',
        'sine',
        'ib',
        [80, 208],
        { amplitude: 1, frequency: 50, phase: Math.PI / 2 - (2 * Math.PI) / 3 },
      ],
      [
        'ic',
        'sine',
        'ic',
        [80, 320],
        { amplitude: 1, frequency: 50, phase: Math.PI / 2 + (2 * Math.PI) / 3 },
      ],
      [
        'clarke',
        'clarke',
        'Clarke',
        [320, 208],
        {},
        {
          ports: {
            ia: 'left',
            ib: 'left',
            ic: 'left',
            alpha: 'right',
            beta: 'right',
          },
          label: 'above',
        },
      ],
      [
        'park',
        'park',
        'Park',
        [560, 208],
        {},
        {
          ports: { alpha: 'left', beta: 'left', id: 'right', iq: 'right' },
          label: 'above',
        },
      ],
      ['clock', 'clock', 'Time', [320, 432]],
      ['w', 'gain', 'θ = 2π·50·t', [560, 432], { k: 2 * Math.PI * 50 }],
      [
        'zero',
        'constant',
        'Zero sequence 0',
        [816, 64],
        { value: 0 },
        { label: 'left' },
      ],
      [
        'inv',
        'inverseClarke',
        'Inverse Clarke',
        [816, 208],
        {},
        { ports: { zero: 'top' } },
      ],
      [
        'src',
        'threePhaseSignalVoltage',
        'Controlled 3-phase source',
        [1056, 208],
        {},
        { label: 'above' },
      ],
      ['sens', 'threePhaseCurrentSensor', 'Phase currents', [1232, 208]],
      [
        'load',
        'threePhaseResistor',
        'Load 10 Ω',
        [1392, 208],
        { R: 10 },
        { label: 'above' },
      ],
      ['star', 'star', 'Star point', [1552, 208]],
      ['gnd', 'ground', 'Ground', [1552, 328]],
      [
        'srcn',
        'star',
        'Source neutral',
        [1056, 328],
        {},
        { rotation: 90, label: 'left' },
      ],
    ],
    links: [
      ['ia.y', 'clarke.ia'],
      ['ib.y', 'clarke.ib'],
      ['ic.y', 'clarke.ic'],
      ['clarke.alpha', 'park.alpha'],
      ['clarke.beta', 'park.beta'],
      ['clock.y', 'w.u'],
      ['w.y', 'park.theta'],
      ['clarke.alpha', 'inv.alpha'],
      ['clarke.beta', 'inv.beta'],
      ['zero.y', 'inv.zero'],
      ['inv.va', 'src.va'],
      ['inv.vb', 'src.vb'],
      ['inv.vc', 'src.vc'],
      ['src.plug_p', 'sens.plug_p'],
      ['sens.plug_n', 'load.plug_p'],
      ['load.plug_n', 'star.plug_p'],
      ['star.pin_n', 'gnd.p'],
      ['src.plug_n', 'srcn.plug_p'],
      ['srcn.pin_n', 'gnd.p'],
    ],
    plots: [
      {
        label: 'Stationary and rotating frames',
        series: ['clarke.alpha', 'clarke.beta', 'park.id', 'park.iq'],
        labels: ['α', 'β', 'd', 'q'],
      },
      {
        label: 'Phase currents',
        series: ['sens.ia', 'sens.ib', 'sens.ic'],
        labels: ['ia', 'ib', 'ic'],
      },
    ],
    checks: [
      {
        signal: 'clarke.alpha',
        at: 0.02,
        value: 1,
        tol: 1e-3,
        why: 'α = cos ωt, one period in',
      },
      {
        signal: 'clarke.beta',
        at: 0.025,
        value: 1,
        tol: 1e-3,
        why: 'β = sin ωt, a quarter period later',
      },
      {
        signal: 'park.id',
        value: 1,
        tol: 1e-3,
        why: 'the vector stands still in its own frame',
      },
      {
        signal: 'park.iq',
        value: 0,
        tol: 1e-3,
        why: 'no quadrature component',
      },
      {
        signal: 'inv.va',
        at: 0.02,
        value: 1,
        tol: 1e-3,
        why: 'phase a rebuilt',
      },
      {
        signal: 'sens.ia',
        at: 0.02,
        value: 0.1,
        tol: 1e-3,
        why: '1 V over 10 Ω',
      },
      {
        signal: 'sens.ib',
        at: 0.02,
        value: -0.05,
        tol: 1e-3,
        why: 'cos(−120°)/10',
      },
    ],
    about: ['clarke', 'park', 'inverseClarke', 'threePhaseSignalVoltage'],
  },
];
