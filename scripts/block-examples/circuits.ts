import type { ExampleSpec } from './types';

type Blocks = ExampleSpec['blocks'];
type Links = ExampleSpec['links'];
type Part = { blocks: Blocks; links: Links };
const merge = (...parts: Part[]): Part => ({
  blocks: parts.flatMap((p) => p.blocks),
  links: parts.flatMap((p) => p.links),
});

// -------------------------------------------------------------- variable parts

/** A 10 V source through a series element whose value a signal sets, and an ammeter. */
function seriesCell(
  id: string,
  [x, y]: [number, number],
  element: [string, string, string],
  control: [string, string, Record<string, number>],
  source: [string, string, Record<string, number>],
): Part {
  const [kind, name, input] = element;
  return {
    blocks: [
      [
        `${id}sig`,
        control[0],
        control[1],
        [x + 40, y + 48],
        control[2],
        { label: 'above' },
      ],
      [
        `${id}src`,
        source[0],
        source[1],
        [x + 40, y + 216],
        source[2],
        { label: 'left' },
      ],
      [
        `${id}el`,
        kind,
        name,
        [x + 192, y + 136],
        {},
        { label: 'above', ports: { [input]: 'bottom' } },
      ],
      [`${id}i`, 'currentSensor', `i ${id.toUpperCase()}`, [x + 352, y + 136]],
      [`${id}gnd`, 'ground', `Ground ${id.toUpperCase()}`, [x + 40, y + 320]],
    ],
    links: [
      [`${id}sig.y`, `${id}el.${input}`],
      [`${id}src.p`, `${id}el.p`],
      [`${id}el.n`, `${id}i.p`],
      [`${id}i.n`, `${id}src.n`],
      [`${id}src.n`, `${id}gnd.p`],
    ],
  };
}

const variable = merge(
  seriesCell(
    'r',
    [128, 64],
    ['variableResistor', 'Variable resistor', 'R'],
    ['sine', 'R = 10 + 5 sin 2πt', { amplitude: 5, offset: 10, frequency: 1 }],
    ['dcSource', 'DC 10 V', { V: 10 }],
  ),
  seriesCell(
    'l',
    [704, 64],
    ['variableInductor', 'Variable inductor', 'L'],
    ['sine', 'L = 2 + sin(πt/2)', { amplitude: 1, offset: 2, frequency: 0.25 }],
    ['dcSource', 'DC 1 V', { V: 1 }],
  ),
  {
    // A current source charges a capacitor whose capacitance doubles at 0.5 s.
    blocks: [
      ['cbase', 'constant', 'C₀ = 1 mF', [168, 480], { value: 1e-3 }],
      [
        'cstep',
        'step',
        '+1 mF at 0.5 s',
        [168, 592],
        { height: 1e-3, startTime: 0.5 },
      ],
      ['csum', 'sum', 'C', [336, 536], {}, { ports: { b: 'left' } }],
      [
        'csrc',
        'dcCurrent',
        'DC 1 mA',
        [496, 632],
        { I: 1e-3 },
        { rotation: 180, label: 'left' },
      ],
      [
        'cel',
        'variableCapacitor',
        'Variable capacitor',
        [640, 632],
        {},
        { rotation: 90, label: 'right', ports: { C: 'left' } },
      ],
      ['cv', 'voltageSensor', 'v C', [880, 632], {}, { label: 'right' }],
      ['cgnd', 'ground', 'Ground C', [496, 736]],
    ],
    links: [
      ['cbase.y', 'csum.a'],
      ['cstep.y', 'csum.b'],
      ['csum.y', 'cel.C'],
      ['csrc.n', 'cel.p'],
      ['cel.n', 'csrc.p'],
      ['csrc.p', 'cgnd.p'],
      ['cv.p', 'cel.p'],
      ['cv.n', 'cel.n'],
    ],
  },
  {
    // A 10 V potentiometer; the wiper voltage follows the position input.
    blocks: [
      [
        'psig',
        'ramp',
        'Wiper position',
        [1040, 448],
        { slope: 1, startTime: 0 },
      ],
      [
        'psrc',
        'dcSource',
        'DC 10 V (pot)',
        [1160, 632],
        { V: 10 },
        { label: 'left' },
      ],
      [
        'pot',
        'potentiometer',
        'Potentiometer',
        [1336, 552],
        { R: 1000 },
        { label: [96, -60] },
      ],
      [
        'pv',
        'voltageSensor',
        'Wiper voltage',
        [1496, 632],
        {},
        { label: 'right' },
      ],
      ['pgnd', 'ground', 'Ground P', [1160, 736]],
    ],
    links: [
      ['psig.y', 'pot.r'],
      ['psrc.p', 'pot.pin_p'],
      ['pot.pin_n', 'psrc.n'],
      ['psrc.n', 'pgnd.p'],
      ['pv.p', 'pot.contact'],
      ['pv.n', 'psrc.n'],
    ],
  },
);

