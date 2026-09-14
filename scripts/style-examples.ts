/** Curated template geometry only. Never run against projects/models or user documents. */
import { readFileSync, writeFileSync } from 'node:fs';
import { library, type Project } from '../lib/gradara/model';
import { defaultBlockSize } from '../lib/gradara/block-design';
import { portPoint } from '../lib/gradara/ports';
import { reconcileNets } from '../lib/gradara/net-registry';
import { nearestLabelAnchor } from '../lib/gradara/net-label';

function prepare(name: string) {
  const p: Project = JSON.parse(
    readFileSync(`models/examples/${name}.json`, 'utf8'),
  );
  for (const b of p.blocks) {
    const canonical = library.find((d) => d.kind === b.definition.kind)!;
    b.definition.symbol = canonical.symbol;
    for (const port of b.definition.ports) {
      const original = canonical.ports.find((p) => p.id === port.id);
      if (original) port.name = original.name;
    }
    delete b.labelOffset;
  }
  return p;
}
function helpers(p: Project) {
  const b = (id: string) => p.blocks.find((b) => b.id === id)!;
  const at = (id: string, x: number, y: number, above = false) => {
    const block = b(id);
    block.size = defaultBlockSize(block.definition);
    block.position = { x, y };
    if (above) block.labelOffset = { x: 0, y: -block.size.height - 36 };
    return block;
  };
  const side = (
    id: string,
    port: string,
    side: 'left' | 'right' | 'top' | 'bottom',
    offset?: number,
  ) => {
    const p = b(id).definition.ports.find((p) => p.id === port)!;
    p.side = side;
    if (offset === undefined) delete p.offset;
    else p.offset = offset;
  };
  const route = (id: string, points: number[][] = []) => {
    const w = p.wires.find((w) => w.id === id)!;
    w.waypoints = points.map(([x, y]) => ({ x, y }));
    delete w.junctions;
  };
  return { b, at, side, route };
}
function finish(p: Project, name: string) {
  p = reconcileNets(p);
  for (const [i, net] of (p.nets ?? []).entries()) {
    net.id = `net_${name}_${i}`;
    net.hidden = true;
    delete net.name;
    delete net.label;
  }
  return p;
}
function save(p: Project, name: string) {
  writeFileSync(
    `models/examples/${name}.json`,
    JSON.stringify(p, null, 2) + '\n',
  );
}

