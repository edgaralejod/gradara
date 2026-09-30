// SPDX-License-Identifier: Apache-2.0
/**
 * Lumped cooling-control benchmark, built from library blocks only, so every part
 * has its Help page. All values are illustrative, not facility data.
 *
 * Electrical: an ideal 800 V DC supply feeds the IT load (two heating resistors;
 * the second switches in at 10 min) and the cooling plant's electricity (a
 * controlled current, cooling / COP / 800 V).
 * Thermal: IT heat flows into the rack mass, through a conductance into the room,
 * and cooling takes heat out of the room.
 * Control: a sampled PI holds the room at 24 °C; its command, limited by the
 * available capacity (halved from 30 to 35 min), sets the cooling.
 */
import { writeFileSync } from 'node:fs';
import { library, type Block, type Project } from '../lib/gradara/model';
import { defaultBlockSize } from '../lib/gradara/block-design';
import { linkEnds } from '../lib/gradara/project';
import { normalizeProject } from '../lib/gradara/normalize-project';
import {
  centers,
  groupAs,
  insideCenters,
  namePorts,
  placePorts,
  reroute,
  setSides,
} from './example-hierarchy';

let uuid = 0;
Object.defineProperty(globalThis.crypto, 'randomUUID', {
  value: () => `dc${(++uuid).toString(36).padStart(8, '0')}-0000`,
  configurable: true,
});

const COP = 4;
const VOLTS = 800;
type Place = {
  rotation?: 90 | 180 | 270;
  /** Move ports to another side. */
  ports?: Record<string, 'left' | 'right' | 'top' | 'bottom'>;
  label?: 'left' | 'right' | 'above' | [number, number];
};
const blocks: Block[] = [];
function add(
  id: string,
  kind: string,
  name: string,
  [cx, cy]: [number, number],
  values: Record<string, number> = {},
  place: Place = {},
) {
  const found = library.find((d) => d.kind === kind);
  if (!found) throw new Error(`${kind} is not a library block`);
  const definition = structuredClone(found);
  definition.name = name;
  for (const [key, value] of Object.entries(values)) {
    const p = definition.parameters.find((p) => p.id === key);
    if (!p) throw new Error(`${kind} has no parameter ${key}`);
    p.value = value;
  }
  for (const [portId, side] of Object.entries(place.ports ?? {})) {
    const port = definition.ports.find((p) => p.id === portId);
    if (!port) throw new Error(`${kind} has no port ${portId}`);
    port.side = side;
  }
  const standard = defaultBlockSize(definition);
  const turned = place.rotation === 90 || place.rotation === 270;
  const size = turned
    ? { width: standard.height, height: standard.width }
    : standard;
  const width = Math.min(240, Math.max(24, name.length * 8));
  const label = place.label;
  blocks.push({
    id,
    definition,
    position: { x: cx - size.width / 2, y: cy - size.height / 2 },
    size,
    ...(place.rotation ? { rotation: place.rotation } : {}),
    ...(label
      ? {
          labelOffset: Array.isArray(label)
            ? { x: label[0], y: label[1] }
            : label === 'above'
              ? { x: 0, y: -size.height - 32 }
              : {
                  x:
                    (label === 'right' ? 1 : -1) *
                    (size.width / 2 + width / 2 + 8),
                  y: -size.height / 2 - 14,
                },
        }
      : {}),
  });
}

// ---------------------------------------------------------------- electrical
add(
  'supply',
  'dcSource',
  '800 V DC',
  [120, 240],
  { V: VOLTS },
  { label: 'left' },
);
add('ground', 'ground', 'Ground', [120, 376]);
add(
  'plant',
  'signalCurrent',
  'Cooling electricity',
  [280, 240],
  {},
  { label: 'right' },
);
add(
  'itBase',
  'heatingResistor',
  'IT load 600 kW',
  [456, 240],
  { R: VOLTS ** 2 / 600e3, alpha: 0 },
  { rotation: 270, label: 'left' },
);
add('addLoad', 'closingSwitch', 'Load step', [616, 200], {
  Ron: 1e-5,
  Goff: 1e-9,
});
add('at10min', 'booleanStep', 'At 10 min', [616, 88], { startTime: 600 });
add(
  'itAdded',
  'heatingResistor',
  'IT load +300 kW',
  [776, 240],
  { R: VOLTS ** 2 / 300e3, alpha: 0 },
  { rotation: 270, label: 'right' },
);

