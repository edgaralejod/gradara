import type { ExampleSpec } from './types';

type Blocks = ExampleSpec['blocks'];
type Links = ExampleSpec['links'];
type Part = { blocks: Blocks; links: Links };
const merge = (...parts: Part[]): Part => ({
  blocks: parts.flatMap((p) => p.blocks),
  links: parts.flatMap((p) => p.links),
});

/** A duty-cycle constant into a PWM generator, drawn left of (x, y). */
function modulator(
  id: string,
  [x, y]: [number, number],
  duty: number,
  name: string,
): Part {
  return {
    blocks: [
      [
        `${id}duty`,
        'constant',
        `Duty ${id.toUpperCase()} ${duty}`,
        [x, y],
        { value: duty },
      ],
      [`${id}pwm`, 'pwmSignal', name, [x + 192, y], { f: 10000 }],
    ],
    links: [[`${id}duty.y`, `${id}pwm.dutyCycle`]],
  };
}

/** An output filter capacitor with a load and a voltmeter across it, at (x, y). */
function output(id: string, [x, y]: [number, number], r: number): Part {
  const tag = id.toUpperCase();
  return {
    blocks: [
      [
        `${id}c`,
        'capacitor',
        `C ${tag} 100 µF`,
        [x, y],
        { C: 1e-4 },
        { rotation: 90, label: 'left' },
      ],
      [
        `${id}r`,
        'resistor',
        `Load ${tag} ${r} Ω`,
        [x + 128, y],
        { R: r },
        { rotation: 90, label: 'right' },
      ],
      [
        `${id}v`,
        'voltageSensor',
        `v out ${tag}`,
        [x + 288, y],
        {},
        { label: 'right' },
      ],
    ],
    links: [
      [`${id}c.p`, `${id}r.p`],
      [`${id}c.n`, `${id}r.n`],
      [`${id}v.p`, `${id}r.p`],
      [`${id}v.n`, `${id}r.n`],
    ],
  };
}

const buck = merge(
  modulator('a', [360, 352], 0.5, 'PWM 10 kHz'),
  output('a', [912, 152], 10),
  {
    blocks: [
      ['asrc', 'dcSource', '24 V', [360, 152], { V: 24 }, { label: 'left' }],
      ['ag', 'ground', 'Ground (buck)', [360, 256]],
      ['aconv', 'buckConverter', 'Buck', [552, 136], {}, { label: 'above' }],
      ['al', 'inductor', 'L 1 mH', [760, 120], { L: 1e-3 }, { label: 'above' }],
    ],
    links: [
      ['asrc.n', 'ag.p'],
      ['asrc.p', 'aconv.dc_p1'],
      ['asrc.n', 'aconv.dc_n1'],
      ['aconv.dc_p2', 'al.p'],
      ['al.n', 'ac.p'],
      ['aconv.dc_n2', 'ac.n'],
      ['apwm.fire', 'aconv.fire_p'],
    ],
  },
);

const boost = merge(
  modulator('b', [360, 720], 0.5, 'PWM 10 kHz (boost)'),
  output('b', [912, 520], 50),
  {
    blocks: [
      ['bsrc', 'dcSource', '12 V', [360, 520], { V: 12 }, { label: 'left' }],
      ['bg', 'ground', 'Ground (boost)', [360, 624]],
      [
        'bl',
        'inductor',
        'L 1 mH (boost)',
        [488, 488],
        { L: 1e-3 },
        { label: 'above' },
      ],
      ['bconv', 'boostConverter', 'Boost', [704, 504], {}, { label: 'above' }],
    ],
    links: [
      ['bsrc.n', 'bg.p'],
      ['bsrc.p', 'bl.p'],
      ['bl.n', 'bconv.dc_p1'],
      ['bsrc.n', 'bconv.dc_n1'],
      ['bconv.dc_p2', 'bc.p'],
      ['bconv.dc_n2', 'bc.n'],
      ['bpwm.fire', 'bconv.fire_p'],
    ],
  },
);

const bidirectional = merge(
  modulator('c', [360, 1088], 0.5, 'PWM 10 kHz (half-bridge)'),
  output('c', [912, 888], 50),
  {
    blocks: [
      [
        'csrc',
        'dcSource',
        '12 V (half-bridge)',
        [360, 888],
        { V: 12 },
        { label: 'left' },
      ],
      ['cg', 'ground', 'Ground (half-bridge)', [360, 992]],
      [
        'cl',
        'inductor',
        'L 1 mH (half-bridge)',
        [488, 856],
        { L: 1e-3 },
        { label: 'above' },
      ],
      [
        'cconv',
        'buckBoostConverter',
        'Half-bridge',
        [704, 872],
        {},
        { label: 'above' },
      ],
    ],
    links: [
      ['csrc.n', 'cg.p'],
      ['csrc.p', 'cl.p'],
      ['cl.n', 'cconv.dc_p1'],
      ['csrc.n', 'cconv.dc_n1'],
      ['cconv.dc_p2', 'cc.p'],
      ['cconv.dc_n2', 'cc.n'],
      ['cpwm.fire', 'cconv.fire_p'],
      ['cpwm.notFire', 'cconv.fire_n'],
    ],
  },
);

