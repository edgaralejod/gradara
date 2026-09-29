import type { ExampleSpec } from './types';

type Blocks = ExampleSpec['blocks'];
type Links = ExampleSpec['links'];

/**
 * A source across a vertical load with a voltmeter beside it and ground below, drawn
 * in a 320 × 256 cell whose top-left corner is (x, y).
 */
function loop(
  id: string,
  [x, y]: [number, number],
  source: [string, string, Record<string, number>?],
  load: [string, string, Record<string, number>?],
  /** A signal block driving the source's input, drawn to its left. */
  drive?: [string, string, string, Record<string, number>?],
): { blocks: Blocks; links: Links } {
  const [kind, name, params] = source;
  const [loadKind, loadName, loadParams] = load;
  const driver: { blocks: Blocks; links: Links } = drive
    ? {
        blocks: [
          [`${id}sig`, drive[1], drive[2], [x - 176, y + 120], drive[3] ?? {}],
        ],
        links: [[`${id}sig.y`, `${id}src.${drive[0]}`]],
      }
    : { blocks: [], links: [] };
  return {
    blocks: [
      ...driver.blocks,
      [
        `${id}src`,
        kind,
        name,
        [x + 40, y + 96],
        params ?? {},
        drive
          ? { label: 'left', ports: { [drive[0]]: ['left', 80] } }
          : { label: 'left' },
      ],
      [
        `${id}load`,
        loadKind,
        loadName,
        [x + 152, y + 96],
        loadParams ?? {},
        { rotation: 90, label: 'right' },
      ],
      [
        `${id}v`,
        'voltageSensor',
        `v ${id.toUpperCase()}`,
        [x + 312, y + 96],
        {},
        { label: 'right' },
      ],
      [`${id}gnd`, 'ground', `Ground ${id.toUpperCase()}`, [x + 40, y + 200]],
    ],
    links: [
      ...driver.links,
      [`${id}src.p`, `${id}load.p`],
      [`${id}load.n`, `${id}src.n`],
      [`${id}src.n`, `${id}gnd.p`],
      [`${id}v.p`, `${id}load.p`],
      [`${id}v.n`, `${id}load.n`],
    ],
  };
}

const merge = (...parts: { blocks: Blocks; links: Links }[]) => ({
  blocks: parts.flatMap((p) => p.blocks),
  links: parts.flatMap((p) => p.links),
});

const sources = merge(
  loop(
    'a',
    [0, 64],
    ['dcSource', 'DC 12 V', { V: 12 }],
    ['resistor', 'Load A 12 Ω', { R: 12 }],
  ),
  loop(
    'b',
    [448, 64],
    ['dcCurrent', 'DC 1 A', { I: 1 }],
    ['resistor', 'Load B 10 Ω', { R: 10 }],
  ),
  loop(
    'c',
    [896, 64],
    ['sineVoltage', 'Sine 10 V', { V: 10, f: 50 }],
    ['resistor', 'Load C 10 Ω', { R: 10 }],
  ),
  loop(
    'd',
    [1344, 64],
    ['sineCurrent', 'Sine 1 A', { I: 1, f: 50 }],
    ['resistor', 'Load D 10 Ω', { R: 10 }],
  ),
  loop(
    'e',
    [0, 384],
    ['rampVoltage', 'Ramp 10 V', { V: 10, duration: 0.02, startTime: 0.01 }],
    ['resistor', 'Load E 10 Ω', { R: 10 }],
  ),
  loop(
    'f',
    [448, 384],
    ['pulseVoltage', 'Pulse 5 V', { V: 5, width: 50, period: 0.01 }],
    ['resistor', 'Load F 10 Ω', { R: 10 }],
  ),
  loop(
    'g',
    [256, 704],
    ['signalVoltage', 'Signal voltage'],
    ['resistor', 'Load G 10 Ω', { R: 10 }],
    ['v', 'sine', '3 sin(2π·50t)', { amplitude: 3, frequency: 50 }],
  ),
  loop(
    'h',
    [1088, 704],
    ['signalCurrent', 'Signal current'],
    ['resistor', 'Load H 10 Ω', { R: 10 }],
    ['i', 'constant', '0.5', { value: 0.5 }],
  ),
);

