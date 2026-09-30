// SPDX-License-Identifier: Apache-2.0
/** Hand-authored switching example; never reads personal projects or agent output. */
import { writeFileSync } from 'node:fs';
import {
  library,
  type Block,
  type Project,
  type Port,
} from '../lib/gradara/model';
import { defaultBlockSize } from '../lib/gradara/block-design';
import { portPoint } from '../lib/gradara/ports';
import { simplifyPoints } from '../lib/gradara/routing';
import { materializeBranches } from '../lib/gradara/net-branches';
import { reconcileNets } from '../lib/gradara/net-registry';
import {
  groupIntoSubsystem,
  scopeView,
  syncInstances,
  writeScope,
} from '../lib/gradara/hierarchy';
import { normalizeProject } from '../lib/gradara/normalize-project';
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
const blocks: Block[] = [];
function add(
  id: string,
  kind: string,
  name: string,
  x: number,
  y: number,
  overrides: Record<string, number> = {},
  vertical = false,
) {
  // Library blocks only: every part of the example has its Help page.
  const found = library.find((d) => d.kind === kind);
  if (!found) throw new Error(`${kind} is not a library block`);
  const d = structuredClone(found);
  d.name = name;
  for (const p of d.parameters)
    if (p.id in overrides) p.value = overrides[p.id];
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
add('bridge', 'diodeBridge', 'Bridge rectifier', 500, 160, {
  RonDiode: 0.05,
  GoffDiode: 1e-8,
});
add('bulk', 'capacitor', '100 µF bus', 740, 320, { C: 0.0001 }, true);
add('bleed', 'resistor', '1 MΩ bleeder', 880, 320, { R: 1e6 }, true);
add('acref', 'resistor', '100 MΩ reference', 320, 640, { R: 1e8 }, true);
add('xfmr', 'idealTransformer', '8:1 transformer', 1240, 280, { n: 8 });
add('mag', 'inductor', '2 mH magnetizing', 1040, 320, { L: 0.002 }, true);
add('ip', 'currentSensor', 'Primary current', 1100, 560);
add('rpri', 'resistor', '0.5 Ω winding', 1260, 560, { R: 0.5 });
add('sw', 'closingSwitch', 'Primary switch', 1400, 560, {
  Ron: 0.2,
  Goff: 1e-8,
});
add('rect', 'idealDiode', 'Secondary diode', 1520, 320, {
  Ron: 0.05,
  Goff: 1e-8,
  Vknee: 0.7,
});
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
add('pwm', 'pwmSignal', '50 kHz PWM', 1040, 1000, { f: 50000 });
const pairs: string[][] = [
  ['line.y', 'ac.u'],
  ['ac.p', 'rin.p'],
  ['rin.n', 'bridge.ac_p'],
  ['ac.n', 'bridge.ac_n'],
  ['bridge.dc_p', 'bulk.p'],
  ['bridge.dc_n', 'bulk.n'],
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
  ['duty.y', 'pwm.dutyCycle'],
  ['pwm.fire', 'sw.control'],
];
// Schematic layout: rectifier columns, shared DC rails, isolated output,
// and a separate left-to-right control chain below the power stage.
const positions: Record<string, [number, number]> = {
  line: [0, 320],
  ac: [160, 320],
  rin: [320, 328],
  bridge: [520, 296],
  acref: [320, 544],
  bulk: [840, 288],
  bleed: [1000, 288],
  vbus: [840, 484],
  mag: [1320, 288],
  xfmr: [1400, 272],
  ip: [1200, 464],
  rpri: [1400, 472],
  sw: [1580, 464],
  vsw: [1760, 464],
  rect: [1600, 264],
  rout: [1800, 264],
  cout: [2008, 288],
  load: [2168, 288],
  vout: [2408, 288],
  gpri: [1080, 644],
  gsec: [2168, 544],
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
}
// Vertical parts sit between the rails: their names go beside them, clear of the rail below.
for (const block of blocks)
  if (['bulk', 'bleed', 'mag', 'cout', 'load'].includes(block.id)) {
    const chars = block.definition.name.length;
    const side = block.id === 'mag' ? -1 : 1;
    block.labelOffset = { x: side * (32 + Math.ceil(chars * 3.4)), y: -52 };
  }
// Flyback winding polarity: positive secondary rail exits above its return.
const winding = blocks.find((b) => b.id === 'xfmr')!;
winding.definition.ports.find((p) => p.id === 'n2')!.offset = 25;
winding.definition.ports.find((p) => p.id === 'p2')!.offset = 75;
winding.definition.ports.find((p) => p.id === 'p1')!.offset = 25;
winding.definition.ports.find((p) => p.id === 'n1')!.offset = 75;
let project: Project = {
  version: 2,
  exampleId: 'flyback',
  name: '480 VAC → 24 VDC flyback',
  duration: 0.3,
  revision: 0,
  blocks,
  description:
    'Hand-authored switching example: single-phase 480 V RMS / 60 Hz, 24 V at 1 A into 24 Ω. Diode bridge, 100 µF bulk, ideal 8:1 transformer plus 2 mH magnetizing inductance, Boolean-controlled primary switch, 50 kHz PWM generator, 50 ms soft start after 30 ms of bus precharge, sampled PI regulation. Finite diode and switch resistances and off conductances regularize commutation. Separate primary/secondary references; ideal magnetic coupling. Omits leakage inductance, core saturation/loss, device capacitances, clamp/snubber, EMI filter and practical isolation/control circuitry. Simulation example, not a hardware design.',
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
      detail: '60 Hz · diode bridge with finite conductances',
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
// Two subsystems, as in a real product: the power stage (circuit, sensors, and the
// PWM modulator) and the controller, which is pure signal flow and so exports to C.
const CONTROL = ['start', 'ref', 'filt', 'norm', 'pi', 'duty'];
let uuid = 0;
Object.defineProperty(globalThis.crypto, 'randomUUID', {
  value: () => `fb${(++uuid).toString(36).padStart(8, '0')}-0000`,
  configurable: true,
});
project.annotations = [];
const control = groupIntoSubsystem(project, CONTROL, 'Controller');
if (!control) throw new Error('Could not group the controller');
const power = groupIntoSubsystem(
  control.project,
  control.project.blocks
    .filter((b) => b.id !== control.instanceId)
    .map((b) => b.id),
  'Power stage',
);
if (!power) throw new Error('Could not group the power stage');
// Readable instance IDs: result keys read power.vout.y and control.duty.y.
let text = JSON.stringify(syncInstances(power.project));
for (const [from, to] of [
  [power.instanceId, 'power'],
  [control.instanceId, 'control'],
])
  text = text
    .replaceAll(`"${from}"`, `"${to}"`)
    .replaceAll(`"${from}.`, `"${to}.`);
project = JSON.parse(text) as Project;
// Port names say what crosses the boundary: the measured output voltage one way,
// the duty command the other.
for (const sub of project.subsystems ?? [])
  for (const b of sub.blocks)
    if (b.definition.boundary)
      b.definition.name =
        (b.definition.kind === 'inport') === (sub.name === 'Controller')
          ? 'Vout'
          : 'duty';
// Each subsystem port sits level with the port it feeds, a short run away.
for (const sub of project.subsystems ?? []) {
  for (const b of sub.blocks) {
    if (!b.definition.boundary) continue;
    const w = sub.wires.find((w) => w.source === b.id || w.target === b.id);
    if (!w) continue;
    const [otherId, handle] =
      w.source === b.id
        ? [w.target, w.targetHandle]
        : [w.source, w.sourceHandle];
    const other = sub.blocks.find((o) => o.id === otherId);
    const at = other && portPoint(other, handle);
    if (!at) continue;
    const size = b.size ?? defaultBlockSize(b.definition);
    const gap = 96;
    b.position = {
      x: at.side === 'left' ? at.x - gap - size.width : at.x + gap,
      y: at.y - size.height / 2,
    };
    w.waypoints = [];
  }
}
project = syncInstances(project);
const place = (id: string, x: number, y: number) => {
  const b = project.blocks.find((b) => b.id === id)!;
  b.position = { x, y };
};
// Controller → duty → power stage; the measured output returns below both.
place('control', 160, 256);
place('power', 720, 256);
project = normalizeProject({
  ...project,
  wires: project.wires.map((w) => ({ ...w, waypoints: [] })),
});
// The measured voltage returns below both names, not through them.
{
  const back = project.wires.find((w) => w.source === 'power')!;
  const from = portPoint(
    project.blocks.find((b) => b.id === 'power')!,
    back.sourceHandle,
  )!;
  const to = portPoint(
    project.blocks.find((b) => b.id === 'control')!,
    back.targetHandle,
  )!;
  const below =
    Math.max(
      ...project.blocks.map((b) => b.position.y + (b.size?.height ?? 0)),
    ) + 64;
  back.waypoints = [
    { x: from.x + 32, y: from.y },
    { x: from.x + 32, y: below },
    { x: to.x - 32, y: below },
    { x: to.x - 32, y: to.y },
  ];
}
// Route the wires to the moved subsystem ports inside each sheet.
for (const id of ['power', 'control'])
  project = writeScope(
    project,
    [id],
    normalizeProject(scopeView(project, [id])),
  );
project.annotations = [
  {
    x: 160,
    y: 128,
    text: 'CONTROLLER',
    detail: 'Soft start, sampled PI, 0–18 % duty. Exports to C.',
  },
  {
    x: 720,
    y: 128,
    text: 'POWER STAGE',
    detail: '480 V RMS to 24 V at 1 A through an 8:1 flyback.',
  },
];
project.plots = project.plots?.map((plot) => ({
  ...plot,
  series: plot.series.map((key) =>
    key.startsWith('duty.') ? `control.${key}` : `power.${key}`,
  ),
}));
writeFileSync(
  'models/examples/flyback.json',
  JSON.stringify(project, null, 2) + '\n',
);