// -------------------------------------------------------------- controlled sources

/** A controlled source: its input side driven, its output across a 10 Ω load. */
function controlled(
  id: string,
  [x, y]: [number, number],
  kind: string,
  name: string,
  params: Record<string, number>,
  byCurrent: boolean,
): Part {
  return {
    blocks: [
      [
        `${id}src`,
        'dcSource',
        `1 V ${id.toUpperCase()}`,
        [x + 40, y + 176],
        { V: 1 },
        { label: 'left' },
      ],
      ...(byCurrent
        ? ([
            [
              `${id}r1`,
              'resistor',
              `1 Ω ${id.toUpperCase()}`,
              [x + 144, y + 112],
              { R: 1 },
              { label: 'above' },
            ],
          ] as Blocks)
        : []),
      [`${id}el`, kind, name, [x + 288, y + 128], params, { label: 'above' }],
      [
        `${id}load`,
        'resistor',
        `Load ${id.toUpperCase()}`,
        [x + 432, y + 176],
        { R: 10 },
        { rotation: 90, label: 'right' },
      ],
      [
        `${id}v`,
        'voltageSensor',
        `v ${id.toUpperCase()}`,
        [x + 560, y + 176],
        {},
        { label: 'right' },
      ],
      [`${id}gnd`, 'ground', `Ground ${id.toUpperCase()}`, [x + 40, y + 280]],
      [
        `${id}gnd2`,
        'ground',
        `Ground ${id.toUpperCase()} out`,
        [x + 432, y + 280],
      ],
    ],
    links: [
      ...(byCurrent
        ? ([
            [`${id}src.p`, `${id}r1.p`],
            [`${id}r1.n`, `${id}el.p1`],
          ] as Links)
        : ([[`${id}src.p`, `${id}el.p1`]] as Links)),
      [`${id}el.n1`, `${id}src.n`],
      [`${id}src.n`, `${id}gnd.p`],
      [`${id}el.p2`, `${id}load.p`],
      [`${id}el.n2`, `${id}load.n`],
      [`${id}load.n`, `${id}gnd2.p`],
      [`${id}v.p`, `${id}load.p`],
      [`${id}v.n`, `${id}load.n`],
    ],
  };
}

const sourcesOut = merge(
  controlled('a', [128, 32], 'vcvs', 'VCVS ×2', { gain: 2 }, false),
  controlled(
    'b',
    [864, 32],
    'vccs',
    'VCCS 0.1 S',
    { transConductance: 0.1 },
    false,
  ),
  controlled(
    'c',
    [128, 384],
    'ccvs',
    'CCVS 10 Ω',
    { transResistance: 10 },
    true,
  ),
  controlled('d', [864, 384], 'cccs', 'CCCS ×3', { gain: 3 }, true),
  controlled(
    'e',
    [128, 736],
    'gyrator',
    'Gyrator 1 S',
    { G1: 1, G2: 1 },
    false,
  ),
);

// -------------------------------------------------------------- switches

