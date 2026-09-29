import type { BlockOptions, ExampleSpec } from './types';

type Blocks = ExampleSpec['blocks'];
type Links = ExampleSpec['links'];
type Part = { blocks: Blocks; links: Links };
const merge = (...parts: Part[]): Part => ({
  blocks: parts.flatMap((p) => p.blocks),
  links: parts.flatMap((p) => p.links),
});

/** A sine source, a series part in the top rail, and a load with a voltmeter. */
function rectifier(
  id: string,
  [x, y]: [number, number],
  part: [string, string, Record<string, number>?, BlockOptions?],
): Part {
  const [kind, name, params, options] = part;
  const tag = id.toUpperCase();
  return {
    blocks: [
      [
        `${id}src`,
        'sineVoltage',
        `10 V 50 Hz ${tag}`,
        [x + 40, y + 200],
        { V: 10, f: 50 },
        { label: 'left' },
      ],
      [`${id}d`, kind, name, [x + 184, y + 120], params ?? {}, options ?? {}],
      [
        `${id}r`,
        'resistor',
        `Load ${tag}`,
        [x + 328, y + 200],
        { R: 10 },
        { rotation: 90, label: 'right' },
      ],
      [
        `${id}v`,
        'voltageSensor',
        `v ${tag}`,
        [x + 488, y + 200],
        {},
        { label: 'right' },
      ],
      [`${id}g`, 'ground', `Ground ${tag}`, [x + 40, y + 304]],
    ],
    links: [
      [`${id}src.p`, `${id}d.p`],
      [`${id}d.n`, `${id}r.p`],
      [`${id}r.n`, `${id}src.n`],
      [`${id}src.n`, `${id}g.p`],
      [`${id}v.p`, `${id}r.p`],
      [`${id}v.n`, `${id}r.n`],
    ],
  };
}

/** A 5 V square-wave input with its ground, drawn as a vertical source. */
function input(id: string, [x, y]: [number, number], name: string): Part {
  return {
    blocks: [
      [
        id,
        'pulseVoltage',
        name,
        [x, y],
        { V: 5, width: 50, period: 0.01 },
        { label: 'left' },
      ],
      [`${id}g`, 'ground', `Ground (${name})`, [x, y + 104]],
    ],
    links: [[`${id}.n`, `${id}g.p`]],
  };
}

/** A 5 V supply with its ground. */
function supply(id: string, [x, y]: [number, number], name: string): Part {
  return {
    blocks: [
      [id, 'dcSource', name, [x, y], { V: 5 }, { label: 'left' }],
      [`${id}g`, 'ground', `Ground (${name})`, [x, y + 104]],
    ],
    links: [[`${id}.n`, `${id}g.p`]],
  };
}

const cmos = merge(
  input('in1', [168, 496], 'Input'),
  supply('vdd', [424, 168], 'VDD 5 V'),
  {
    blocks: [
      [
        'pm',
        'pmos',
        'PMOS',
        [600, 280],
        {},
        { ports: { S: 'top', D: 'bottom' }, label: [72, -40] },
      ],
      ['nm', 'nmos', 'NMOS', [600, 504], {}, { label: [72, -40] }],
      ['gn', 'ground', 'Ground (NMOS)', [600, 624]],
      [
        'vout',
        'voltageSensor',
        'Inverter out',
        [800, 504],
        {},
        { label: 'right' },
      ],
      ['gv', 'ground', 'Ground (out)', [800, 624]],
    ],
    links: [
      ['vdd.p', 'pm.S'],
      ['pm.B', 'pm.S'],
      ['pm.D', 'nm.D'],
      ['nm.B', 'nm.S'],
      ['nm.S', 'gn.p'],
      ['in1.p', 'nm.G'],
      ['in1.p', 'pm.G'],
      ['vout.p', 'nm.D'],
      ['vout.n', 'gv.p'],
    ],
  },
);

const npn = merge(
  input('in2', [1112, 496], 'Input, NPN'),
  supply('vcc', [1112, 168], 'VCC 5 V'),
  {
    blocks: [
      [
        'rc',
        'resistor',
        'R C 1 kΩ',
        [1400, 296],
        { R: 1000 },
        { rotation: 90, label: 'right' },
      ],
      [
        'rb',
        'resistor',
        'R B 10 kΩ',
        [1248, 432],
        { R: 10000 },
        { label: 'above' },
      ],
      ['q', 'npn', 'NPN', [1400, 432], {}, { label: 'right' }],
      ['ge', 'ground', 'Ground (NPN)', [1400, 552]],
      [
        'vce',
        'voltageSensor',
        'Collector',
        [1600, 432],
        {},
        { label: 'right' },
      ],
      ['gce', 'ground', 'Ground (collector)', [1600, 552]],
    ],
    links: [
      ['vcc.p', 'rc.p'],
      ['rc.n', 'q.C'],
      ['in2.p', 'rb.p'],
      ['rb.n', 'q.B'],
      ['q.E', 'ge.p'],
      ['vce.p', 'q.C'],
      ['vce.n', 'gce.p'],
    ],
  },
);

