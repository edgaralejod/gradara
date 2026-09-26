// SPDX-License-Identifier: Apache-2.0
/** Lumped cooling-control benchmark. All values are illustrative, not facility data. */
import { writeFileSync } from 'node:fs';
import {
  library,
  type Definition,
  type Port,
  type Project,
} from '../lib/gradara/model';
import { defaultBlockSize } from '../lib/gradara/block-design';
import { portPoint } from '../lib/gradara/ports';
import { reconcileNets } from '../lib/gradara/net-registry';
const param = (id: string, value: number, unit = '') => ({
  id,
  name: id,
  value,
  unit,
});
const physical = (
  id: string,
  domain: 'electrical' | 'thermal',
  side: Port['side'],
): Port => ({ id, name: id, domain, side, direction: 'physical' });
const output = (
  id: string,
  unit: string,
  side: Port['side'] = 'bottom',
): Port => ({
  id,
  name: id,
  unit,
  side,
  domain: 'signal',
  direction: 'output',
});
const input = (id: string, side: Port['side']): Port => ({
  id,
  name: id,
  side,
  domain: 'signal',
  direction: 'input',
});
const pins = () => [
  physical('p', 'electrical', 'top'),
  physical('n', 'electrical', 'top'),
];
const it: Definition = {
  kind: 'dataCenterIT',
  name: 'IT load',
  domain: 'electrical',
  symbol: 'IT',
  generated: true,
  description:
    'Illustrative IT load: 600 to 900 kW at 600 s. All absorbed electricity becomes rack heat. Constant power above minimumVoltage; resistive rolloff below it. No server throttling or UPS.',
  ports: [...pins(), physical('heat', 'thermal', 'right'), output('kW', 'kW')],
  parameters: [
    param('basePower', 600000, 'W'),
    param('addedPower', 300000, 'W'),
    param('stepTime', 600, 's'),
    param('minimumVoltage', 400, 'V'),
  ],
  declarations:
    'Real demand; Real voltage; Real power; Real energy(start=0, fixed=true);',
  equations:
    'demand = basePower + (if time < stepTime then 0 else addedPower);\nvoltage = p.v-n.v;\np.i = demand*voltage/max(voltage*voltage, minimumVoltage*minimumVoltage);\np.i+n.i = 0;\npower = voltage*p.i;\nheat.Q_flow = -power;\nkW = power/1000;\nder(energy) = power;',
};
const rack: Definition = {
  kind: 'dataCenterRack',
  name: 'Rack thermal mass',
  domain: 'thermal',
  symbol: 'C/G',
  generated: true,
  description:
    'One lumped equipment temperature with thermal storage and fixed rack-to-room conductance. This is not chip junction temperature or an airflow model.',
  ports: [
    physical('heat', 'thermal', 'left'),
    physical('air', 'thermal', 'right'),
    output('degC', 'degC'),
  ],
  parameters: [
    param('capacity', 20000000, 'J/K'),
    param('conductance', 100000, 'W/K'),
    param('initialTemperature', 303.15, 'K'),
  ],
  declarations:
    'Real temperature(start=initialTemperature, fixed=true); Real transfer; Real energy;',
  equations:
    'heat.T = temperature;\ntransfer = conductance*(temperature-air.T);\nair.Q_flow = -transfer;\ncapacity*der(temperature) = heat.Q_flow-transfer;\ndegC = temperature-273.15;\nenergy = capacity*(temperature-initialTemperature);',
};
const room: Definition = {
  kind: 'dataCenterRoom',
  name: 'Room thermal mass',
  domain: 'thermal',
  symbol: 'C',
  generated: true,
  description:
    'Well-mixed room and effective coupled building mass. No humidity, spatial hot spots, or envelope heat gains. degC is the controlled room temperature, not a predicted rack inlet distribution.',
  ports: [
    physical('rack', 'thermal', 'left'),
    physical('cool', 'thermal', 'right'),
    output('degC', 'degC'),
  ],
  parameters: [
    param('capacity', 10000000, 'J/K'),
    param('initialTemperature', 297.15, 'K'),
  ],
  declarations:
    'Real temperature(start=initialTemperature, fixed=true); Real energy;',
  equations:
    'rack.T = temperature;\ncool.T = temperature;\ncapacity*der(temperature) = rack.Q_flow+cool.Q_flow;\ndegC = temperature-273.15;\nenergy = capacity*(temperature-initialTemperature);',
};
const cooling: Definition = {
  kind: 'dataCenterCooling',
  name: 'Cooling plant',
  domain: 'thermal',
  symbol: 'COP',
  generated: true,
  description:
    'Aggregate sensible cooling with fixed COP, 20 s response, and a temporary 50% capacity limit from 1800 to 2100 s. Electrical compressor power and condenser heat are conserved. No pumps, fans, fluid circuit, humidity, or weather-dependent performance.',
  ports: [
    ...pins(),
    physical('cold', 'thermal', 'left'),
    physical('hot', 'thermal', 'right'),
    input('u', 'bottom'),
    output('kW', 'kW'),
    { ...output('coolkW', 'kW'), name: 'Q' },
  ],
  parameters: [
    param('ratedCooling', 1200000, 'W'),
    param('COP', 4),
    param('responseTime', 20, 's'),
    param('initialCooling', 600000, 'W'),
    param('derateStart', 1800, 's'),
    param('derateEnd', 2100, 's'),
    param('availableFraction', 0.5),
    param('minimumVoltage', 400, 'V'),
  ],
  declarations:
    'Real cooling(start=initialCooling, fixed=true); Real available; Real voltage; Real power; Real removedEnergy(start=0, fixed=true);',
  equations:
    'voltage = p.v-n.v;\navailable = if time >= derateStart and time < derateEnd then availableFraction else 1;\nresponseTime*der(cooling) = ratedCooling*min(max(u, 0), available)*min(voltage*voltage/(minimumVoltage*minimumVoltage), 1)-cooling;\np.i = (cooling/COP)*voltage/max(voltage*voltage, minimumVoltage*minimumVoltage);\np.i+n.i = 0;\npower = voltage*p.i;\ncold.Q_flow = cooling;\nhot.Q_flow = -cooling-power;\nkW = power/1000;\ncoolkW = cooling/1000;\nder(removedEnergy) = cooling;',
};
const ambient: Definition = {
  kind: 'dataCenterAmbient',
  name: 'Outdoor heat sink',
  domain: 'thermal',
  symbol: 'T',
  generated: true,
  description:
    'Infinite fixed-temperature heat sink. COP is fixed independently of this temperature; changing ambient temperature does not predict weather sensitivity.',
  ports: [physical('heat', 'thermal', 'left'), output('kW', 'kW')],
  parameters: [param('temperature', 308.15, 'K')],
  equations: 'heat.T = temperature;\nkW = heat.Q_flow/1000;',
};
const controller: Definition = {
  kind: 'dataCenterPI',
  name: 'Room temperature PI',
  domain: 'signal',
  symbol: 'PI',
  generated: true,
  controller: true,
  description:
    'PI room-temperature controller with back-calculation anti-windup and bounded 0–1 output. Baseline 0.5 command balances 600 kW. Positive temperature error increases cooling.',
  ports: [input('degC', 'left'), output('u', '1', 'right')],
  parameters: [
    param('setpoint', 24, 'degC'),
    param('gain', 0.1, '1/K'),
    param('integralTime', 120, 's'),
    param('initialCommand', 0.5),
  ],
  declarations:
    'Real integral(start=initialCommand, fixed=true); Real error; Real raw;',
  equations:
    'error = degC-setpoint;\nraw = gain*error+integral;\nu = min(max(raw, 0), 1);\nintegralTime*der(integral) = gain*error+u-raw;',
};
const project: Project = {
  version: 1,
  name: 'Data center cooling control',
  exampleId: 'datacenter',
  duration: 3600,
  revision: 0,
  description:
    'Illustrative lumped electrical–thermal cooling benchmark: 600 → 900 kW IT load at 10 min; cooling capacity halved at 30–35 min. Ideal 800 V DC supply equivalent, fixed COP=4. Not an SST, fluid-network, CFD, or validated facility model.',
  blocks: [],
  wires: [],
  junctions: [],
  annotations: [
    {
      x: 480,
      y: 110,
      text: 'DATA CENTER · COOLING CONTROL',
      detail: '1 hour · illustrative parameters · ideal 800 V DC equivalent',
    },
    {
      x: 340,
      y: 400,
      text: 'DISTURBANCES',
      detail: '10 min: IT 600 → 900 kW\n30–35 min: cooling capacity 50%',
    },
    {
      x: 1040,
      y: 500,
      text: 'MODEL LIMITS',
      detail:
        'Fixed COP 4 · no fluid network or humidity\nRoom and rack are lumped temperatures',
    },
  ],
  plots: [
    {
      id: 'temperatures',
      label: 'Temperatures (°C)',
      series: ['room.degC', 'rack.degC'],
      labels: ['Room', 'Rack mass'],
    },
    {
      id: 'power',
      label: 'Power (kW)',
      series: ['it.kW', 'cooling.coolkW', 'cooling.kW', 'ambient.kW'],
      labels: [
        'IT electricity / heat',
        'Heat removed',
        'Cooling electricity',
        'Heat rejected',
      ],
    },
    {
      id: 'control',
      label: 'Cooling command (0–1)',
      series: ['controller.u'],
      labels: ['PI command'],
    },
  ],
};
function add(id: string, definition: Definition, x: number, y: number) {
  const size = defaultBlockSize(definition);
  project.blocks.push({
    id,
    definition,
    position: { x, y: y - size.height / 2 },
    size,
  });
}
const supply = structuredClone(library.find((d) => d.kind === 'dcSource')!);
supply.name = '800 V DC equivalent';
supply.parameters[0].value = 800;
add('supply', supply, 0, 240);
add('it', it, 240, 240);
add('rack', rack, 480, 240);
add('room', room, 720, 240);
add('cooling', cooling, 1000, 240);
add('ambient', ambient, 1320, 240);
add('controller', controller, 720, 500);
for (const block of project.blocks)
  if (block.id === 'room' || block.id === 'cooling')
    block.labelOffset = { x: 80, y: 0 };