/** A PWM generator whose duty follows a 50 Hz sine: 0.5 ± 0.4. */
function sinePwm(
  id: string,
  [x, y]: [number, number],
  phase: number,
  name: string,
): Part {
  return {
    blocks: [
      [
        `${id}ref`,
        'sine',
        `Duty ${name}`,
        [x, y],
        { amplitude: 0.4, offset: 0.5, frequency: 50, phase },
      ],
      [`${id}pwm`, 'pwmSignal', `PWM ${name}`, [x + 192, y], { f: 10000 }],
    ],
    links: [[`${id}ref.y`, `${id}pwm.dutyCycle`]],
  };
}

const split = (
  id: string,
  [x, y]: [number, number],
  v: number,
  name: string,
): Part => ({
  // Two sources in series; their midpoint is ground, so the bus is ±v.
  blocks: [
    [
      `${id}hi`,
      'dcSource',
      `${v} V upper`,
      [x, y],
      { V: v },
      { label: 'left' },
    ],
    [
      `${id}lo`,
      'dcSource',
      `${v} V lower`,
      [x, y + 176],
      { V: v },
      { label: 'left' },
    ],
    [`${id}mid`, 'ground', name, [x - 96, y + 88]],
  ],
  links: [
    [`${id}hi.n`, `${id}lo.p`],
    [`${id}hi.n`, `${id}mid.p`],
  ],
});