let dc = prepare('dc');
{
  const { b, at, side, route } = helpers(dc);
  side('controller', 'measured', 'bottom');
  at('reference', 40, 192);
  at('controller', 240, 176, true);
  at('drive', 472, 176, true);
  at('motor', 704, 176, true);
  // Separate the negative electrical terminal and the mechanical shaft.
  side('motor', 'n', 'bottom', 25);
  side('motor', 'flange', 'bottom', 75);
  at('load', 736, 416);
  at('sensor', 240, 416);
  at('ground', 584, 336);
  dc.junctions = [
    { id: 'dc_return', domain: 'electrical', position: { x: 604, y: 320 } },
  ];
  dc.wires = dc.wires.filter((w) => w.id !== 'dc_ground');
  dc.wires.find((w) => w.id === 'wire3')!.target = 'dc_return';
  dc.wires.find((w) => w.id === 'wire3')!.targetHandle = 'node';
  dc.wires.find((w) => w.id === 'wire4')!.target = 'dc_return';
  dc.wires.find((w) => w.id === 'wire4')!.targetHandle = 'node';
  dc.wires.push({
    id: 'dc_ground',
    source: 'dc_return',
    sourceHandle: 'node',
    target: 'ground',
    targetHandle: 'p',
  });
  for (const w of dc.wires) route(w.id);
  route('wire3', [[536, 320]]);
  route('wire4', [[736, 320]]);
  route('wire7', [
    [176, 464],
    [176, 344],
    [304, 344],
  ]);
  dc.annotations = [
    {
      x: 40,
      y: 64,
      text: '01  SPEED CONTROL',
      detail: '100 rad/s reference · bounded PI',
    },
    {
      x: 472,
      y: 64,
      text: '02  ELECTRICAL DRIVE',
      detail: '24 V drive · armature dynamics',
    },
    {
      x: 240,
      y: 552,
      text: '03  MECHANICAL LOAD',
      detail: 'Shaft inertia · damping · measured speed',
    },
  ];
  dc.plots = [
    {
      id: 'speed',
      label: 'Speed',
      series: ['load.w', 'reference.y'],
      labels: ['Rotor speed', 'Speed command'],
    },
    {
      id: 'voltage',
      label: 'Control voltage',
      series: ['controller.y'],
      labels: ['Control voltage'],
    },
    {
      id: 'current',
      label: 'Armature current',
      series: ['motor.i'],
      labels: ['Armature current'],
    },
  ];
  dc = finish(dc, 'dc');
  const feedback = dc.nets!.find((n) => n.wireIds.includes('wire7'))!;
  feedback.name = 'ω measured';
  feedback.hidden = false;
  feedback.label = nearestLabelAnchor(dc, feedback, { x: 212, y: 334 });
  // The visual port changes must leave the actual source/plant/controller intact.
  if (portPoint(b('motor'), 'flange')!.x !== portPoint(b('load'), 'a')!.x)
    throw new Error('Shaft alignment');
  save(dc, 'dc');
}
let foc = prepare('foc');
{
  const { b, at, side, route } = helpers(foc);
  side('inverse', 'vq', 'left', 25);
  side('inverse', 'vd', 'left', 75);
  at('reference', 0, 128);
  at('units', 128, 128);
  at('speedError', 256, 140, true);
  at('speedKp', 368, 128);
  at('speedKi', 368, 264);
  at('speedIntegral', 496, 264);
  at('speedSum', 512, 140, true);
  at('iqReference', 624, 128);
  at('qError', 800, 140, true);
  at('qPI', 912, 128);
  at('dReference', 624, 272);
  at('dError', 800, 284, true);
  at('dPI', 912, 272);
  at('inverse', 1104, 136, true);
  at('inverter', 1296, 136);
  at('motor', 1504, 136, true);
  b('motor').definition.name = 'PMSM';
  b('load').definition.name = 'Mechanical load';
  at('load', 1760, 136);
  at('clarke', 1336, 432);
  at('park', 1104, 432, true);
  foc.junctions = [
    { id: 'foc_error', domain: 'signal', position: { x: 328, y: 160 } },
    { id: 'foc_angle', domain: 'signal', position: { x: 1264, y: 568 } },
  ];
  foc.wires = foc.wires.filter(
    (w) => !['foc_kp', 'foc_angle_branch'].includes(w.id),
  );
  for (const w of foc.wires) route(w.id);
  const proportional = foc.wires.find((w) => w.id === 'w_2')!;
  proportional.target = 'foc_error';
  proportional.targetHandle = 'node';
  const integral = foc.wires.find((w) => w.id === 'w_3')!;
  integral.source = 'foc_error';
  integral.sourceHandle = 'node';
  foc.wires.push({
    id: 'foc_kp',
    source: 'foc_error',
    sourceHandle: 'node',
    target: 'speedKp',
    targetHandle: 'u',
    waypoints: [],
  });
  route('w_3', [[328, 296]]);
  route('w_6', [
    [608, 296],
    [608, 224],
    [532, 224],
  ]);
  route('w_13', [
    [1040, 304],
    [1040, 208],
  ]);
  route('w_21', [[1536, 456]]);
  route('w_22', [[1568, 480]]);
  route('w_23', [[1600, 504]]);
  route('w_26', [[820, 464]]);
  route('w_27', [
    [760, 496],
    [760, 224],
    [820, 224],
  ]);
  const angle = foc.wires.find((w) => w.id === 'w_28')!;
  angle.target = 'foc_angle';
  angle.targetHandle = 'node';
  route('w_28', [[1632, 568]]);
  const anglePark = foc.wires.find((w) => w.id === 'w_29')!;
  anglePark.source = 'foc_angle';
  anglePark.sourceHandle = 'node';
  route('w_29', [[1168, 568]]);
  foc.wires.push({
    id: 'foc_angle_branch',
    source: 'foc_angle',
    sourceHandle: 'node',
    target: 'inverse',
    targetHandle: 'theta',
    waypoints: [
      { x: 1264, y: 328 },
      { x: 1168, y: 328 },
    ],
  });
  route('w_30', [
    [1544, 72],
    [1960, 72],
    [1960, 640],
    [276, 640],
  ]);
  foc.annotations = [
    {
      x: 0,
      y: 16,
      text: '01  SPEED CONTROL',
      detail: 'Speed error → PI → torque-producing current',
    },
    {
      x: 800,
      y: 16,
      text: '02  CURRENT CONTROL',
      detail: 'Independent d / q regulators',
    },
    {
      x: 1296,
      y: 16,
      text: '03  POWER & MECHANICS',
      detail: '48 V inverter · four-pole-pair PMSM',
    },
    { x: 1104, y: 368, text: 'CURRENT FEEDBACK', detail: 'abc → αβ → dq' },
  ];
  foc = finish(foc, 'foc');
  for (const [wire, name, point] of [
    ['w_30', 'ωm · measured speed', { x: 624, y: 628 }],
    ['w_28', 'θe · electrical angle', { x: 1448, y: 582 }],
  ] as const) {
    const net = foc.nets!.find((n) => n.wireIds.includes(wire))!;
    net.name = name;
    net.hidden = false;
    net.label = nearestLabelAnchor(foc, net, point);
  }
  save(foc, 'foc');
}
console.log(
  'Styled DC and FOC templates; saved user documents were not touched.',
);