/** A 10 V source, an ammeter, a switch in the top rail, and a vertical load. */
function switchCell(
  id: string,
  [x, y]: [number, number],
  sw: [string, string, Record<string, number>?],
  control: [string, string, string, Record<string, number>],
  series?: [string, string, Record<string, number>],
): Part {
  const [kind, name, params] = sw;
  const [input, ckind, cname, cparams] = control;
  const loadX = series ? x + 592 : x + 464;
  return {
    blocks: [
      ...(series
        ? ([
            [
              `${id}ser`,
              series[0],
              series[1],
              [x + 448, y + 120],
              series[2],
              { label: 'above' },
            ],
          ] as Blocks)
        : []),
      [
        `${id}src`,
        'dcSource',
        `10 V ${id.toUpperCase()}`,
        [x + 40, y + 200],
        { V: 10 },
        { label: 'left' },
      ],
      [`${id}i`, 'currentSensor', `i ${id.toUpperCase()}`, [x + 168, y + 120]],
      [`${id}sw`, kind, name, [x + 312, y + 120], params ?? {}],
      [`${id}ctl`, ckind, cname, [x + 168, y + 16], cparams],
      [
        `${id}load`,
        'resistor',
        `Load ${id.toUpperCase()}`,
        [loadX, y + 200],
        { R: 10 },
        { rotation: 90, label: 'right' },
      ],
      [`${id}gnd`, 'ground', `Ground ${id.toUpperCase()}`, [x + 40, y + 304]],
    ],
    links: [
      [`${id}src.p`, `${id}i.p`],
      [`${id}i.n`, `${id}sw.p`],
      [`${id}ctl.y`, `${id}sw.${input}`],
      ...(series
        ? ([
            [`${id}sw.n`, `${id}ser.p`],
            [`${id}ser.n`, `${id}load.p`],
          ] as Links)
        : ([[`${id}sw.n`, `${id}load.p`]] as Links)),
      [`${id}load.n`, `${id}src.n`],
      [`${id}src.n`, `${id}gnd.p`],
    ],
  };
}