add(
  'ground',
  structuredClone(library.find((d) => d.kind === 'ground')!),
  0,
  420,
);
function wire(
  source: string,
  sourceHandle: string,
  target: string,
  targetHandle: string,
  mode: 'direct' | 'positive' | 'negative' | 'feedback' | 'command' = 'direct',
) {
  const a = portPoint(
    project.blocks.find((b) => b.id === source)!,
    sourceHandle,
  );
  const b = portPoint(
    project.blocks.find((b) => b.id === target)!,
    targetHandle,
  );
  if (!a || !b)
    throw new Error(
      `Missing terminal: ${source}.${sourceHandle} or ${target}.${targetHandle}`,
    );
  let waypoints: { x: number; y: number }[] = [];
  if (mode === 'positive' || mode === 'negative') {
    const rail = mode === 'positive' ? 40 : 80;
    if (source === 'supply' && mode === 'negative')
      waypoints = [
        { x: a.x, y: 340 },
        { x: 120, y: 340 },
        { x: 120, y: rail },
        { x: b.x, y: rail },
      ];
    else
      waypoints = [
        { x: a.x, y: rail },
        { x: b.x, y: rail },
      ];
  } else if (mode === 'feedback')
    waypoints = [
      { x: a.x, y: 380 },
      { x: 660, y: 380 },
      { x: 660, y: b.y },
    ];
  else if (mode === 'command') waypoints = [{ x: b.x, y: a.y }];
  project.wires.push({
    id: `dc_w${project.wires.length}`,
    source,
    sourceHandle,
    target,
    targetHandle,
    waypoints,
  });
}
wire('supply', 'p', 'it', 'p', 'positive');
wire('it', 'p', 'cooling', 'p', 'positive');
wire('supply', 'n', 'it', 'n', 'negative');
wire('it', 'n', 'cooling', 'n', 'negative');
wire('supply', 'n', 'ground', 'p');
wire('it', 'heat', 'rack', 'heat');
wire('rack', 'air', 'room', 'rack');
wire('room', 'cool', 'cooling', 'cold');
wire('cooling', 'hot', 'ambient', 'heat');
wire('room', 'degC', 'controller', 'degC', 'feedback');
wire('controller', 'u', 'cooling', 'u', 'command');
const normalized = reconcileNets(project);
normalized.nets?.forEach((net, i) => {
  net.id = `datacenter_net${i}`;
  net.hidden = true;
});
writeFileSync(
  'models/examples/datacenter.json',
  JSON.stringify(normalized, null, 2) + '\n',
);