const pnp = merge(
  input('in3', [1112, 960], 'Input, PNP'),
  supply('vcc2', [936, 744], 'VCC 5 V, PNP'),
  {
    blocks: [
      [
        'rb2',
        'resistor',
        'R B 10 kΩ (PNP)',
        [1248, 848],
        { R: 10000 },
        { label: 'above' },
      ],
      [
        'q2',
        'pnp',
        'PNP',
        [1400, 848],
        {},
        { ports: { E: 'top', C: 'bottom' }, label: 'right' },
      ],
      [
        'rl2',
        'resistor',
        'Load 1 kΩ',
        [1400, 992],
        { R: 1000 },
        { rotation: 90, label: 'right' },
      ],
      ['gl2', 'ground', 'Ground (PNP load)', [1400, 1096]],
      [
        'vl2',
        'voltageSensor',
        'Load voltage',
        [1600, 992],
        {},
        { label: 'right' },
      ],
      ['gv2', 'ground', 'Ground (load voltage)', [1600, 1096]],
    ],
    links: [
      ['vcc2.p', 'q2.E'],
      ['in3.p', 'rb2.p'],
      ['rb2.n', 'q2.B'],
      ['q2.C', 'rl2.p'],
      ['rl2.n', 'gl2.p'],
      ['vl2.p', 'rl2.p'],
      ['vl2.n', 'gv2.p'],
    ],
  },
);

