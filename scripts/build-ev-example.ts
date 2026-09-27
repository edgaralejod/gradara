/**
 * Builds models/examples/ev.json: an EV drivetrain with three levels of
 * hierarchy and two variant subsystems (battery chemistry, motor type).
 *
 * The flat diagram is drawn first, then grouped with the same operations the
 * workbench uses (⌘G, promote, add variant), so the document is exactly what a
 * user could build by hand. Run with `npx tsx scripts/build-ev-example.ts`.
 */
import { writeFileSync } from 'node:fs';
import { defaultBlockSize } from '../lib/gradara/block-design';
import {
  findSubsystem,
  groupIntoSubsystem,
  promoteParameter,
  scopeView,
  setBoundarySide,
  syncInstances,
  writeScope,
} from '../lib/gradara/hierarchy';
import { library, type Block, type Project } from '../lib/gradara/model';
import { normalizeProject } from '../lib/gradara/normalize-project';
import { linkEnds } from '../lib/gradara/project';
import { netComponents } from '../lib/gradara/net';
import { layoutProject } from '../lib/gradara/auto-layout';
import {
  addDiagramVariant,
  applyConfiguration,
  addParameterVariant,
  renameVariant,
  saveConfiguration,
  switchVariant,
  variantInstances,
} from '../lib/gradara/variants';

function block(
  id: string,
  kind: string,
  name: string,
  params: Record<string, number> = {},
): Block {
  const found = library.find((d) => d.kind === kind);
  if (!found) throw new Error(`Missing ${kind}`);
  const definition = structuredClone(found);
  definition.name = name;
  for (const p of definition.parameters)
    if (p.id in params) p.value = params[p.id];
  for (const key of Object.keys(params))
    if (!definition.parameters.some((p) => p.id === key))
      throw new Error(`${kind} has no parameter ${key}`);
  return {
    id,
    definition,
    position: { x: 0, y: 0 },
    size: defaultBlockSize(definition),
  };
}

// ------------------------------------------------------------ flat diagram
// Vehicle control: speed request → PI → duty limit.
const blocks: Block[] = [
  block('request', 'ramp', 'Speed request', { slope: 0.5, startTime: 1 }),
  block('cruise', 'saturation', 'Cruise speed', { lower: 0, upper: 5 }),
  block('error', 'subtract', 'Speed error'),
  block('pi', 'pid', 'Speed PI', { kp: 0.4, ki: 1, kd: 0, tf: 0.01 }),
  block('duty', 'saturation', 'Duty limit', { lower: -1, upper: 1 }),
  // Battery pack.
  block('cells', 'batteryStack', 'Cells', {
    Ns: 34,
    Np: 1,
    Q: 40,
    OCVmax: 3.6,
    OCVmin: 2.5,
    Ri: 0.002,
  }),
  block('packGround', 'ground', 'Ground'),
  // Converter: v_out = d·v_dc, and the DC side draws d·i_out (lossless averaged model).
  block('vdc', 'voltageSensor', 'DC voltage'),
  block('scale', 'product', 'd·Vdc'),
  block('source', 'signalVoltage', 'Output voltage'),
  block('iout', 'currentSensor', 'Output current'),
  block('draw', 'product', 'd·Iout'),
  block('sink', 'signalCurrent', 'DC current'),
  block('outGround', 'ground', 'Output ground'),
  // Motor and gear.
  block('machine', 'dcPmMachine', 'PM DC machine'),
  block('gear', 'idealGear', 'Final drive', { ratio: 6 }),
  // Vehicle body.
  block('wheel', 'rollingWheel', 'Wheel', { radius: 0.3 }),
  block('car', 'mass', 'Vehicle mass', { m: 1200 }),
  block('drag', 'transDamper', 'Road drag', { d: 40 }),
  block('road', 'transFixed', 'Road'),
  block('speed', 'velocitySensor', 'Vehicle speed'),
];

let doc: Project = normalizeProject({
  version: 1,
  name: 'EV drivetrain',
  exampleId: 'ev',
  description:
    'A battery electric vehicle in three levels: vehicle control and powertrain at the top; battery pack and motor drive inside the powertrain; an averaged DC-DC converter inside the motor drive. Two variant subsystems switch battery chemistry (LFP, NMC) and motor type (PM DC machine, simple DC motor); two configurations pick them together.',
  duration: 20,
  revision: 0,
  blocks,
  wires: [],
  junctions: [],
  nets: [],
  annotations: [],
  plots: [],
});

