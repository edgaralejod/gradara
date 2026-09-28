import test from 'node:test';
import assert from 'node:assert/strict';
import { initialProject, library, type Project } from '../lib/gradara/model';
import { normalizeProject } from '../lib/gradara/normalize-project';
import {
  boundaryBlocks,
  findSubsystem,
  hierarchyTree,
  scopeView,
  writeScope,
} from '../lib/gradara/hierarchy';
import {
  addInstancePort,
  editInstancePort,
  editPort,
  instancePortBlocks,
  portSummary,
  removeInstancePort,
} from '../lib/gradara/subsystem-ports';
import { linkEnds } from '../lib/gradara/project';
import { NetSession } from '../lib/gradara/net-session';
import { bodyOf } from '../lib/gradara/router';

const def = (kind: string) =>
  structuredClone(library.find((d) => d.kind === kind)!);

/** A step at the left and a library Subsystem (in1 → out1) to its right. */
function withSubsystem(kind = 'subsystem'): Project {
  return normalizeProject({
    ...initialProject(),
    name: 'Ports',
    blocks: [
      { id: 'step', definition: def('step'), position: { x: 0, y: 40 } },
      { id: 'sub', definition: def(kind), position: { x: 240, y: 20 } },
    ],
    wires: [],
    junctions: [],
  });
}
const sub = (p: Project) => p.blocks.find((b) => b.id === 'sub')!;
const inside = (p: Project) =>
  findSubsystem(p, sub(p).definition.subsystem!.ref)!;
const summaries = (p: Project) => boundaryBlocks(inside(p)).map(portSummary);

void test('a library Subsystem is in1 wired to out1, each numbered 1', () => {
  const p = withSubsystem();
  assert.deepEqual(
    summaries(p).map((s) => [s.kind, s.name, s.number]),
    [
      ['inport', 'in1', 1],
      ['outport', 'out1', 1],
    ],
  );
  assert.equal(inside(p).wires.length, 1);
  assert.deepEqual(
    sub(p).definition.ports.map((x) => [x.direction, x.side]),
    [
      ['input', 'left'],
      ['output', 'right'],
    ],
  );
});

void test('an empty subsystem has no ports and nothing inside', () => {
  const p = withSubsystem('emptySubsystem');
  assert.equal(sub(p).definition.kind, 'subsystem');
  assert.equal(sub(p).definition.ports.length, 0);
  assert.equal(inside(p).blocks.length, 0);
});

void test('ports added from outside are numbered per kind and placed inside', () => {
  let p = withSubsystem('emptySubsystem');
  p = addInstancePort(p, 'sub', { kind: 'inport' }).project;
  p = addInstancePort(p, 'sub', { kind: 'inport' }).project;
  p = addInstancePort(p, 'sub', { kind: 'outport' }).project;
  const t = addInstancePort(p, 'sub', {
    kind: 'connport',
    domain: 'mechanical',
    side: 'right',
  });
  p = normalizeProject(t.project, p);
  assert.deepEqual(
    summaries(p).map((s) => [s.kind, s.name, s.number, s.side, s.domain]),
    [
      ['inport', 'in1', 1, 'left', 'signal'],
      ['inport', 'in2', 2, 'left', 'signal'],
      ['outport', 'out1', 1, 'right', 'signal'],
      ['connport', 'terminal1', 1, 'right', 'mechanical'],
    ],
  );
  const port = sub(p).definition.ports.find((x) => x.id === t.portId)!;
  assert.equal(port.direction, 'physical');
  assert.equal(port.side, 'right');
  // Inputs sit left of outputs inside.
  const pills = boundaryBlocks(inside(p));
  assert.ok(pills[0].position.x < pills[2].position.x);
});

void test('renumbering an input moves it on the block; removing one renumbers the rest', () => {
  let p = withSubsystem('emptySubsystem');
  for (let i = 0; i < 3; i++)
    p = addInstancePort(p, 'sub', { kind: 'inport' }).project;
  const [a, , c] = summaries(p);
  p = editInstancePort(p, 'sub', c.id, { number: 1 });
  assert.deepEqual(
    summaries(p).map((s) => s.name),
    ['in3', 'in1', 'in2'],
  );
  assert.deepEqual(
    sub(p).definition.ports.map((x) => x.name),
    ['in3', 'in1', 'in2'],
  );
  p = removeInstancePort(p, 'sub', a.id);
  assert.deepEqual(
    summaries(p).map((s) => [s.name, s.number]),
    [
      ['in3', 1],
      ['in2', 2],
    ],
  );
});