export const circuits: ExampleSpec[] = [
  {
    id: 'variable-parts',
    title: 'Variable parts',
    area: 'Electrical',
    summary:
      'A resistor, an inductor, and a capacitor whose values follow signals, and a potentiometer.',
    description:
      'The variable resistor swings between 5 Ω and 15 Ω on 10 V, so its current is 10/R: 0.67 A at 0.25 s and 2 A at 0.75 s. The inductor on 1 V builds flux linkage t, so its current is t/L: 1/3 A at 1 s, when L = 3 H, and 1 A at 2 s, when L = 2 H. The capacitor charges at 1 mA; when its capacitance doubles at 0.5 s its charge stays, so its voltage halves. The potentiometer wiper sweeps from 0 V to 10 V as the position input goes from 0 to 1.',
    duration: 2,
    ...variable,
    plots: [
      {
        label: 'Currents',
        series: ['ri.y', 'li.y'],
        labels: ['Variable resistor', 'Variable inductor'],
      },
      {
        label: 'Voltages',
        series: ['cv.y', 'pv.y'],
        labels: ['Variable capacitor', 'Wiper'],
      },
    ],
    checks: [
      {
        signal: 'ri.y',
        at: 0.25,
        value: 10 / 15,
        tol: 1e-3,
        why: '10 V / 15 Ω',
      },
      { signal: 'ri.y', at: 0.75, value: 2, tol: 1e-3, why: '10 V / 5 Ω' },
      {
        signal: 'li.y',
        at: 1,
        value: 1 / 3,
        tol: 1e-3,
        why: 'Ψ = 1 V · 1 s over L = 3 H',
      },
      { signal: 'li.y', at: 2, value: 1, tol: 1e-3, why: 'Ψ = 2 over L = 2 H' },
      {
        signal: 'cv.y',
        at: 0.4,
        value: 0.4,
        tol: 1e-3,
        why: 'Q/C = 0.4 mC / 1 mF',
      },
      {
        signal: 'cv.y',
        at: 0.6,
        value: 0.3,
        tol: 1e-3,
        why: 'Q/C = 0.6 mC / 2 mF',
      },
      {
        signal: 'pv.y',
        at: 0.5,
        value: 5,
        tol: 1e-3,
        why: 'wiper halfway: 5 V',
      },
    ],
    about: [
      'variableResistor',
      'variableInductor',
      'variableCapacitor',
      'potentiometer',
    ],
  },
  {
    id: 'op-amps',
    title: 'Op-amp amplifiers',
    area: 'Electrical',
    summary:
      'Two inverting amplifiers: an ideal op-amp with a gain of −10, and a limited one that clips at its ±15 V rails.',
    description:
      'Both amplify a 1 V, 50 Hz sine through 1 kΩ into the inverting input. With 10 kΩ feedback the ideal op-amp outputs −10 times the input, a 10 V sine in antiphase. With 20 kΩ the limited op-amp would need ±20 V, so its output flattens at its ±15 V supply.',
    duration: 0.04,
    blocks: [
      [
        'vin',
        'sineVoltage',
        '1 V 50 Hz',
        [168, 232],
        { V: 1, f: 50 },
        { label: 'left' },
      ],
      ['rin', 'resistor', 'R in 1 kΩ', [304, 176], { R: 1000 }],
      ['rf', 'resistor', 'R f 10 kΩ', [480, 80], { R: 10000 }],
      [
        'amp',
        'opAmp',
        'Ideal op-amp',
        [480, 184],
        {},
        { ports: { in_n: ['left', 33], in_p: ['left', 67] } },
      ],
      ['vout', 'voltageSensor', 'v out', [640, 232], {}, { label: 'right' }],
      ['g1', 'ground', 'Ground', [168, 336]],
      ['g2', 'ground', 'Ground +', [400, 336]],
      [
        'vin2',
        'sineVoltage',
        '1 V 50 Hz (limited)',
        [920, 232],
        { V: 1, f: 50 },
        { label: 'left' },
      ],
      ['rin2', 'resistor', 'R in 1 kΩ (limited)', [1056, 176], { R: 1000 }],
      ['rf2', 'resistor', 'R f 20 kΩ', [1232, 80], { R: 20000 }],
      [
        'amp2',
        'opAmpLimited',
        'Limited op-amp',
        [1232, 184],
        {},
        { ports: { in_n: ['left', 33], in_p: ['left', 67] } },
      ],
      [
        'vout2',
        'voltageSensor',
        'v out (limited)',
        [1392, 232],
        {},
        { label: 'right' },
      ],
      ['g3', 'ground', 'Ground (limited)', [920, 336]],
      ['g4', 'ground', 'Ground + (limited)', [1152, 336]],
    ],
    links: [
      ['vin.p', 'rin.p'],
      ['rin.n', 'amp.in_n'],
      ['rf.p', 'amp.in_n'],
      ['rf.n', 'amp.out'],
      ['amp.in_p', 'g2.p'],
      ['vin.n', 'g1.p'],
      ['vout.p', 'amp.out'],
      ['vout.n', 'g2.p'],
      ['vin2.p', 'rin2.p'],
      ['rin2.n', 'amp2.in_n'],
      ['rf2.p', 'amp2.in_n'],
      ['rf2.n', 'amp2.out'],
      ['amp2.in_p', 'g4.p'],
      ['vin2.n', 'g3.p'],
      ['vout2.p', 'amp2.out'],
      ['vout2.n', 'g4.p'],
    ],
    plots: [
      {
        label: 'Amplifier outputs',
        series: ['vout.y', 'vout2.y'],
        labels: ['Ideal, gain −10', 'Limited, gain −20'],
      },
    ],
    checks: [
      {
        signal: 'vout.y',
        at: 0.025,
        value: -10,
        tol: 0.01,
        why: '−10 × the 1 V peak',
      },
      {
        signal: 'vout.y',
        at: 0.035,
        value: 10,
        tol: 0.01,
        why: '−10 × the −1 V trough',
      },
      {
        signal: 'vout2.y',
        at: 0.025,
        value: -15,
        tol: 0.05,
        why: 'clipped at the −15 V rail',
      },
      {
        signal: 'vout2.y',
        min: -15.05,
        max: 15.05,
        why: 'never beyond the rails',
      },
      {
        signal: 'vout2.y',
        at: 0.0205,
        value: -20 * Math.sin(2 * Math.PI * 50 * 0.0205),
        tol: 0.05,
        why: 'linear below the rails',
      },
    ],
    about: ['opAmp', 'opAmpLimited'],
  },
  {
    id: 'controlled-sources',
    title: 'Controlled sources',
    area: 'Electrical',
    summary:
      'Voltage- and current-controlled sources and a gyrator, each driving a 10 Ω load.',
    description:
      'Each block reads its input side and drives its output side into 10 Ω. The VCVS doubles 1 V to 2 V. The VCCS turns 1 V into 0.1 A, 1 V across the load. The current-controlled pair read the 1 A that flows through 1 Ω and the short between their input pins: the CCVS makes 10 V, the CCCS 3 A, which is 30 V on the load. The gyrator turns 1 V on its input into 1 A on its output. A source whose output current flows out of p2 shows a negative voltage on the load.',
    duration: 0.01,
    ...sourcesOut,
    plots: [
      {
        label: 'Load voltages',
        series: ['av.y', 'bv.y', 'cv.y', 'dv.y', 'ev.y'],
        labels: ['VCVS', 'VCCS', 'CCVS', 'CCCS', 'Gyrator'],
      },
    ],
    checks: [
      { signal: 'av.y', value: 2, tol: 1e-6, why: '2 × 1 V' },
      {
        signal: 'bv.y',
        value: -1,
        tol: 1e-6,
        why: '0.1 S × 1 V into p2, out of the load',
      },
      { signal: 'cv.y', value: 10, tol: 1e-4, why: '10 Ω × 1 A' },
      {
        signal: 'dv.y',
        value: -30,
        tol: 1e-3,
        why: '3 × 1 A into p2, through 10 Ω',
      },
      {
        signal: 'ev.y',
        value: 10,
        tol: 1e-4,
        why: '1 S × 1 V gives 1 A, 10 V on 10 Ω',
      },
    ],
    about: ['vcvs', 'vccs', 'ccvs', 'cccs', 'gyrator'],
  },
  {
    id: 'transformers',
    title: 'Transformers and a saturating inductor',
    area: 'Electrical',
    summary:
      'A coupled-inductor and an ideal transformer on a 10 V sine, and an inductor that saturates as its current rises.',
    description:
      'The coupled inductors (1 H, 1 H, M = 0.9 H) pass 90 % of the 10 V primary to a light 10 kΩ load. The ideal transformer with ratio 2 halves it to 5 V. The saturating inductor carries a current that rises at 1 A/s: while the current is small it acts as 2 H, so 1 V appears across it; as it saturates its incremental inductance falls towards 0.5 H.',
    duration: 10,
    blocks: [
      [
        's1',
        'sineVoltage',
        '10 V 50 Hz',
        [168, 216],
        { V: 10, f: 50 },
        { label: 'left' },
      ],
      [
        'm',
        'mutualInductor',
        'Coupled inductors',
        [336, 184],
        { L1: 1, L2: 1, M: 0.9 },
        { label: 'above' },
      ],
      [
        'r1',
        'resistor',
        'Load 10 kΩ',
        [480, 216],
        { R: 10000 },
        { rotation: 90, label: 'right' },
      ],
      ['v1', 'voltageSensor', 'v coupled', [640, 216], {}, { label: 'right' }],
      ['g1', 'ground', 'Ground', [168, 320]],
      ['g1b', 'ground', 'Ground (coupled)', [480, 320]],
      [
        's2',
        'sineVoltage',
        '10 V 50 Hz (ideal)',
        [1000, 216],
        { V: 10, f: 50 },
        { label: 'left' },
      ],
      [
        't',
        'idealTransformer',
        'Ideal transformer',
        [1168, 184],
        { n: 2 },
        { label: 'above' },
      ],
      [
        'r2',
        'resistor',
        'Load 100 Ω',
        [1312, 216],
        { R: 100 },
        { rotation: 90, label: 'right' },
      ],
      ['v2', 'voltageSensor', 'v ideal', [1472, 216], {}, { label: 'right' }],
      ['g2', 'ground', 'Ground (ideal)', [1000, 320]],
      ['g2b', 'ground', 'Ground (ideal out)', [1312, 320]],
      ['ramp', 'ramp', '1 A/s', [128, 640], { slope: 1, startTime: 0 }],
      [
        'is',
        'signalCurrent',
        'Current source',
        [336, 552],
        {},
        { label: 'left', ports: { i: ['left', 80] } },
      ],
      [
        'ls',
        'saturatingInductor',
        'Saturating inductor',
        [480, 552],
        { Inom: 1, Lnom: 1, Lzer: 2, Linf: 0.5 },
        { rotation: 270, label: 'right' },
      ],
      [
        'v3',
        'voltageSensor',
        'v L',
        [784, 552],
        {},
        { rotation: 180, label: 'right' },
      ],
      ['g3', 'ground', 'Ground (saturating)', [336, 656]],
    ],
    links: [
      ['s1.p', 'm.p1'],
      ['m.n1', 's1.n'],
      ['s1.n', 'g1.p'],
      ['m.p2', 'r1.p'],
      ['m.n2', 'r1.n'],
      ['r1.n', 'g1b.p'],
      ['v1.p', 'r1.p'],
      ['v1.n', 'r1.n'],
      ['s2.p', 't.p1'],
      ['t.n1', 's2.n'],
      ['s2.n', 'g2.p'],
      ['t.p2', 'r2.p'],
      ['t.n2', 'r2.n'],
      ['r2.n', 'g2b.p'],
      ['v2.p', 'r2.p'],
      ['v2.n', 'r2.n'],
      ['ramp.y', 'is.i'],
      ['is.n', 'ls.p'],
      ['ls.n', 'is.p'],
      ['is.n', 'g3.p'],
      ['v3.p', 'ls.p'],
      ['v3.n', 'ls.n'],
    ],
    plots: [
      {
        label: 'Secondary voltages',
        series: ['v1.y', 'v2.y'],
        labels: ['Coupled inductors', 'Ideal transformer'],
      },
      {
        label: 'Saturating inductor voltage',
        series: ['v3.y'],
        labels: ['v = L(i) · di/dt'],
      },
    ],
    checks: [
      {
        signal: 'v1.y',
        at: 9.985,
        value: 9,
        tol: 0.1,
        why: 'M/L1 × the 10 V peak, lightly loaded',
      },
      {
        signal: 'v2.y',
        at: 9.985,
        value: 5,
        tol: 1e-3,
        why: 'the 10 V peak over the ratio 2',
      },
      {
        signal: 'v3.y',
        at: 0.01,
        value: 2,
        tol: 0.01,
        why: 'unsaturated: 2 H × 1 A/s',
      },
      {
        signal: 'v3.y',
        value: 0.5,
        tol: 0.02,
        why: 'saturated at 10 A: close to 0.5 H × 1 A/s',
      },
    ],
    about: ['mutualInductor', 'idealTransformer', 'saturatingInductor'],
  },
  {
    id: 'storage',
    title: 'Battery, supercapacitor, and a heating load',
    area: 'Electrical',
    summary:
      'A battery cell heats a temperature-dependent resistor while a power sensor measures it, and a supercapacitor charges at 1 A.',
    description:
      'The battery is one fully charged 4.2 V cell of 1 Ah. It discharges into a 4 Ω heating resistor whose resistance rises with temperature; the resistor warms a 100 J/K body, and the power sensor reads the electrical power it takes, about 4.4 W. The supercapacitor (1 F, 10 mΩ) charges at a constant 1 A, so its voltage rises 1 V per second plus the 10 mV drop across its series resistance.',
    duration: 2,
    blocks: [
      [
        'cell',
        'batteryStack',
        'Cell 4.2 V',
        [168, 232],
        { Ns: 1, Np: 1, Q: 1, OCVmax: 4.2, OCVmin: 2.5, Ri: 0.005 },
        { label: 'left' },
      ],
      ['pw', 'powerSensor', 'Power', [352, 160], {}, { label: [80, 0] }],
      [
        'heat',
        'heatingResistor',
        'Heater 4 Ω',
        [576, 232],
        { R: 4, T_ref: 293.15, alpha: 0.0039 },
        { rotation: 90, label: 'right' },
      ],
      [
        'body',
        'heatCapacitor',
        'Body 100 J/K',
        [576, 392],
        { C: 100 },
        { rotation: 90 },
      ],
      [
        'Tb',
        'temperatureSensor',
        'Body temperature',
        [784, 392],
        {},
        { label: 'right' },
      ],
      ['gb', 'ground', 'Ground', [168, 336]],
      [
        'cap',
        'supercap',
        'Supercap 1 F',
        [1296, 232],
        { C: 1, Rs: 0.01, Vnom: 2.7, V0: 0 },
        { label: 'right' },
      ],
      [
        'chg',
        'dcCurrent',
        'Charger 1 A',
        [1152, 232],
        { I: 1 },
        { rotation: 180, label: 'left' },
      ],
      [
        'vcap',
        'voltageSensor',
        'v supercap',
        [1504, 232],
        {},
        { label: 'right' },
      ],
      ['gc', 'ground', 'Ground (supercap)', [1152, 336]],
    ],
    links: [
      ['cell.p', 'pw.pc'],
      ['pw.nc', 'heat.p'],
      ['heat.n', 'cell.n'],
      ['cell.n', 'gb.p'],
      ['pw.pv', 'pw.pc'],
      ['pw.nv', 'cell.n'],
      ['heat.heatPort', 'body.port'],
      ['body.port', 'Tb.port'],
      ['chg.n', 'cap.p'],
      ['cap.n', 'chg.p'],
      ['chg.p', 'gc.p'],
      ['vcap.p', 'cap.p'],
      ['vcap.n', 'cap.n'],
    ],
    plots: [
      { label: 'Heater power', series: ['pw.power'], labels: ['P (W)'] },
      { label: 'Body temperature', series: ['Tb.T'], labels: ['T (K)'] },
      {
        label: 'Supercapacitor voltage',
        series: ['vcap.y'],
        labels: ['v (V)'],
      },
    ],
    checks: [
      {
        signal: 'pw.power',
        at: 0.001,
        value: ((4.2 * 4) / 4.005) ** 2 / 4,
        tol: 0.02,
        why: 'V²/R of a full cell through its 5 mΩ into 4 Ω',
      },
      {
        signal: 'vcap.y',
        value: 2.01,
        tol: 1e-3,
        why: '1 A · 2 s / 1 F + 1 A · 10 mΩ',
      },
      {
        signal: 'Tb.T',
        value: 293.15 + (2 * 4.4) / 100,
        tol: 0.01,
        why: '≈ 4.4 W for 2 s into 100 J/K',
      },
    ],
    about: ['batteryStack', 'supercap', 'powerSensor', 'heatingResistor'],
  },
  {
    id: 'switches',
    title: 'Switches and a breaker',
    area: 'Electrical',
    summary:
      'An ideal switch, closing and opening switches, a two-way switch, and a breaker that opens an inductive circuit.',
    description:
      'Each circuit is 10 V into a 10 Ω load, 1 A when closed. The ideal switch follows a 5 Hz pulse on its gate. The closing switch closes at 0.1 s and the opening switch opens then. The two-way switch moves the current from a 10 Ω load (1 A) to a 20 Ω load (0.5 A). The breaker opens a 10 Ω, 10 mH circuit at 0.1 s: its arc voltage rises from 30 V until it forces the current to zero.',
    duration: 0.3,
    ...merge(
      {
        blocks: [
          [
            'asrc',
            'dcSource',
            '10 V A',
            [168, 232],
            { V: 10 },
            { label: 'left' },
          ],
          ['ai', 'currentSensor', 'i A', [296, 152]],
          [
            'aload',
            'resistor',
            'Load A',
            [440, 152],
            { R: 10 },
            { label: 'above' },
          ],
          [
            'asw',
            'idealSwitch',
            'Ideal switch',
            [592, 232],
            {},
            { label: 'right' },
          ],
          [
            'actl',
            'pulse',
            'Gate 5 Hz',
            [440, 232],
            { amplitude: 1, period: 0.2, width: 0.5 },
          ],
          ['agnd', 'ground', 'Ground A', [168, 336]],
        ],
        links: [
          ['asrc.p', 'ai.p'],
          ['ai.n', 'aload.p'],
          ['aload.n', 'asw.p'],
          ['asw.n', 'asrc.n'],
          ['asrc.n', 'agnd.p'],
          ['actl.y', 'asw.gate'],
        ],
      },
      switchCell(
        'b',
        [832, 32],
        ['closingSwitch', 'Closing switch'],
        ['control', 'booleanStep', 'Close at 0.1 s', { startTime: 0.1 }],
      ),
      switchCell(
        'c',
        [128, 416],
        ['openingSwitch', 'Opening switch'],
        ['control', 'booleanStep', 'Open at 0.1 s', { startTime: 0.1 }],
      ),
      switchCell(
        'd',
        [832, 416],
        ['breaker', 'Breaker'],
        ['control', 'booleanStep', 'Trip at 0.1 s', { startTime: 0.1 }],
        ['inductor', 'L 10 mH', { L: 0.01 }],
      ),
      {
        blocks: [
          [
            'esrc',
            'dcSource',
            '10 V E',
            [168, 1000],
            { V: 10 },
            { label: 'left' },
          ],
          ['ei', 'currentSensor', 'i E', [296, 920]],
          ['esw', 'twoWaySwitch', 'Two-way switch', [440, 920]],
          [
            'ectl',
            'booleanStep',
            'Change over at 0.1 s',
            [296, 816],
            { startTime: 0.1 },
          ],
          [
            'eload1',
            'resistor',
            'Load 10 Ω',
            [592, 1000],
            { R: 10 },
            { rotation: 90, label: 'right' },
          ],
          [
            'eload2',
            'resistor',
            'Load 20 Ω',
            [752, 1000],
            { R: 20 },
            { rotation: 90, label: 'right' },
          ],
          ['egnd', 'ground', 'Ground E', [168, 1104]],
        ],
        links: [
          ['esrc.p', 'ei.p'],
          ['ei.n', 'esw.p'],
          ['esw.n1', 'eload1.p'],
          ['esw.n2', 'eload2.p'],
          ['eload1.n', 'esrc.n'],
          ['eload2.n', 'esrc.n'],
          ['esrc.n', 'egnd.p'],
          ['ectl.y', 'esw.control'],
        ],
      },
    ),
    plots: [
      {
        label: 'Switch currents',
        series: ['ai.y', 'bi.y', 'ci.y'],
        labels: ['Ideal switch', 'Closing switch', 'Opening switch'],
      },
      {
        label: 'Two-way switch and breaker',
        series: ['ei.y', 'di.y'],
        labels: ['Two-way switch', 'Breaker'],
      },
    ],
    checks: [
      { signal: 'ai.y', at: 0.05, value: 1, tol: 1e-3, why: 'gate on' },
      { signal: 'ai.y', at: 0.15, value: 0, tol: 1e-3, why: 'gate off' },
      { signal: 'bi.y', at: 0.05, value: 0, tol: 1e-3, why: 'still open' },
      { signal: 'bi.y', value: 1, tol: 1e-3, why: 'closed' },
      { signal: 'ci.y', at: 0.05, value: 1, tol: 1e-3, why: 'still closed' },
      { signal: 'ci.y', value: 0, tol: 1e-3, why: 'open' },
      {
        signal: 'di.y',
        at: 0.09,
        value: 1,
        tol: 1e-3,
        why: 'closed: 10 V / 10 Ω',
      },
      { signal: 'di.y', value: 0, tol: 1e-3, why: 'the arc has cleared' },
      {
        signal: 'ei.y',
        at: 0.05,
        value: 1,
        tol: 1e-3,
        why: 'on the 10 Ω load',
      },
      { signal: 'ei.y', value: 0.5, tol: 1e-3, why: 'changed over to 20 Ω' },
    ],
    about: [
      'idealSwitch',
      'closingSwitch',
      'openingSwitch',
      'twoWaySwitch',
      'breaker',
    ],
  },
];
