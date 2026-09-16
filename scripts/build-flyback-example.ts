// SPDX-License-Identifier: Apache-2.0
/** Hand-authored switching example; never reads personal projects or agent output. */
import { writeFileSync } from 'node:fs';
import {
  library,
  type Definition,
  type Block,
  type Project,
  type Port,
} from '../lib/gradara/model';
import { defaultBlockSize } from '../lib/gradara/block-design';
import { portPoint } from '../lib/gradara/ports';
import { simplifyPoints } from '../lib/gradara/routing';
import { materializeBranches } from '../lib/gradara/net-branches';
import { reconcileNets } from '../lib/gradara/net-registry';
const pin = (id: string, side: Port['side']): Port => ({
  id,
  name: id,
  domain: 'electrical',
  direction: 'physical',
  side,
});
const param = (id: string, value: number, unit = '') => ({
  id,
  name: id,
  value,
  unit,
});
const transformer: Definition = {
  kind: 'flybackTransformer',
  name: '8:1 transformer',
  domain: 'electrical',
  symbol: '8:1',
  generated: true,
  description:
    'Ideal lossless 8:1 transformer. The separate parallel magnetizing inductor stores flyback energy. No leakage inductance or saturation.',
  ports: [
    pin('p1', 'left'),
    pin('n1', 'left'),
    pin('p2', 'right'),
    pin('n2', 'right'),
  ],
  parameters: [param('turnsRatio', 8)],
  equations:
    'p1.v-n1.v = turnsRatio*(p2.v-n2.v); p1.i+n1.i=0; p2.i+n2.i=0; turnsRatio*p1.i+p2.i=0;',
};
const pwm: Definition = {
  kind: 'flybackPWM',
  name: '50 kHz PWM',
  domain: 'signal',
  symbol: 'PWM',
  generated: true,
  description:
    'Sample duty at each cycle; explicit time events resolve falling edges. Disable switching until 30 ms for bus precharge.',
  ports: [
    {
      id: 'duty',
      name: 'duty',
      domain: 'signal',
      direction: 'input',
      side: 'left',
    },
    {
      id: 'gate',
      name: 'gate',
      domain: 'signal',
      direction: 'output',
      side: 'right',
    },
  ],
  parameters: [param('frequency', 50000, 'Hz'), param('enableTime', 0.03, 's')],
  declarations:
    'discrete Real sampledDuty(start=0, fixed=true); discrete Real cycleStart(start=0, fixed=true);',
  equations:
    'when {initial(), sample(0, 1/frequency)} then sampledDuty=min(1,max(0,duty)); cycleStart=time; end when; gate=if time < enableTime then 0 else if sampledDuty <= 0 then 0 else if sampledDuty >= 1 then 1 else if time < cycleStart+sampledDuty/frequency then 1 else 0;',
};
const blocks: Block[] = [];
function add(
  id: string,
  kind: string | Definition,
  name: string,
  x: number,
  y: number,
  overrides: Record<string, number> = {},
  vertical = false,
) {
  const d = structuredClone(
    typeof kind === 'string' ? library.find((d) => d.kind === kind)! : kind,
  );
  d.name = name;
  for (const p of d.parameters)
    if (p.id in overrides) p.value = overrides[p.id];
  if (d.kind === 'diode')
    Object.assign(d, {
      generated: true,
      description:
        'Piecewise-linear diode: 0.7 V forward drop, 0.05 ohm conduction resistance, 10 nS reverse conductance. Finite slopes make commutation well posed.',
      declarations: 'Real v;',
      parameters: [
        param('Vf', 0.7, 'V'),
        param('Ron', 0.05, 'Ohm'),
        param('Goff', 1e-8, 'S'),
      ],
      equations:
        'v=p.v-n.v; p.i=if v > Vf then (v-Vf)/Ron else Goff*(v-Vf); p.i+n.i=0;',
    });
  if (d.kind === 'idealSwitch')
    Object.assign(d, {
      kind: 'finiteSwitch',
      generated: true,
      symbol: 'SW',
      description:
        'Gate-controlled switch: 0.2 ohm on resistance and 10 nS off conductance. No capacitance, switching loss, body diode or avalanche model.',
      parameters: [param('Ron', 0.2, 'Ohm'), param('Goff', 1e-8, 'S')],
      equations:
        'p.i=if gate > 0.5 then (p.v-n.v)/Ron else Goff*(p.v-n.v); p.i+n.i=0;',
    });
  if (vertical)
    for (const p of d.ports)
      if (p.direction === 'physical') p.side = p.id === 'p' ? 'top' : 'bottom';
  const block = {
    id,
    definition: d,
    position: { x, y },
    size: defaultBlockSize(d),
  };
  blocks.push(block);
  return block;
}
add('line', 'sine', '480 V RMS · 60 Hz', 0, 160, {
  amplitude: 480 * Math.SQRT2,
  frequency: 60,
});
add('ac', 'voltage', 'AC source', 160, 160);
add('rin', 'resistor', '10 Ω inrush', 320, 160, { R: 10 });
add('d1', 'diode', 'Bridge A+', 500, 160);
add('d2', 'diode', 'Bridge B+', 500, 320);
add('d3', 'diode', 'Bridge A−', 500, 480);
add('d4', 'diode', 'Bridge B−', 500, 640);
add('bulk', 'capacitor', '100 µF bus', 740, 320, { C: 0.0001 }, true);
add('bleed', 'resistor', '1 MΩ bleeder', 880, 320, { R: 1e6 }, true);
add('acref', 'resistor', '100 MΩ reference', 320, 640, { R: 1e8 }, true);
add('xfmr', transformer, '8:1 transformer', 1240, 280);
add('mag', 'inductor', '2 mH magnetizing', 1040, 320, { L: 0.002 }, true);
add('ip', 'currentSensor', 'Primary current', 1100, 560);
add('rpri', 'resistor', '0.5 Ω winding', 1260, 560, { R: 0.5 });
add('sw', 'idealSwitch', 'Primary switch', 1400, 560);
add('rect', 'diode', 'Secondary diode', 1520, 320);
add('rout', 'resistor', '50 mΩ ESR', 1660, 320, { R: 0.05 });
add('cout', 'capacitor', '1000 µF output', 1820, 480, { C: 0.001 }, true);
add('load', 'resistor', '24 Ω · 24 W load', 1960, 480, { R: 24 }, true);
add('gpri', 'ground', 'Primary reference', 900, 740);
add('gsec', 'ground', 'Secondary reference', 1900, 740);
add('vbus', 'voltageSensor', 'DC bus voltage', 740, 560);
add('vsw', 'voltageSensor', 'Switch voltage', 1580, 560);
add('vout', 'voltageSensor', 'Output voltage', 2100, 480);
add('start', 'ramp', 'Soft start', 0, 1000, { slope: 20, startTime: 0.03 });
add('ref', 'saturation', '0–1 reference', 180, 1000, { lower: 0, upper: 1 });
add('filt', 'filter', '1 ms feedback filter', 180, 1160, { tau: 0.001 });
add('norm', 'gain', '1/24 feedback', 360, 1160, { k: 1 / 24 });
add('pi', 'pi', 'Voltage PI', 560, 1000, {
  kp: 0.03,
  ki: 4,
  limit: 0.18,
  samplePeriod: 0.0001,
});
add('duty', 'saturation', '0–18% duty', 800, 1000, { lower: 0, upper: 0.18 });
add('pwm', pwm, '50 kHz PWM', 1040, 1000);
const pairs: string[][] = [
  ['line.y', 'ac.u'],
  ['ac.p', 'rin.p'],
  ['rin.n', 'd1.p'],
  ['rin.n', 'd3.n'],
  ['ac.n', 'd2.p'],
  ['ac.n', 'd4.n'],
  ['d1.n', 'd2.n'],
  ['d1.n', 'bulk.p'],
  ['d3.p', 'd4.p'],
  ['d3.p', 'bulk.n'],
  ['bulk.n', 'gpri.p'],
  ['bulk.p', 'bleed.p'],
  ['bulk.n', 'bleed.n'],
  ['ac.n', 'acref.p'],
  ['acref.n', 'gpri.p'],
  ['bulk.p', 'xfmr.p1'],
  ['xfmr.p1', 'mag.p'],
  ['xfmr.n1', 'mag.n'],
  ['xfmr.n1', 'ip.p'],
  ['ip.n', 'rpri.p'],
  ['rpri.n', 'sw.p'],
  ['sw.n', 'gpri.p'],
  ['xfmr.n2', 'rect.p'],
  ['rect.n', 'rout.p'],
  ['rout.n', 'cout.p'],
  ['cout.p', 'load.p'],
  ['cout.n', 'load.n'],
  ['xfmr.p2', 'cout.n'],
  ['cout.n', 'gsec.p'],
  ['bulk.p', 'vbus.p'],
  ['bulk.n', 'vbus.n'],
  ['sw.p', 'vsw.p'],
  ['sw.n', 'vsw.n'],
  ['cout.p', 'vout.p'],
  ['cout.n', 'vout.n'],
  ['vout.y', 'filt.u'],
  ['filt.y', 'norm.u'],
  ['norm.y', 'pi.measured'],
  ['start.y', 'ref.u'],
  ['ref.y', 'pi.reference'],
  ['pi.y', 'duty.u'],
  ['duty.y', 'pwm.duty'],
  ['pwm.gate', 'sw.gate'],
];
// Schematic layout: rectifier columns, shared DC rails, isolated output,
// and a separate left-to-right control chain below the power stage.
const positions: Record<string, [number, number]> = {
  line: [0, 320],
  ac: [160, 320],
  rin: [320, 328],
  d1: [480, 184],
  d2: [640, 184],
  d3: [480, 424],
  d4: [640, 424],
  acref: [320, 544],
  bulk: [840, 304],
  bleed: [1000, 304],
  vbus: [840, 484],
  mag: [1180, 304],
  xfmr: [1400, 240],
  ip: [1200, 464],
  rpri: [1400, 472],
  sw: [1580, 464],
  vsw: [1760, 464],
  rect: [1660, 248],
  rout: [1840, 248],
  cout: [2020, 304],
  load: [2200, 304],
  vout: [2380, 304],
  gpri: [1080, 644],
  gsec: [2200, 544],
  start: [440, 824],
  ref: [640, 824],
  pi: [1060, 808],
  duty: [1300, 824],
  pwm: [1500, 824],
  filt: [640, 984],
  norm: [840, 984],
};
for (const block of blocks) {
  const [x, y] = positions[block.id];
  block.position = { x, y };
  if (['d1', 'd2', 'd3', 'd4'].includes(block.id)) {
    block.rotation = 270;
    block.size = { width: 48, height: 80 };
  }
}
// Flyback winding polarity: positive secondary rail exits above its return.
const winding = blocks.find((b) => b.id === 'xfmr')!;
winding.definition.ports.find((p) => p.id === 'n2')!.offset = 25;
winding.definition.ports.find((p) => p.id === 'p2')!.offset = 75;
winding.definition.ports.find((p) => p.id === 'p1')!.offset = 25;
winding.definition.ports.find((p) => p.id === 'n1')!.offset = 75;
let project: Project = {
  version: 1,
  exampleId: 'flyback',
  name: '480 VAC → 24 VDC flyback',
  duration: 0.3,
  revision: 0,
  blocks,
  description:
    'Hand-authored switching example: single-phase 480 V RMS / 60 Hz, 24 V at 1 A into 24 Ω. Bridge rectifier, 100 µF bulk, 8:1 transformer plus 2 mH magnetizing inductance, 50 kHz PWM, 30 ms enable delay, 50 ms soft start, sampled PI regulation. Finite diode/switch resistances and off conductances regularize commutation. Separate primary/secondary references; ideal magnetic coupling. Omits leakage inductance, core saturation/loss, device capacitances, clamp/snubber, EMI filter and practical isolation/control circuitry. Simulation example, not a hardware design.',
  wires: pairs.map(([a, b], i) => {
    const [source, sourceHandle] = a.split('.');
    const [target, targetHandle] = b.split('.');
    return { id: 'w' + i, source, sourceHandle, target, targetHandle };
  }),
  junctions: [],
  annotations: [
    {
      x: 0,
      y: 80,
      text: 'RECTIFY · 480 V RMS',
      detail: '60 Hz · finite-conductance bridge',
    },
    {
      x: 840,
      y: 80,
      text: 'DC LINK',
      detail: '100 µF · approximately 670 V DC',
    },
    {
      x: 1180,
      y: 80,
      text: 'FLYBACK ENERGY STORAGE',
      detail: '8:1 ratio · 2 mH primary magnetizing inductance',
    },
    {
      x: 2020,
      y: 80,
      text: '24 V · 1 A OUTPUT',
      detail: 'Isolated secondary · 24 Ω load',
    },
    {
      x: 440,
      y: 740,
      text: 'VOLTAGE CONTROL',
      detail: '30 ms bus precharge · 50 ms soft start · 50 kHz PWM',
    },
  ],
  plots: [
    {
      id: 'output',
      label: 'Output voltage',
      series: ['vout.y'],
      labels: ['Output voltage'],
    },
    {
      id: 'bus',
      label: 'Rectified DC bus',
      series: ['vbus.y'],
      labels: ['DC bus voltage'],
    },
    {
      id: 'primary',
      label: 'Primary current',
      series: ['ip.y'],
      labels: ['Primary current'],
    },
    {
      id: 'switch',
      label: 'Switch voltage',
      series: ['vsw.y'],
      labels: ['Switch voltage'],
    },
    {
      id: 'duty',
      label: 'PWM duty',
      series: ['duty.y'],
      labels: ['Duty command'],
    },
  ],
};
// Offline template routing only: an orthogonal visibility grid avoids block bodies.
// Saved bends remain ordinary editable wire geometry, never execution semantics.
const rectangles = blocks.map((b) => ({
  x: b.position.x,
  y: b.position.y,
  w: b.size!.width,
  h: b.size!.height,
}));
for (const wire of project.wires) {
  const source = blocks.find((b) => b.id === wire.source)!,
    target = blocks.find((b) => b.id === wire.target)!;
  const a = portPoint(source, wire.sourceHandle)!,
    b = portPoint(target, wire.targetHandle)!;
  const stub = (p: typeof a) => ({
    x: p.x + (p.side === 'right' ? 24 : p.side === 'left' ? -24 : 0),
    y: p.y + (p.side === 'bottom' ? 24 : p.side === 'top' ? -24 : 0),
  });
  const start = stub(a),
    end = stub(b);
  const xs = [
    ...new Set([
      start.x,
      end.x,
      ...rectangles.flatMap((r) => [r.x - 28, r.x + r.w + 28]),
    ]),
  ].sort((a, b) => a - b);
  const ys = [
    ...new Set([
      start.y,
      end.y,
      ...rectangles.flatMap((r) => [r.y - 28, r.y + r.h + 28]),
    ]),
  ].sort((a, b) => a - b);
  const clear = (x1: number, y1: number, x2: number, y2: number) =>
    !rectangles.some((r) =>
      x1 === x2
        ? x1 > r.x - 3 &&
          x1 < r.x + r.w + 3 &&
          Math.max(y1, y2) > r.y - 3 &&
          Math.min(y1, y2) < r.y + r.h + 3
        : y1 > r.y - 3 &&
          y1 < r.y + r.h + 3 &&
          Math.max(x1, x2) > r.x - 3 &&
          Math.min(x1, x2) < r.x + r.w + 3,
    );
  type State = {
    x: number;
    y: number;
    dir: number;
    cost: number;
    estimate: number;
    key: string;
    previous?: State;
  };
  const initial: State = {
    x: xs.indexOf(start.x),
    y: ys.indexOf(start.y),
    dir: 0,
    cost: 0,
    estimate: 0,
    key: 'start',
  };
  const queue = [initial],
    best = new Map<string, number>();
  let found: State | undefined;
  while (queue.length) {
    queue.sort((a, b) => b.estimate - a.estimate);
    const current = queue.pop()!;
    if (xs[current.x] === end.x && ys[current.y] === end.y) {
      found = current;
      break;
    }
    for (const [dx, dy, dir] of [
      [1, 0, 1],
      [-1, 0, 1],
      [0, 1, 2],
      [0, -1, 2],
    ]) {
      const x = current.x + dx,
        y = current.y + dy;
      if (
        x < 0 ||
        x >= xs.length ||
        y < 0 ||
        y >= ys.length ||
        !clear(xs[current.x], ys[current.y], xs[x], ys[y])
      )
        continue;
      const cost =
        current.cost +
        Math.abs(xs[x] - xs[current.x]) +
        Math.abs(ys[y] - ys[current.y]) +
        (current.dir && current.dir !== dir ? 40 : 0);
      const key = `${x},${y},${dir}`;
      if ((best.get(key) ?? Infinity) <= cost) continue;
      best.set(key, cost);
      queue.push({
        x,
        y,
        dir,
        cost,
        key,
        estimate: cost + Math.abs(xs[x] - end.x) + Math.abs(ys[y] - end.y),
        previous: current,
      });
    }
  }
  if (!found) throw new Error(`Cannot route ${wire.id}`);
  const points = [];
  for (let state: State | undefined = found; state; state = state.previous)
    points.unshift({ x: xs[state.x], y: ys[state.y] });
  wire.waypoints = simplifyPoints([a, ...points, b]).slice(1, -1);
}
project = reconcileNets(materializeBranches(project));
// Keep curated geometry IDs reproducible across builds.
const junctionIds = new Map(
  (project.junctions ?? []).map((j, i) => [j.id, `flyback_j${i}`]),
);
project.junctions = project.junctions?.map((j) => ({
  ...j,
  id: junctionIds.get(j.id)!,
}));
project.wires = project.wires.map((w, i) => ({
  ...w,
  id: `w${i}`,
  source: junctionIds.get(w.source) ?? w.source,
  target: junctionIds.get(w.target) ?? w.target,
}));
project = reconcileNets({ ...project, nets: undefined });
for (const [index, net] of (project.nets ?? []).entries()) {
  net.id = `net_flyback_${index}`;
  net.hidden = true;
}
writeFileSync(
  'models/examples/flyback.json',
  JSON.stringify(project, null, 2) + '\n',
);