// ------------------------------------------------------------------- thermal
add('itHeat', 'heatFlowSensor', 'IT heat', [616, 456], {}, { label: 'left' });
add(
  'rack',
  'heatCapacitor',
  'Rack mass 20 MJ/K',
  [808, 392],
  { C: 20e6, T0: 303.15 },
  { ports: { port: 'top' } },
);
add(
  'path',
  'thermalConductor',
  'Rack to room 100 kW/K',
  [968, 456],
  { G: 1e5 },
  { label: 'above' },
);
add(
  'room',
  'heatCapacitor',
  'Room 10 MJ/K',
  [1128, 392],
  { C: 10e6, T0: 297.15 },
  { ports: { port: 'top' } },
);
add(
  'cooler',
  'prescribedHeatFlow',
  'Cooling',
  [1288, 456],
  {},
  { rotation: 180, label: 'above' },
);
add('rackT', 'temperatureSensor', 'Rack temperature', [968, 584]);
add('roomT', 'temperatureSensor', 'Room temperature', [1288, 584]);

// ------------------------------------------------------------------- control
add('kelvin', 'constant', '273.15 K', [1288, 712], { value: 273.15 });
add('rackC', 'subtract', 'Rack °C', [1448, 568]);
add('roomC', 'subtract', 'Room °C', [1448, 696]);
add('setpoint', 'constant', '24 °C setpoint', [1448, 840], { value: 24 });
add('pi', 'pi', 'Room temperature PI', [1664, 744], {
  kp: 0.1,
  ki: 0.1 / 120,
  limit: 0.5,
  samplePeriod: 1,
});
add('bias', 'constant', 'Base command 0.5', [1664, 904], { value: 0.5 });
add('command', 'sum', 'Command', [1856, 744], {}, { label: 'above' });
add('outage', 'pulse', 'Outage 30–35 min', [1856, 904], {
  amplitude: 0.5,
  period: 1e5,
  width: 300 / 1e5,
  startTime: 1800,
});
add('one', 'constant', 'Full capacity', [2016, 1032], { value: 1 });
add('available', 'subtract', 'Available', [2016, 904], {}, { label: 'right' });
add('limit', 'min', 'Limit', [2016, 744], {}, { label: 'above' });
add(
  'capacity',
  'gain',
  'Cooling kW (1200 kW rated)',
  [2176, 744],
  { k: 1200 },
  { label: 'above' },
);
add(
  'toWatts',
  'gain',
  'Heat out, W',
  [2176, 584],
  { k: -1000 },
  { rotation: 180, label: 'above' },
);
add(
  'amps',
  'gain',
  'Plant current, A',
  [2176, 312],
  { k: 1000 / COP / VOLTS },
  { label: 'above' },
);
add('electric', 'gain', 'Cooling electricity kW', [2336, 872], { k: 1 / COP });
add('rejected', 'sum', 'Heat rejected', [2496, 744], {}, { label: 'above' });
add('itKW', 'gain', 'IT kW', [616, 584], { k: 0.001 });

let project: Project = {
  version: 2,
  exampleId: 'datacenter',
  name: 'Data center cooling control',
  description:
    'Illustrative lumped electrical–thermal cooling benchmark built from library blocks: 600 → 900 kW IT load at 10 min; cooling capacity halved at 30–35 min. Ideal 800 V DC supply, fixed COP 4, sampled PI on room temperature. Not an SST, fluid-network, CFD, or validated facility model.',
  duration: 3600,
  revision: 0,
  blocks,
  wires: [],
  junctions: [],
  nets: [],
  annotations: [],
  plots: [],
};
const link = (from: string, to: string) => {
  const [a, ah] = from.split('.'),
    [b, bh] = to.split('.');
  try {
    project = linkEnds(project, { id: a, handle: ah }, { id: b, handle: bh });
  } catch (e) {
    throw new Error(`${from} → ${to}: ${(e as Error).message}`);
  }
};
// Electrical: + rail across the top, − rail below.
link('supply.p', 'plant.p');
link('plant.p', 'itBase.n');
link('itBase.n', 'addLoad.p');
link('addLoad.n', 'itAdded.n');
link('supply.n', 'plant.n');
link('plant.n', 'itBase.p');
link('itBase.p', 'itAdded.p');
link('supply.n', 'ground.p');
link('at10min.y', 'addLoad.control');
// Thermal.
link('itBase.heatPort', 'itHeat.port_a');
link('itAdded.heatPort', 'itHeat.port_a');
link('itHeat.port_b', 'rack.port');
link('rack.port', 'path.port_a');
link('path.port_b', 'room.port');
link('room.port', 'cooler.port');
link('rack.port', 'rackT.port');
link('room.port', 'roomT.port');
// Control.
link('rackT.T', 'rackC.a');
link('roomT.T', 'roomC.a');
link('kelvin.y', 'rackC.b');
link('kelvin.y', 'roomC.b');
link('roomC.y', 'pi.reference');
link('setpoint.y', 'pi.measured');
link('pi.y', 'command.a');
link('bias.y', 'command.b');
link('command.y', 'limit.a');
link('one.y', 'available.a');
link('outage.y', 'available.b');
link('available.y', 'limit.b');
link('limit.y', 'capacity.u');
link('capacity.y', 'toWatts.u');
link('toWatts.y', 'cooler.Q_flow');
link('capacity.y', 'amps.u');
link('amps.y', 'plant.i');
link('capacity.y', 'electric.u');
link('capacity.y', 'rejected.a');
link('electric.y', 'rejected.b');
link('itHeat.Q_flow', 'itKW.u');