const link = (a: string, ah: string, b: string, bh: string) => {
  try {
    doc = linkEnds(doc, { id: a, handle: ah }, { id: b, handle: bh });
  } catch (e) {
    throw new Error(`${a}.${ah} → ${b}.${bh}: ${(e as Error).message}`);
  }
};
link('request', 'y', 'cruise', 'u');
link('cruise', 'y', 'error', 'a');
link('speed', 'v', 'error', 'b');
link('error', 'y', 'pi', 'u');
link('pi', 'y', 'duty', 'u');
// Battery: cells + to the converter DC side, cells − to ground.
link('cells', 'n', 'packGround', 'p');
link('cells', 'p', 'vdc', 'p');
link('cells', 'n', 'vdc', 'n');
link('cells', 'p', 'sink', 'p');
link('cells', 'n', 'sink', 'n');
// Converter control.
link('duty', 'y', 'scale', 'a');
link('vdc', 'y', 'scale', 'b');
link('scale', 'y', 'source', 'v');
link('duty', 'y', 'draw', 'a');
link('iout', 'y', 'draw', 'b');
link('draw', 'y', 'sink', 'i');
// Converter output to the machine.
link('source', 'p', 'iout', 'p');
link('iout', 'n', 'machine', 'pin_ap');
link('source', 'n', 'machine', 'pin_an');
link('source', 'n', 'outGround', 'p');
// Drivetrain and vehicle.
link('machine', 'flange', 'gear', 'flange_a');
link('gear', 'flange_b', 'wheel', 'flangeR');
link('wheel', 'flangeT', 'car', 'flange_a');
link('car', 'flange_b', 'drag', 'flange_a');
link('drag', 'flange_b', 'road', 'flange');
link('car', 'flange_a', 'speed', 'flange');
doc = normalizeProject(layoutProject(doc));

// ------------------------------------------------------------ hierarchy
function group(view: Project, ids: string[], name: string) {
  const g = groupIntoSubsystem(view, ids, name);
  if (!g) throw new Error(`Could not group ${name}`);
  return g;
}
function tidy(project: Project, path: string[]) {
  const view = scopeView(project, path);
  return writeScope(project, path, normalizeProject(layoutProject(view)));
}

// Level 3: the converter, then level 2: the motor drive around it.
const converter = group(
  doc,
  ['vdc', 'scale', 'source', 'iout', 'draw', 'sink', 'outGround'],
  'Converter',
);
doc = normalizeProject(syncInstances(converter.project));
const drive = group(doc, [converter.instanceId, 'machine'], 'Motor drive');
doc = normalizeProject(syncInstances(drive.project));
const pack = group(doc, ['cells', 'packGround'], 'Battery pack');
doc = normalizeProject(syncInstances(pack.project));
// Level 1: powertrain and vehicle control.
const powertrain = group(
  doc,
  [pack.instanceId, drive.instanceId, 'gear'],
  'Powertrain',
);
doc = normalizeProject(syncInstances(powertrain.project));
const control = group(doc, ['error', 'pi', 'duty'], 'Vehicle control');
doc = normalizeProject(syncInstances(control.project));

// Battery chemistry: promote the cell data, then two parameter variants.
for (const p of ['Ns', 'Q', 'OCVmax', 'OCVmin', 'Ri'])
  doc = syncInstances(promoteParameter(doc, pack.subsystemId, 'cells', p));
const packPath = [powertrain.instanceId, pack.instanceId];
const drivePath = [powertrain.instanceId, drive.instanceId];
function onSheet(path: string[], edit: (view: Project) => Project) {
  const parent = path.slice(0, -1);
  const view = scopeView(doc, parent);
  doc = normalizeProject(writeScope(doc, parent, edit(view)));
}
const setInstanceValues =
  (id: string, values: Record<string, number>) =>
  (view: Project): Project => ({
    ...view,
    blocks: view.blocks.map((b) =>
      b.id === id
        ? {
            ...b,
            definition: {
              ...b.definition,
              parameters: b.definition.parameters.map((p) => {
                const promoted = findSubsystem(
                  doc,
                  pack.subsystemId,
                )!.parameters!.find((q) => q.id === p.id)!;
                const target = promoted.targets[0].parameterId;
                return target in values ? { ...p, value: values[target] } : p;
              }),
            },
          }
        : b,
    ),
  });
let nmc = '';
onSheet(packPath, (view) => {
  const added = addParameterVariant(view, pack.instanceId, 'NMC')!;
  nmc = added.variantId;
  return setInstanceValues(pack.instanceId, {
    Ns: 28,
    Q: 40,
    OCVmax: 4.2,
    OCVmin: 3.0,
    Ri: 0.003,
  })(added.project);
});
const lfp = variantInstances(doc).find((i) => i.block.id === pack.instanceId)!
  .variants[0].id;
onSheet(packPath, (view) => renameVariant(view, pack.instanceId, lfp, 'LFP'));