void test('renaming keeps port names unique', () => {
  let p = withSubsystem();
  const [input] = summaries(p);
  p = editInstancePort(p, 'sub', input.id, { name: 'out1' });
  assert.equal(summaries(p)[0].name, 'out12');
  p = editInstancePort(p, 'sub', input.id, { name: 'speed ref' });
  assert.equal(sub(p).definition.ports[0].name, 'speed ref');
});

void test('changing a port type or domain removes its wires on both sides', () => {
  let p = withSubsystem();
  const [input] = summaries(p);
  p = linkEnds(p, { id: 'step', handle: 'y' }, { id: 'sub', handle: input.id });
  assert.equal(p.wires.length, 1);
  p = editInstancePort(p, 'sub', input.id, { kind: 'connport' });
  assert.equal(p.wires.length, 0, 'outside wire removed');
  assert.equal(inside(p).wires.length, 0, 'inside wire removed');
  assert.equal(
    sub(p).definition.ports.find((x) => x.id === input.id)!.direction,
    'physical',
  );
});

void test('editing a pill inside and writing the sheet back drops stale outside wires', () => {
  let doc = withSubsystem();
  const [input] = summaries(doc);
  doc = linkEnds(
    doc,
    { id: 'step', handle: 'y' },
    { id: 'sub', handle: input.id },
  );
  const view = scopeView(doc, ['sub']);
  const edited = editPort(view, input.id, { domain: 'boolean' });
  doc = writeScope(doc, ['sub'], edited);
  assert.equal(doc.wires.length, 0);
  assert.equal(
    sub(doc).definition.ports.find((x) => x.id === input.id)!.domain,
    'boolean',
  );
});

void test('a fresh terminal takes the domain of what it is wired to', () => {
  let doc = withSubsystem('emptySubsystem');
  const t = addInstancePort(doc, 'sub', { kind: 'connport' });
  doc = t.project;
  let view = scopeView(doc, ['sub']);
  view = {
    ...view,
    blocks: [
      ...view.blocks,
      { id: 'j', definition: def('inertia'), position: { x: 300, y: 80 } },
    ],
  };
  const flange = view.blocks.find((b) => b.id === 'j')!.definition.ports[0];
  view = linkEnds(
    view,
    { id: t.portId, handle: 'p' },
    { id: 'j', handle: flange.id },
  );
  assert.equal(view.wires.length, 1);
  doc = writeScope(doc, ['sub'], view);
  assert.equal(
    sub(doc).definition.ports.find((x) => x.id === t.portId)!.domain,
    flange.domain,
  );
});

void test('dropping a wire on a subsystem block adds a port there', () => {
  const p = withSubsystem('emptySubsystem');
  const s = new NetSession(p);
  s.pressPort('step', 'y');
  const body = bodyOf(sub(p));
  const at = { x: body.x + body.width / 2, y: body.y + body.height / 2 };
  s.move(at.x, at.y);
  assert.equal(s.target?.newPort?.kind, 'inport');
  s.release(at);
  assert.equal(s.mode, 'idle');
  const q = s.project;
  assert.equal(q.wires.length, 1);
  const ports = sub(q).definition.ports;
  assert.equal(ports.length, 1);
  assert.equal(ports[0].direction, 'input');
  assert.equal(q.wires[0].target, 'sub');
  assert.equal(q.wires[0].targetHandle, ports[0].id);
  assert.equal(instancePortBlocks(q, sub(q)).length, 1);
});

void test('the hierarchy tree lists nested subsystems under the top level', () => {
  const p = withSubsystem();
  const tree = hierarchyTree(p);
  assert.deepEqual(tree.path, []);
  assert.deepEqual(
    tree.children.map((c) => [c.path, c.name]),
    [[['sub'], 'Subsystem']],
  );
});