project = normalizeProject(normalizeProject(project));
project = {
  ...project,
  wires: project.wires.map((w) => ({ ...w, waypoints: [] })),
};
// Three subsystems, as the facility is built: the IT load, the cooling plant, and
// its controller (pure signal flow, so it exports to C).
project = groupAs(
  project,
  ['setpoint', 'pi', 'bias', 'command'],
  'Controller',
  'control',
);
project = groupAs(
  project,
  ['itBase', 'addLoad', 'at10min', 'itAdded', 'itHeat', 'itKW'],
  'IT load',
  'it',
);
project = groupAs(
  project,
  [
    'outage',
    'one',
    'available',
    'limit',
    'capacity',
    'toWatts',
    'cooler',
    'amps',
    'plant',
    'electric',
    'rejected',
  ],
  'Cooling plant',
  'cooling',
);
project = namePorts(project, 'Controller', {
  'pi.reference': '°C',
  'command.y': 'u',
});
project = namePorts(project, 'IT load', {
  'itBase.n': '+',
  'itBase.p': '−',
  'itHeat.port_b': 'heat',
});
project = namePorts(project, 'Cooling plant', {
  'limit.a': 'u',
  'plant.p': '+',
  'plant.n': '−',
  'cooler.port': 'room',
});
project = setSides(project, 'IT load', {
  '+': 'top',
  '−': 'top',
  heat: 'right',
});
project = setSides(project, 'Cooling plant', {
  '+': 'top',
  '−': 'top',
  room: 'left',
  u: 'bottom',
});
project = setSides(project, 'Controller', { '°C': 'left', u: 'top' });
// Supply and rails on top, the heat path left to right, measurement and control below.
project = centers(placePorts(project), {
  supply: [104, 216],
  ground: [104, 336],
  it: [392, 400],
  rack: [584, 480],
  path: [712, 400],
  room: [840, 480],
  cooling: [1328, 400],
  rackT: [680, 632],
  rackC: [824, 632],
  roomT: [984, 632],
  roomC: [1128, 632],
  kelvin: [728, 760],
  control: [1328, 632],
});
project = insideCenters(project, 'IT load', {
  '@+': [120, 200],
  '@−': [120, 392],
  at10min: [480, 88],
  addLoad: [480, 200],
  itBase: [320, 296],
  itAdded: [640, 296],
  itHeat: [480, 552],
  '@heat': [680, 552],
  itKW: [480, 680],
});
// Heat leaves on the left, where the room is; the signal chain runs left to right
// below it and feeds the heat flow back through a flipped gain.
project = insideCenters(project, 'Cooling plant', {
  '@room': [104, 200],
  cooler: [320, 200],
  toWatts: [504, 200],
  '@u': [120, 480],
  limit: [344, 480],
  one: [104, 616],
  available: [248, 616],
  outage: [104, 744],
  capacity: [504, 480],
  amps: [720, 336],
  plant: [872, 336],
  '@+': [720, 240],
  '@−': [720, 424],
  electric: [720, 616],
  rejected: [904, 480],
});
project = reroute(project, ['control', 'it', 'cooling']);
delete project.modelId;
project.annotations = [
  {
    x: 80,
    y: 8,
    text: 'DATA CENTER · COOLING CONTROL',
    detail: '1 hour · illustrative values · ideal 800 V DC supply',
  },
  {
    x: 720,
    y: 8,
    text: 'DISTURBANCES',
    detail: '10 min: IT 600 → 900 kW · 30–35 min: cooling capacity 50 %',
  },
];
project.plots = [
  {
    id: 'temperatures',
    label: 'Temperatures (°C)',
    series: ['roomC.y', 'rackC.y'],
    labels: ['Room', 'Rack mass'],
  },
  {
    id: 'power',
    label: 'Power (kW)',
    series: [
      'it.itKW.y',
      'cooling.capacity.y',
      'cooling.electric.y',
      'cooling.rejected.y',
    ],
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
    series: ['control.command.y'],
    labels: ['PI command'],
  },
];
for (const [index, net] of (project.nets ?? []).entries()) {
  net.id = `datacenter_net${index}`;
  net.hidden = true;
}
writeFileSync(
  'models/examples/datacenter.json',
  JSON.stringify(project, null, 2) + '\n',
);