export const power: ExampleSpec[] = [
  {
    id: 'diodes',
    title: 'Diodes and a Zener regulator',
    area: 'Semiconductors',
    summary:
      'Three diode models rectifying a 10 V sine, and a Zener diode holding 5.1 V.',
    description:
      'Each diode passes the positive half of a 10 V, 50 Hz sine into its 10 Ω load and blocks the negative half. The simple and ideal diodes pass almost the whole 10 V peak; the exponential (Shockley) diode drops some tenths of a volt. The Zener regulator feeds 12 V through 100 Ω into a reverse-biased Zener diode, which clamps near its 5.1 V breakdown voltage: at 70 mA it holds 5.03 V, because its rated knee current is 0.7 A.',
    duration: 0.04,
    ...merge(
      rectifier('a', [128, 32], ['diode', 'Diode', {}, { label: 'above' }]),
      rectifier(
        'b',
        [800, 32],
        ['idealDiode', 'Ideal diode', {}, { label: 'above' }],
      ),
      rectifier(
        'c',
        [128, 400],
        ['diodeShockley', 'Diode (exponential)', {}, { label: 'above' }],
      ),
      {
        blocks: [
          ['z12', 'dcSource', '12 V', [840, 600], { V: 12 }, { label: 'left' }],
          [
            'zr',
            'resistor',
            'R 100 Ω',
            [984, 520],
            { R: 100 },
            { label: 'above' },
          ],
          [
            'z',
            'zenerDiode',
            'Zener 5.1 V',
            [1128, 600],
            { Bv: 5.1 },
            { rotation: 270, label: 'right' },
          ],
          [
            'vz',
            'voltageSensor',
            'v Zener',
            [1288, 600],
            {},
            { label: 'right' },
          ],
          ['gz', 'ground', 'Ground (Zener)', [840, 704]],
        ],
        links: [
          ['z12.p', 'zr.p'],
          ['zr.n', 'z.n'],
          ['z.p', 'z12.n'],
          ['z12.n', 'gz.p'],
          ['vz.p', 'z.n'],
          ['vz.n', 'z.p'],
        ],
      },
    ),
    plots: [
      {
        label: 'Rectified',
        series: ['av.y', 'bv.y', 'cv.y'],
        labels: ['Diode', 'Ideal diode', 'Exponential diode'],
      },
      { label: 'Zener voltage', series: ['vz.y'], labels: ['v Zener'] },
    ],
    checks: [
      {
        signal: 'av.y',
        at: 0.005,
        value: 10,
        tol: 0.01,
        why: 'forward: the 10 V peak',
      },
      {
        signal: 'av.y',
        at: 0.015,
        value: 0,
        tol: 0.01,
        why: 'reverse: blocked',
      },
      {
        signal: 'bv.y',
        at: 0.005,
        value: 10,
        tol: 0.01,
        why: 'ideal diode: the 10 V peak',
      },
      {
        signal: 'bv.y',
        at: 0.015,
        value: 0,
        tol: 0.01,
        why: 'reverse: blocked',
      },
      {
        signal: 'cv.y',
        at: 0.005,
        min: 9,
        max: 9.8,
        why: 'a Shockley diode drops some tenths of a volt',
      },
      {
        signal: 'cv.y',
        at: 0.015,
        value: 0,
        tol: 0.01,
        why: 'reverse: blocked',
      },
      {
        signal: 'vz.y',
        value: 5.1 + 0.74 * 0.04 * Math.log(0.0697 / 0.7),
        tol: 2e-3,
        why: 'Bv + Nbv·Vt·ln(i/Ibv): about 70 mA against the 0.7 A knee current',
      },
    ],
    about: ['diode', 'idealDiode', 'diodeShockley', 'zenerDiode'],
  },
  {
    id: 'transistors',
    title: 'Transistor switches',
    area: 'Semiconductors',
    summary:
      'A CMOS inverter of an NMOS and a PMOS transistor, and NPN and PNP transistors switching loads.',
    description:
      'Each circuit is driven by the same 5 V square wave, high for the first 5 ms of every 10 ms. The CMOS inverter outputs 0 V while its input is high and 5 V while it is low. The NPN transistor saturates when its base is driven high and pulls its collector almost to 0 V. The PNP transistor turns on when its base is pulled low and puts most of the 5 V supply across its load.',
    duration: 0.02,
    ...merge(cmos, npn, pnp),
    plots: [
      { label: 'CMOS inverter', series: ['vout.y'], labels: ['Inverter out'] },
      {
        label: 'Bipolar switches',
        series: ['vce.y', 'vl2.y'],
        labels: ['NPN collector', 'PNP load'],
      },
    ],
    checks: [
      {
        signal: 'vout.y',
        at: 0.0025,
        value: 0,
        tol: 0.05,
        why: 'input high: NMOS on, output low',
      },
      {
        signal: 'vout.y',
        at: 0.0075,
        value: 5,
        tol: 0.05,
        why: 'input low: PMOS on, output high',
      },
      { signal: 'vce.y', at: 0.0025, max: 0.3, why: 'base driven: saturated' },
      {
        signal: 'vce.y',
        at: 0.0075,
        value: 5,
        tol: 0.05,
        why: 'base low: off, no drop on R C',
      },
      {
        signal: 'vl2.y',
        at: 0.0075,
        min: 3.5,
        max: 5,
        why: 'base low: the PNP sources current into its load',
      },
      {
        signal: 'vl2.y',
        at: 0.0025,
        value: 0,
        tol: 0.05,
        why: 'base high: off',
      },
    ],
    about: ['nmos', 'pmos', 'npn', 'pnp'],
  },
  {
    id: 'thyristors',
    title: 'Thyristor and GTO',
    area: 'Semiconductors',
    summary:
      'A thyristor that stays on until its current falls to zero, and a GTO that turns off with its gate.',
    description:
      'Both switch a 10 V, 50 Hz sine into a 10 Ω load and are fired 2.5 ms into each cycle for 2 ms. The thyristor latches: once fired it conducts until its current reaches zero at the end of the positive half-cycle. The GTO stops conducting as soon as its gate goes off at 4.5 ms.',
    duration: 0.04,
    ...merge(
      rectifier(
        't',
        [128, 128],
        ['idealThyristor', 'Thyristor', {}, { ports: { fire: 'top' } }],
      ),
      rectifier(
        'g',
        [800, 128],
        ['idealGTO', 'GTO', {}, { ports: { fire: 'top' } }],
      ),
      {
        blocks: [
          [
            'fire',
            'booleanPulse',
            'Fire at 2.5 ms',
            [312, 64],
            { width: 10, period: 0.02, startTime: 0.0025 },
            { label: 'left' },
          ],
          [
            'fire2',
            'booleanPulse',
            'Fire at 2.5 ms (GTO)',
            [984, 64],
            { width: 10, period: 0.02, startTime: 0.0025 },
            { label: 'left' },
          ],
        ],
        links: [
          ['fire.y', 'td.fire'],
          ['fire2.y', 'gd.fire'],
        ],
      },
    ),
    plots: [
      {
        label: 'Load voltages',
        series: ['tv.y', 'gv.y'],
        labels: ['Thyristor', 'GTO'],
      },
    ],
    checks: [
      { signal: 'tv.y', at: 0.002, value: 0, tol: 0.01, why: 'not fired yet' },
      {
        signal: 'tv.y',
        at: 0.007,
        value: 10 * Math.sin(2 * Math.PI * 50 * 0.007),
        tol: 0.01,
        why: 'latched on after the gate pulse',
      },
      {
        signal: 'tv.y',
        at: 0.015,
        value: 0,
        tol: 0.01,
        why: 'turned off at the current zero',
      },
      {
        signal: 'gv.y',
        at: 0.004,
        value: 10 * Math.sin(2 * Math.PI * 50 * 0.004),
        tol: 0.01,
        why: 'gate on: conducting',
      },
      {
        signal: 'gv.y',
        at: 0.007,
        value: 0,
        tol: 0.01,
        why: 'gate off: turned off',
      },
    ],
    about: ['idealThyristor', 'idealGTO'],
  },
];