export const converters: ExampleSpec[] = [
  {
    id: 'dc-dc',
    title: 'DC-DC converters',
    area: 'Converters',
    summary:
      'Buck, boost, and bidirectional half-bridge converters switching at 10 kHz with 50 % duty.',
    description:
      'Each converter is switched by a 10 kHz PWM generator at a duty cycle of 0.5 and filtered by 1 mH and 100 µF. The buck halves 24 V to 12 V. The boost doubles 12 V to 24 V, 12 V / (1 − 0.5). The half-bridge is driven with complementary gates, so it boosts the same way while its upper switch rectifies synchronously. Zoom into the output to see the switching ripple.',
    duration: 0.05,
    ...merge(buck, boost, bidirectional),
    plots: [
      {
        label: 'Output voltages',
        series: ['av.y', 'bv.y', 'cv.y'],
        labels: ['Buck', 'Boost', 'Half-bridge'],
      },
    ],
    checks: [
      {
        signal: 'av.y',
        mean: [0.04, 0.05],
        value: 12,
        tol: 0.1,
        why: 'D · 24 V',
      },
      {
        signal: 'bv.y',
        mean: [0.04, 0.05],
        value: 24,
        tol: 0.2,
        why: '12 V / (1 − D)',
      },
      {
        signal: 'cv.y',
        mean: [0.04, 0.05],
        value: 24,
        tol: 0.2,
        why: '12 V / (1 − D)',
      },
    ],
    about: [
      'buckConverter',
      'boostConverter',
      'buckBoostConverter',
      'pwmSignal',
    ],
  },
  {
    id: 'inverters',
    title: 'H-bridge and single-phase inverter',
    area: 'Converters',
    summary:
      'An H-bridge driving an RL load with 75 % duty, and an inverter leg making 50 Hz AC from a split supply.',
    description:
      'The H-bridge switches its two legs in opposition, so its output averages (2D − 1) · 24 V = 12 V at D = 0.75: 6 A through 2 Ω once the 10 mH inductance has settled. The inverter leg switches between +12 V and −12 V; its duty cycle follows 0.5 + 0.4 sin(2π·50t), so its output averages a 9.6 V, 50 Hz sine. Over a positive half-cycle that averages 2/π of 9.6 V.',
    duration: 0.05,
    ...merge(
      modulator('h', [360, 392], 0.75, 'PWM 10 kHz'),
      {
        blocks: [
          [
            'hsrc',
            'dcSource',
            '24 V',
            [360, 184],
            { V: 24 },
            { label: 'left' },
          ],
          ['hg', 'ground', 'Ground', [360, 288]],
          ['hb', 'hBridge', 'H-bridge', [552, 168], {}, { label: 'above' }],
          ['hr', 'resistor', 'R 2 Ω', [760, 152], { R: 2 }, { label: 'above' }],
          [
            'hl',
            'inductor',
            'L 10 mH',
            [904, 232],
            { L: 0.01 },
            { rotation: 90, label: 'right' },
          ],
          ['hi', 'currentSensor', 'i load', [760, 312], {}, { rotation: 180 }],
        ],
        links: [
          ['hsrc.n', 'hg.p'],
          ['hsrc.p', 'hb.dc_p1'],
          ['hsrc.n', 'hb.dc_n1'],
          ['hb.dc_p2', 'hr.p'],
          ['hr.n', 'hl.p'],
          ['hl.n', 'hi.p'],
          ['hi.n', 'hb.dc_n2'],
          ['hpwm.fire', 'hb.fire_p'],
          ['hpwm.notFire', 'hb.fire_n'],
        ],
      },
      split('s', [424, 584], 12, 'Midpoint'),
      sinePwm('s', [168, 944], 0, '50 Hz'),
      {
        blocks: [
          [
            'sinv',
            'singlePhaseInverter',
            'Inverter leg',
            [632, 672],
            {},
            { label: 'above' },
          ],
          [
            'sr',
            'resistor',
            'Load 10 Ω',
            [840, 672],
            { R: 10 },
            { label: 'above' },
          ],
          ['sg', 'ground', 'Ground (load)', [976, 776]],
          ['sv', 'voltageSensor', 'v AC', [1104, 672], {}, { label: 'right' }],
          ['svg', 'ground', 'Ground (v AC)', [1104, 776]],
        ],
        links: [
          ['shi.p', 'sinv.dc_p'],
          ['slo.n', 'sinv.dc_n'],
          ['sinv.ac', 'sr.p'],
          ['sr.n', 'sg.p'],
          ['sv.p', 'sinv.ac'],
          ['sv.n', 'svg.p'],
          ['spwm.fire', 'sinv.fire_p'],
          ['spwm.notFire', 'sinv.fire_n'],
        ],
      },
    ),
    plots: [
      { label: 'H-bridge load current', series: ['hi.y'], labels: ['i load'] },
      { label: 'Inverter output', series: ['sv.y'], labels: ['v AC'] },
    ],
    checks: [
      {
        signal: 'hi.y',
        mean: [0.04, 0.05],
        value: 6,
        tol: 0.1,
        why: '(2D − 1) · 24 V / 2 Ω',
      },
      {
        signal: 'sv.y',
        mean: [0.02, 0.03],
        value: (2 / Math.PI) * 9.6,
        tol: 0.15,
        why: '2/π of the 9.6 V fundamental',
      },
      {
        signal: 'sv.y',
        min: -12.01,
        max: 12.01,
        why: 'switches between ±12 V',
      },
    ],
    about: ['hBridge', 'singlePhaseInverter'],
  },
  {
    id: 'rectifiers',
    title: 'Rectifier bridges',
    area: 'Converters',
    summary:
      'A diode bridge and a thyristor bridge fired at 90°, each feeding a 10 Ω load from a 10 V sine.',
    description:
      'The diode bridge turns both halves of the 10 V, 50 Hz sine positive, so its output averages 2 · 10 V / π = 6.37 V. The thyristor bridge is fired 5 ms, or 90°, into each half-cycle, so it passes only the second quarter of each half and averages 10 V / π · (1 + cos 90°) = 3.18 V.',
    duration: 0.04,
    blocks: [
      [
        'dsrc',
        'sineVoltage',
        '10 V 50 Hz',
        [168, 216],
        { V: 10, f: 50 },
        { label: 'left' },
      ],
      ['dg', 'ground', 'Ground', [168, 320]],
      ['db', 'diodeBridge', 'Diode bridge', [360, 200], {}, { label: 'above' }],
      [
        'dr',
        'resistor',
        'Load (diodes)',
        [552, 216],
        { R: 10 },
        { rotation: 90, label: 'right' },
      ],
      [
        'dv',
        'voltageSensor',
        'v DC (diodes)',
        [744, 216],
        {},
        { label: 'right' },
      ],
      [
        'tsrc',
        'sineVoltage',
        '10 V 50 Hz (thyristors)',
        [1096, 216],
        { V: 10, f: 50 },
        { label: 'left' },
      ],
      ['tg', 'ground', 'Ground (thyristors)', [1096, 320]],
      [
        'tb',
        'thyristorBridge',
        'Thyristor bridge',
        [1288, 200],
        {},
        { label: 'above' },
      ],
      [
        'tr',
        'resistor',
        'Load (thyristors)',
        [1480, 216],
        { R: 10 },
        { rotation: 90, label: 'right' },
      ],
      [
        'tv',
        'voltageSensor',
        'v DC (thyristors)',
        [1672, 216],
        {},
        { label: 'right' },
      ],
      [
        'fp',
        'booleanPulse',
        'Fire + at 90°',
        [1184, 400],
        { width: 25, period: 0.02, startTime: 0.005 },
      ],
      [
        'fn',
        'booleanPulse',
        'Fire − at 90°',
        [1392, 400],
        { width: 25, period: 0.02, startTime: 0.015 },
      ],
    ],
    links: [
      ['dsrc.n', 'dg.p'],
      ['dsrc.p', 'db.ac_p'],
      ['dsrc.n', 'db.ac_n'],
      ['db.dc_p', 'dr.p'],
      ['db.dc_n', 'dr.n'],
      ['dv.p', 'dr.p'],
      ['dv.n', 'dr.n'],
      ['tsrc.n', 'tg.p'],
      ['tsrc.p', 'tb.ac_p'],
      ['tsrc.n', 'tb.ac_n'],
      ['tb.dc_p', 'tr.p'],
      ['tb.dc_n', 'tr.n'],
      ['tv.p', 'tr.p'],
      ['tv.n', 'tr.n'],
      ['fp.y', 'tb.fire_p'],
      ['fn.y', 'tb.fire_n'],
    ],
    plots: [
      {
        label: 'DC voltages',
        series: ['dv.y', 'tv.y'],
        labels: ['Diode bridge', 'Thyristor bridge'],
      },
    ],
    checks: [
      {
        signal: 'dv.y',
        mean: [0.02, 0.04],
        value: 20 / Math.PI,
        tol: 0.02,
        why: '2 · 10 V / π',
      },
      {
        signal: 'tv.y',
        mean: [0.02, 0.04],
        value: 10 / Math.PI,
        tol: 0.02,
        why: '10 V / π · (1 + cos 90°)',
      },
      {
        signal: 'tv.y',
        at: 0.023,
        value: 0,
        tol: 0.01,
        why: 'not yet fired in this half-cycle',
      },
    ],
    about: ['diodeBridge', 'thyristorBridge'],
  },
  {
    id: 'three-phase-inverter',
    title: 'Three-phase inverter',
    area: 'Converters',
    summary:
      'A two-level inverter makes 50 Hz three-phase current in a star-connected resistive load.',
    description:
      'Three PWM generators follow duty cycles 0.5 + 0.4 sin(2π·50t − k·120°). The inverter switches each phase between +50 V and −50 V of a split DC bus, so each phase averages a 40 V sine; into 10 Ω per phase that is a 4 A sine, whose positive half-cycle averages 2/π of 4 A. The load star point is tied to the bus midpoint.',
    duration: 0.04,
    ...merge(
      split('d', [488, 152], 50, 'Midpoint'),
      sinePwm('a', [168, 504], 0, 'a'),
      sinePwm('b', [168, 640], (-2 * Math.PI) / 3, 'b'),
      sinePwm('c', [168, 776], (2 * Math.PI) / 3, 'c'),
      {
        blocks: [
          [
            'inv',
            'threePhaseInverter',
            'Inverter',
            [760, 240],
            {},
            { label: 'above' },
          ],
          [
            'i3',
            'threePhaseCurrentSensor',
            'Phase currents',
            [1024, 240],
            {},
            { label: 'above' },
          ],
          [
            'load',
            'threePhaseResistor',
            'Load 10 Ω',
            [1232, 240],
            { R: 10 },
            { label: 'above' },
          ],
          ['star', 'star', 'Star', [1392, 240], {}, { label: 'above' }],
          ['sg', 'ground', 'Ground (star)', [1504, 344]],
        ],
        links: [
          ['dhi.p', 'inv.dc_p'],
          ['dlo.n', 'inv.dc_n'],
          ['inv.ac', 'i3.plug_p'],
          ['i3.plug_n', 'load.plug_p'],
          ['load.plug_n', 'star.plug_p'],
          ['star.pin_n', 'sg.p'],
          ['apwm.fire', 'inv.fa_p'],
          ['apwm.notFire', 'inv.fa_n'],
          ['bpwm.fire', 'inv.fb_p'],
          ['bpwm.notFire', 'inv.fb_n'],
          ['cpwm.fire', 'inv.fc_p'],
          ['cpwm.notFire', 'inv.fc_n'],
        ],
      },
    ),
    plots: [
      {
        label: 'Phase currents',
        series: ['i3.ia', 'i3.ib', 'i3.ic'],
        labels: ['a', 'b', 'c'],
      },
    ],
    checks: [
      {
        signal: 'i3.ia',
        mean: [0.02, 0.03],
        value: (2 / Math.PI) * 4,
        tol: 0.06,
        why: '2/π of the 4 A fundamental',
      },
      {
        signal: 'i3.ib',
        mean: [0.02, 0.04],
        value: 0,
        tol: 0.05,
        why: 'no DC in a balanced phase',
      },
    ],
    about: ['threePhaseInverter'],
  },
];
