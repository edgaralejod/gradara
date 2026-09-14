import { writeFileSync } from 'node:fs';
import {
  library,
  type Block,
  type Project,
  type Wire,
} from '../lib/gradara/model';
import { defaultBlockSize } from '../lib/gradara/block-design';
import { nearestLabelAnchor } from '../lib/gradara/net-label';
import { reconcileNets } from '../lib/gradara/net-registry';
const blocks: Block[] = [];
function block(
  id: string,
  kind: string,
  name: string,
  x: number,
  y: number,
  params: Record<string, number> = {},
  vertical = false,
) {
  const definition = structuredClone(library.find((d) => d.kind === kind)!);
  if (!definition) throw new Error(`Missing ${kind}`);
  definition.name = name;
  for (const p of definition.parameters)
    if (p.id in params) p.value = params[p.id];
  if (vertical)
    for (const port of definition.ports)
      if (port.direction === 'physical')
        port.side = port.id === 'p' ? 'top' : 'bottom';
  const b = {
    id,
    definition,
    position: { x, y },
    size: defaultBlockSize(definition),
  };
  blocks.push(b);
  return b;
}
block('supply', 'dcSource', '24 V supply', 20, 350, { V: 24 });
block('pwm', 'pwmPair', 'Gate drive', 160, 176);
block('highSide', 'idealSwitch', 'High-side switch', 400, 168);
block('lowSide', 'idealSwitch', 'Low-side switch', 400, 350);
block('inductor', 'inductor', '1 mH inductor', 544, 266, { L: 0.001 });
block('current', 'currentSensor', 'Inductor current', 676, 266);
block(
  'capacitor',
  'capacitor',
  '100 µF capacitor',
  796,
  350,
  { C: 0.0001 },
  true,
);
block('load', 'resistor', '10 Ω load', 916, 350, { R: 10 }, true);
block('voltageProbe', 'voltageSensor', 'Output voltage', 1040, 350);
block('ground', 'ground', 'Ground', 404, 490);
// Keep names out of the vertical power conductors and the return rail.
for (const b of blocks) {
  if (['supply', 'capacitor', 'load', 'voltageProbe'].includes(b.id))
    b.labelOffset = { x: 0, y: 72 };
  if (['highSide', 'lowSide'].includes(b.id)) b.labelOffset = { x: 96, y: -48 };
}
const junctions = [
  { id: 'sw', domain: 'electrical' as const, position: { x: 424, y: 290 } },
  { id: 'out', domain: 'electrical' as const, position: { x: 820, y: 290 } },
  { id: 'return', domain: 'electrical' as const, position: { x: 424, y: 490 } },
];
const wires: Wire[] = [];
function wire(
  source: string,
  sourceHandle: string,
  target: string,
  targetHandle: string,
  points: number[][] = [],
) {
  wires.push({
    id: `w_${wires.length}`,
    source,
    sourceHandle,
    target,
    targetHandle,
    waypoints: points.map(([x, y]) => ({ x, y })),
  });
}
wire('supply', 'p', 'highSide', 'p', [
  [44, 130],
  [424, 130],
]);
wire('pwm', 'high', 'highSide', 'gate');
wire('pwm', 'low', 'lowSide', 'gate', [
  [340, 240],
  [340, 390],
]);
wire('highSide', 'n', 'sw', 'node');
wire('sw', 'node', 'lowSide', 'p');
wire('sw', 'node', 'inductor', 'p');
wire('inductor', 'n', 'current', 'p');
wire('current', 'n', 'out', 'node');
wire('out', 'node', 'capacitor', 'p');
wire('out', 'node', 'load', 'p', [[940, 290]]);
wire('out', 'node', 'voltageProbe', 'p', [[1064, 290]]);
wire('supply', 'n', 'return', 'node', [[44, 490]]);
wire('lowSide', 'n', 'return', 'node');
wire('return', 'node', 'ground', 'p');
wire('capacitor', 'n', 'return', 'node', [[820, 490]]);
wire('load', 'n', 'return', 'node', [[940, 490]]);
wire('voltageProbe', 'n', 'return', 'node', [[1064, 490]]);
let project: Project = {
  version: 1,
  name: 'Buck converter · Ideal switches',
  exampleId: 'buck',
  description:
    '24 V synchronous buck: complementary ideal switches at 10 kHz and 50% duty, 1 mH / 100 µF filter, 10 Ω load. Start from zero stored energy. Expect approximately 12 V and 1.2 A after settling. No losses, dead time, or parasitics.',
  duration: 0.02,
  revision: 0,
  blocks,
  wires,
  junctions,
  annotations: [
    { x: 160, y: 64, text: 'GATE DRIVE', detail: '10 kHz · 50% duty' },
    {
      x: 400,
      y: 64,
      text: 'IDEAL SWITCHING STAGE',
      detail: '24 V input · complementary gates',
    },
    {
      x: 680,
      y: 192,
      text: 'OUTPUT FILTER & LOAD',
      detail: '12 V nominal · 1.2 A nominal',
    },
  ],
  plots: [
    {
      id: 'voltage',
      label: 'Output voltage',
      series: ['voltageProbe.y'],
      labels: ['Output voltage'],
    },
    {
      id: 'current',
      label: 'Inductor current',
      series: ['current.y'],
      labels: ['Inductor current'],
    },
    {
      id: 'gates',
      label: 'Switch gates',
      series: ['pwm.high', 'pwm.low'],
      labels: ['High-side gate', 'Low-side gate'],
    },
  ],
};
project = reconcileNets(project);
for (const net of project.nets ?? []) {
  const owned = net.wireIds.map((id) => wires.find((w) => w.id === id)!);
  const touches = (id: string, handle: string) =>
    owned.some(
      (w) =>
        (w.source === id && w.sourceHandle === handle) ||
        (w.target === id && w.targetHandle === handle),
    );
  net.name = touches('supply', 'p')
    ? 'Vin'
    : touches('highSide', 'n')
      ? 'SW'
      : touches('capacitor', 'p')
        ? 'Vout'
        : touches('ground', 'p')
          ? 'GND'
          : undefined;
  net.hidden = !net.name;
  if (net.name === 'Vin')
    net.label = nearestLabelAnchor(project, net, { x: 92, y: 110 });
}
writeFileSync(
  'models/examples/buck.json',
  JSON.stringify(project, null, 2) + '\n',
);