// Motor type: a second inside with a simple DC motor and a rotor inertia.
let simple = '';
onSheet(drivePath, (view) => {
  const added = addDiagramVariant(view, drive.instanceId, 'Simple DC motor')!;
  simple = added.variantId;
  return added.project;
});
{
  // Swap the PM DC machine for a simple DC motor plus a rotor inertia, keeping its wires.
  const inside = scopeView(doc, drivePath);
  const machine = inside.blocks.find((b) => b.id === 'machine')!;
  const motor = block('motor', 'motor', 'DC motor', {
    R: 0.05,
    L: 0.0015,
    k: 0.64,
  });
  motor.position = machine.position;
  const rotor = block('rotor', 'rotInertia', 'Rotor inertia', { J: 0.15 });
  rotor.position = { x: machine.position.x + 200, y: machine.position.y };
  const swap: Record<string, [string, string]> = {
    pin_ap: ['motor', 'p'],
    pin_an: ['motor', 'n'],
    flange: ['rotor', 'flange_b'],
  };
  let view: Project = {
    ...inside,
    blocks: [...inside.blocks.filter((b) => b.id !== 'machine'), motor, rotor],
    wires: inside.wires.map((w) => {
      const next = { ...w, waypoints: undefined };
      if (w.source === 'machine')
        [next.source, next.sourceHandle] = swap[w.sourceHandle];
      if (w.target === 'machine')
        [next.target, next.targetHandle] = swap[w.targetHandle];
      return next;
    }),
  };
  view = linkEnds(
    view,
    { id: 'motor', handle: 'flange' },
    { id: 'rotor', handle: 'flange_a' },
  );
  doc = normalizeProject(
    writeScope(doc, drivePath, normalizeProject(layoutProject(view), inside)),
  );
}
const pmdc = variantInstances(doc).find((i) => i.block.id === drive.instanceId)!
  .variants[0].id;
onSheet(drivePath, (view) =>
  renameVariant(view, drive.instanceId, pmdc, 'PM DC machine'),
);

// Configurations: pick both variants together.
onSheet(packPath, (view) => switchVariant(view, pack.instanceId, lfp));
onSheet(drivePath, (view) => switchVariant(view, drive.instanceId, pmdc));
doc = saveConfiguration(doc, 'City · LFP').project;
onSheet(packPath, (view) => switchVariant(view, pack.instanceId, nmc));
onSheet(drivePath, (view) => switchVariant(view, drive.instanceId, simple));
doc = saveConfiguration(doc, 'Performance · NMC').project;
onSheet(packPath, (view) => switchVariant(view, pack.instanceId, lfp));
onSheet(drivePath, (view) => switchVariant(view, drive.instanceId, pmdc));

// Name the subsystem ports for what they carry.
const portNames: Record<string, Record<string, string>> = {
  Converter: { '+': 'dc+', '−': 'dc−', a: 'duty', '−2': 'out+', '0 V': 'out−' },
  'Motor drive': { '+': 'dc+', '−': 'dc−', a: 'duty' },
  'Battery pack': { '0 V': '−' },
  Powertrain: { a: 'duty', b: 'shaft' },
  'Vehicle control': { '+': 'v ref', '−': 'v', out: 'duty' },
};
doc = syncInstances({
  ...doc,
  subsystems: doc.subsystems!.map((sub) => {
    const names =
      portNames[sub.name] ??
      portNames[sub.name.replace(/ Simple DC motor$/, '')] ??
      {};
    return {
      ...sub,
      blocks: sub.blocks.map((b) => {
        const name = b.definition.boundary
          ? names[b.definition.name]
          : undefined;
        return name
          ? (() => {
              const definition = {
                ...b.definition,
                name,
                ports: b.definition.ports.map((p) => ({ ...p, name })),
              };
              return { ...b, definition, size: defaultBlockSize(definition) };
            })()
          : b;
      }),
    };
  }),
});

// Tidy every sheet, and log the vehicle speed.
for (const path of [
  [],
  [control.instanceId],
  [powertrain.instanceId],
  packPath,
  drivePath,
  [...drivePath, converter.instanceId],
])
  doc = tidy(doc, path);