export const electrical: ExampleSpec[] = [
  {
    id: 'rc-rl',
    title: 'RC and RL transients',
    area: 'Electrical',
    summary:
      'A 10 V step charges a capacitor through a resistor, and another builds current in an inductor through a conductor.',
    description:
      'Two 10 V steps start at 0 s. The RC branch (1 kΩ, 100 µF) has a time constant of 0.1 s: the capacitor reaches 63 % of 10 V at 0.1 s and is essentially full after 0.5 s. The RL branch (a 0.1 S conductor, which is 10 Ω, and a 1 H inductor) has the same time constant, so its current rises to 63 % of 1 A at 0.1 s.',
    duration: 0.5,
    blocks: [
      [
        'source',
        'stepVoltage',
        'Step 10 V',
        [80, 240],
        { V: 10, startTime: 0 },
        { label: 'left' },
      ],
      ['r', 'resistor', 'R 1 kΩ', [200, 160], { R: 1000 }],
      [
        'c',
        'capacitor',
        'C 100 µF',
        [320, 240],
        { C: 1e-4 },
        { rotation: 90, label: 'left' },
      ],
      [
        'vc',
        'voltageSensor',
        'Capacitor voltage',
        [432, 240],
        {},
        { label: 'right' },
      ],
      ['ground', 'ground', 'Ground', [80, 344]],
      [
        'source2',
        'stepVoltage',
        'Step 10 V (RL)',
        [776, 240],
        { V: 10, startTime: 0 },
        { label: 'left' },
      ],
      ['g', 'conductor', 'G 0.1 S', [896, 160], { G: 0.1 }],
      ['il', 'currentSensor', 'Inductor current', [1032, 160]],
      [
        'l',
        'inductor',
        'L 1 H',
        [1152, 240],
        { L: 1 },
        { rotation: 90, label: 'right' },
      ],
      ['ground2', 'ground', 'Ground (RL)', [776, 344]],
    ],
    links: [
      ['source.p', 'r.p'],
      ['r.n', 'c.p'],
      ['c.n', 'source.n'],
      ['source.n', 'ground.p'],
      ['vc.p', 'c.p'],
      ['vc.n', 'c.n'],
      ['source2.p', 'g.p'],
      ['g.n', 'il.p'],
      ['il.n', 'l.p'],
      ['l.n', 'source2.n'],
      ['source2.n', 'ground2.p'],
    ],
    plots: [
      { label: 'Capacitor voltage', series: ['vc.y'], labels: ['v_C'] },
      { label: 'Inductor current', series: ['il.y'], labels: ['i_L'] },
    ],
    checks: [
      {
        signal: 'vc.y',
        at: 0.1,
        value: 10 * (1 - Math.exp(-1)),
        tol: 0.05,
        why: '10 V · (1 − e⁻¹) at one RC',
      },
      {
        signal: 'vc.y',
        value: 10 * (1 - Math.exp(-5)),
        tol: 0.05,
        why: 'five time constants',
      },
      {
        signal: 'il.y',
        at: 0.1,
        value: 1 - Math.exp(-1),
        tol: 0.01,
        why: '1 A · (1 − e⁻¹) at one L/R',
      },
      {
        signal: 'il.y',
        value: 1 - Math.exp(-5),
        tol: 0.01,
        why: 'five time constants',
      },
    ],
    about: [
      'resistor',
      'capacitor',
      'inductor',
      'conductor',
      'stepVoltage',
      'voltageSensor',
      'currentSensor',
      'ground',
    ],
  },
  {
    id: 'electrical-sources',
    title: 'Electrical sources',
    area: 'Electrical',
    summary:
      'Every voltage and current source driving a resistor, each with a voltmeter across it.',
    description:
      'Voltage sources set the voltage across their resistor; current sources push their current through it, so the voltmeter reads I · R. A current source drives its current out of its n pin, so with the resistor on p the voltage reads negative. The signal-driven sources follow their input: a 3 V, 50 Hz sine and a constant 0.5 A.',
    duration: 0.04,
    blocks: sources.blocks,
    links: sources.links,
    plots: [
      {
        label: 'Constant sources',
        series: ['av.y', 'bv.y', 'hv.y'],
        labels: ['DC 12 V', 'DC 1 A', 'Signal current 0.5 A'],
      },
      {
        label: 'Waveforms',
        series: ['cv.y', 'dv.y', 'ev.y', 'fv.y', 'gv.y'],
        labels: [
          'Sine voltage',
          'Sine current',
          'Ramp',
          'Pulse',
          'Signal voltage',
        ],
      },
    ],
    checks: [
      { signal: 'av.y', value: 12, tol: 1e-6, why: 'the source voltage' },
      {
        signal: 'bv.y',
        value: -10,
        tol: 1e-6,
        why: '−I · R: the current leaves through n',
      },
      { signal: 'cv.y', at: 0.005, value: 10, tol: 1e-3, why: 'the sine peak' },
      {
        signal: 'dv.y',
        at: 0.005,
        value: -10,
        tol: 1e-3,
        why: '−I · R at the current peak',
      },
      {
        signal: 'ev.y',
        at: 0.02,
        value: 5,
        tol: 1e-3,
        why: 'halfway up the ramp',
      },
      { signal: 'ev.y', value: 10, tol: 1e-6, why: 'the ramp has ended' },
      { signal: 'fv.y', at: 0.002, value: 5, tol: 1e-6, why: 'pulse on' },
      { signal: 'fv.y', at: 0.007, value: 0, tol: 1e-6, why: 'pulse off' },
      {
        signal: 'gv.y',
        at: 0.005,
        value: 3,
        tol: 1e-3,
        why: 'follows the 3 V sine',
      },
      { signal: 'hv.y', value: -5, tol: 1e-6, why: '−0.5 A · 10 Ω' },
    ],
    about: [
      'dcSource',
      'dcCurrent',
      'sineVoltage',
      'sineCurrent',
      'rampVoltage',
      'pulseVoltage',
      'signalVoltage',
      'signalCurrent',
    ],
  },
];