/** Place blocks on a sheet (by ID or name) and redraw its wires: same connectivity, fresh routes. */
function arrange(path: string[], place: Record<string, [number, number]>) {
  const view = scopeView(doc, path);
  let sheet: Project = {
    ...view,
    blocks: view.blocks.map((b) => {
      const at = place[b.id] ?? place[b.definition.name];
      return at ? { ...b, position: { x: at[0], y: at[1] } } : b;
    }),
  };
  const x = (id: string) =>
    sheet.blocks.find((b) => b.id === id)?.position.x ?? 0;
  const ends = netComponents(sheet).map((c) =>
    c
      .filter((k) => !k.startsWith('j:'))
      .map((k) => ({
        id: k.slice(0, k.lastIndexOf('.')),
        handle: k.slice(k.lastIndexOf('.') + 1),
      }))
      .sort((a, b) => x(a.id) - x(b.id)),
  );
  sheet = { ...sheet, wires: [], junctions: [], nets: [] };
  for (const c of ends) {
    const driver = c.find(
      (e) =>
        sheet.blocks
          .find((b) => b.id === e.id)
          ?.definition.ports.find((p) => p.id === e.handle)?.direction ===
        'output',
    );
    for (let i = 1; i < c.length; i++)
      sheet = driver
        ? linkEnds(sheet, driver, c[i] === driver ? c[0] : c[i])
        : linkEnds(sheet, c[i - 1], c[i]);
  }
  doc = normalizeProject(writeScope(doc, path, normalizeProject(sheet, view)));
}
// The top level reads left to right: request, control, powertrain, vehicle; speed feeds back below.
arrange([], {
  request: [40, 120],
  cruise: [220, 120],
  [control.instanceId]: [420, 104],
  [powertrain.instanceId]: [660, 104],
  wheel: [880, 104],
  car: [1100, 120],
  drag: [1300, 120],
  road: [1316, 300],
  speed: [1100, 300],
});
// The pack's terminals face the motor drive.
{
  const inside = scopeView(doc, packPath);
  let view = inside;
  for (const b of inside.blocks.filter((b) => b.definition.kind === 'connport'))
    view = setBoundarySide(view, b.id, 'right');
  // + above −, matching the motor drive's dc+ and dc−.
  view = {
    ...view,
    blocks: view.blocks.map((b) =>
      b.definition.boundary
        ? {
            ...b,
            definition: {
              ...b.definition,
              boundary: {
                ...b.definition.boundary,
                order: b.definition.name === '+' ? 0 : 1,
              },
            },
          }
        : b,
    ),
  };
  doc = normalizeProject(writeScope(doc, packPath, view));
}
arrange(packPath, {
  cells: [120, 96],
  packGround: [136, 280],
  '+': [320, 64],
  '−': [320, 208],
});
arrange([powertrain.instanceId], {
  duty: [40, 288],
  [pack.instanceId]: [40, 104],
  [drive.instanceId]: [280, 104],
  gear: [560, 120],
  shaft: [760, 136],
});
const driveSheet = {
  'dc+': [40, 96],
  'dc−': [40, 168],
  duty: [40, 240],
  [converter.instanceId]: [240, 96],
  machine: [480, 104],
  motor: [480, 104],
  rotor: [680, 104],
  shaft: [880, 120],
} as Record<string, [number, number]>;
// Converter: DC side on the left, the control products below, the output side on the right.
arrange([...drivePath, converter.instanceId], {
  'dc+': [40, 48],
  'dc−': [40, 328],
  duty: [40, 456],
  vdc: [216, 168],
  sink: [392, 168],
  scale: [560, 424],
  draw: [216, 520],
  source: [760, 168],
  iout: [920, 32],
  outGround: [776, 408],
  'out+': [1080, 48],
  'out−': [1080, 328],
});
arrange(drivePath, { ...driveSheet, shaft: [720, 136] });
onSheet(drivePath, (view) => switchVariant(view, drive.instanceId, simple));
arrange(drivePath, driveSheet);
onSheet(drivePath, (view) => switchVariant(view, drive.instanceId, pmdc));
const hide = (nets: Project['nets']) =>
  nets?.map((n) => (n.logged || n.name ? n : { ...n, hidden: true }));
doc = {
  ...doc,
  nets: hide(
    doc.nets?.map((n) =>
      n.anchor === 'speed.v' ? { ...n, name: 'v vehicle', logged: true } : n,
    ),
  ),
  subsystems: doc.subsystems!.map((s) => ({ ...s, nets: hide(s.nets) })),
};
doc = normalizeProject(syncInstances(doc));
doc = {
  ...doc,
  plots: [
    {
      id: 'speed',
      label: 'Vehicle speed',
      series: ['speed.v', 'cruise.y'],
      labels: ['Vehicle speed', 'Speed request'],
    },
  ],
};

writeFileSync('models/examples/ev.json', JSON.stringify(doc, null, 2) + '\n');
// The second configuration as a document, for the engine test of both.
writeFileSync(
  'tests/fixtures/ev-performance.json',
  JSON.stringify(applyConfiguration(doc, doc.configurations![1]), null, 2) +
    '\n',
);
console.log(
  `ev.json: ${doc.subsystems?.length} subsystem definitions, ${variantInstances(doc).length} variant subsystems, ${doc.configurations?.length} configurations`,
);
