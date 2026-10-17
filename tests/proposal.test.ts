import test from 'node:test';
import assert from 'node:assert/strict';
import { defaultBlockSize } from '../lib/gradara/block-design';
import { GRID } from '../lib/gradara/grid';
import { groupIntoSubsystem, isBoundary } from '../lib/gradara/hierarchy';
import { definitionFor, initialProject } from '../lib/gradara/model';
import { portPoint } from '../lib/gradara/ports';
import { mergeProposal } from '../lib/gradara/proposal';

function proposalFrom(p: ReturnType<typeof initialProject>) {
  // What the server returns: a validated copy where empty routes are explicit.
  return structuredClone({
    ...p,
    wires: p.wires.map((w) => ({ ...w, waypoints: w.waypoints ?? [] })),
  });
}

void test('untouched blocks and wires keep their exact objects', () => {
  const current = initialProject();
  current.wires[0] = { ...current.wires[0], waypoints: undefined };
  const { project, added, changed } = mergeProposal(
    current,
    proposalFrom(current),
  );
  assert.deepEqual(added, []);
  assert.deepEqual(changed, []);
  project.blocks.forEach((b, i) => assert.equal(b, current.blocks[i]));
  project.wires.forEach((w, i) => assert.equal(w, current.wires[i]));
  assert.equal(project.wires[0].waypoints, undefined);
});

void test('a new block is snapped with a standard size and a new wire has no route', () => {
  const current = initialProject();
  const proposed = proposalFrom(current);
  const scope = structuredClone(definitionFor('scope')!);
  proposed.blocks.push({
    id: 'b_scope',
    definition: scope,
    position: { x: 1213, y: 407 },
  });
  proposed.wires.push({
    id: 'w_ai_1',
    source: 'sensor',
    sourceHandle: 'y',
    target: 'b_scope',
    targetHandle: scope.ports[0].id,
    waypoints: [],
  });
  const { project, added } = mergeProposal(current, proposed);
  assert.deepEqual(added, ['b_scope']);
  const block = project.blocks.find((b) => b.id === 'b_scope')!;
  assert.ok(block.size);
  assert.equal(block.position.x % GRID, 0);
  const wire = project.wires.find((w) => w.id === 'w_ai_1')!;
  assert.equal('waypoints' in wire, false);
});

void test('definition changes, removals, name, and stop time come from the proposal', () => {
  const current = initialProject();
  const proposed = proposalFrom(current);
  const controller = proposed.blocks.find((b) => b.id === 'controller')!;
  controller.definition.parameters[0].value = 9;
  controller.position = { x: 9999, y: 9999 };
  proposed.blocks = proposed.blocks.filter((b) => b.id !== 'sensor');
  proposed.wires = proposed.wires.filter(
    (w) => w.source !== 'sensor' && w.target !== 'sensor',
  );
  proposed.duration = 7;
  proposed.name = 'Edited';
  const { project, changed } = mergeProposal(current, proposed);
  assert.deepEqual(changed, ['controller']);
  const merged = project.blocks.find((b) => b.id === 'controller')!;
  assert.equal(merged.definition.parameters[0].value, 9);
  assert.deepEqual(
    merged.position,
    current.blocks.find((b) => b.id === 'controller')!.position,
  );
  assert.ok(!project.blocks.some((b) => b.id === 'sensor'));
  assert.equal(project.duration, 7);
  assert.equal(project.name, 'Edited');
  assert.equal(project.modelId, current.modelId);
});

void test('a net the proposal logs is logged, and the nets of new wires come along', () => {
  const current = initialProject();
  current.nets = [
    { id: 'n1', anchor: 'sensor.y', wireIds: [current.wires[0].id], name: 'speed' },
  ];
  const proposed = proposalFrom(current);
  proposed.nets = [
    { id: 'n1', anchor: 'sensor.y', wireIds: [current.wires[0].id], logged: true },
    { id: 'net_ai_1', anchor: 'sensor.y', wireIds: ['w_ai_1'], hidden: true },
  ];
  proposed.wires.push({
    id: 'w_ai_1',
    source: current.wires[1].source,
    sourceHandle: current.wires[1].sourceHandle,
    target: current.wires[1].target,
    targetHandle: current.wires[1].targetHandle,
    waypoints: [],
  });
  const { project } = mergeProposal(current, proposed);
  const net = project.nets!.find((n) => n.id === 'n1')!;
  assert.equal(net.logged, true);
  assert.equal(net.name, 'speed'); // the user's name is kept
  assert.ok(project.nets!.some((n) => n.id === 'net_ai_1'));
});

/** What the server returns for group_into_subsystem: the workbench grouping, with its own IDs and no instance size. */
function groupedProposal(current: ReturnType<typeof initialProject>, ids: string[]) {
  const grouped = groupIntoSubsystem(current, ids, 'Motor stage')!;
  const proposed = proposalFrom(grouped.project);
  const instance = proposed.blocks.find((b) => b.id === grouped.instanceId)!;
  delete instance.size;
  return { proposed, instanceId: grouped.instanceId, subsystemId: grouped.subsystemId };
}

void test("a grouping adopts the new definition with the user's own blocks inside and the instance where the server put it", () => {
  const current = initialProject();
  current.blocks = current.blocks.map((b) =>
    b.id === 'controller'
      ? { ...b, size: { width: 160, height: 128 }, rotation: 90 as const, logged: ['y'] }
      : b,
  );
  current.wires[1] = { ...current.wires[1], waypoints: [{ x: 400, y: 100 }] };
  const { proposed, instanceId, subsystemId } = groupedProposal(current, ['controller', 'drive', 'motor']);
  const { project, added } = mergeProposal(current, proposed, { tidy: false });
  assert.equal(project.version, 2);
  assert.ok(added.includes(instanceId));
  const definition = project.subsystems!.find((s) => s.id === subsystemId)!;
  assert.equal(definition.name, 'Motor stage');
  // Inner blocks and kept inner wires are the user's objects, size, rotation, log marks and routes included.
  const controller = definition.blocks.find((b) => b.id === 'controller')!;
  assert.equal(controller, current.blocks.find((b) => b.id === 'controller'));
  assert.deepEqual(controller.size, { width: 160, height: 128 });
  assert.equal(controller.rotation, 90);
  assert.deepEqual(controller.logged, ['y']);
  assert.equal(definition.wires.find((w) => w.id === 'wire1'), current.wires[1]);
  // The grouped blocks left the top level; the instance stands where the server put it, at standard size.
  assert.ok(!project.blocks.some((b) => ['controller', 'drive', 'motor'].includes(b.id)));
  const instance = project.blocks.find((b) => b.id === instanceId)!;
  const server = proposed.blocks.find((b) => b.id === instanceId)!;
  assert.deepEqual(instance.position, server.position);
  assert.deepEqual(instance.size, defaultBlockSize(instance.definition));
  // Outer wires keep their IDs and now end on the instance.
  const wire0 = project.wires.find((w) => w.id === 'wire0')!;
  assert.equal(wire0.target, instanceId);
});

void test('a grouping places its port pills in line with what they feed, at standard size', () => {
  const current = initialProject();
  const { proposed, subsystemId } = groupedProposal(current, ['controller', 'drive', 'motor']);
  // The server's pill positions are rough: put them somewhere wrong.
  for (const s of proposed.subsystems!)
    for (const b of s.blocks)
      if (isBoundary(b)) {
        b.position = { x: 5000, y: 5000 };
        delete b.size;
      }
  const { project } = mergeProposal(current, proposed, { tidy: false });
  const definition = project.subsystems!.find((s) => s.id === subsystemId)!;
  const pills = definition.blocks.filter(isBoundary);
  assert.equal(pills.length, 4);
  for (const pill of pills) {
    assert.deepEqual(pill.size, defaultBlockSize(pill.definition));
    const wire = definition.wires.find((w) => w.source === pill.id || w.target === pill.id)!;
    const [otherId, handle] =
      wire.source === pill.id ? [wire.target, wire.targetHandle] : [wire.source, wire.sourceHandle];
    const other = definition.blocks.find((b) => b.id === otherId)!;
    const at = portPoint(other, handle)!;
    const own = portPoint(pill, pill.definition.ports[0].id)!;
    const centre = { x: pill.position.x + pill.size!.width / 2, y: pill.position.y + pill.size!.height / 2 };
    // Level with a side port, or centred under or over a top or bottom one, a short run away.
    const [along, across] =
      at.side === 'left' || at.side === 'right' ? [own.y - at.y, own.x - at.x] : [centre.x - at.x, centre.y - at.y];
    assert.equal(along, 0, `${pill.definition.name} is in line with ${otherId}.${handle}`);
    assert.ok(Math.abs(across) <= 96 + pill.size!.height, `${pill.definition.name} sits a short run away`);
  }
});

void test('a grouping is tidied where that helps and stays one valid document', () => {
  const current = initialProject();
  const { proposed, instanceId, subsystemId } = groupedProposal(current, ['controller', 'drive', 'motor']);
  const { project } = mergeProposal(current, proposed);
  const definition = project.subsystems!.find((s) => s.id === subsystemId)!;
  const ids = new Set([...definition.blocks.map((b) => b.id), ...(definition.junctions ?? []).map((j) => j.id)]);
  assert.ok(definition.wires.every((w) => ids.has(w.source) && ids.has(w.target)));
  assert.equal(new Set(definition.blocks.filter(isBoundary).map((b) => b.definition.name)).size, 4);
  const top = new Set([...project.blocks.map((b) => b.id), ...(project.junctions ?? []).map((j) => j.id)]);
  assert.ok(project.wires.every((w) => top.has(w.source) && top.has(w.target)));
  assert.ok(project.blocks.some((b) => b.id === instanceId && b.size));
  // No two blocks on either sheet overlap.
  for (const sheet of [project, definition])
    for (const a of sheet.blocks)
      for (const b of sheet.blocks)
        if (a.id < b.id)
          assert.ok(
            a.position.x + a.size!.width <= b.position.x ||
              b.position.x + b.size!.width <= a.position.x ||
              a.position.y + a.size!.height <= b.position.y ||
              b.position.y + b.size!.height <= a.position.y,
            `${a.id} and ${b.id} do not overlap`,
          );
});

void test('an existing definition is never replaced by a proposal', () => {
  const current = initialProject();
  const { proposed, subsystemId } = groupedProposal(current, ['controller', 'drive', 'motor']);
  const applied = mergeProposal(current, proposed).project;
  const again = structuredClone(applied);
  again.subsystems![0].name = 'Renamed by the server';
  again.subsystems![0].blocks = again.subsystems![0].blocks.slice(1);
  const { project } = mergeProposal(applied, again);
  assert.equal(project.subsystems!.find((s) => s.id === subsystemId)!.name, 'Motor stage');
  assert.equal(project.subsystems!.length, 1);
});

// A proposal made inside a subsystem: the workbench opens that sheet and merges the
// proposal's view of it, so the inside changes and the top level keeps its objects.

void test('a proposal for a subsystem sheet merges into that sheet only', async () => {
  const { readFileSync } = await import('node:fs');
  const { scopeView, writeScope, sheetLabel, findSubsystem } = await import(
    '../lib/gradara/hierarchy'
  );
  const doc = JSON.parse(
    readFileSync('tests/fixtures/grouped-dc.json', 'utf8'),
  ) as ReturnType<typeof initialProject>;
  const path = ['b_grp000e', 'b_grp0002'];
  assert.deepEqual(sheetLabel(doc, path), { name: 'Power stage', copies: 1 });
  assert.equal(sheetLabel(doc, []), undefined);
  assert.equal(sheetLabel(doc, ['b_grp000e', 'gone']), undefined);
  const proposed = structuredClone(doc);
  const motor = findSubsystem(proposed, 'sub_grp0001')!.blocks.find(
    (b) => b.id === 'motor',
  )!;
  motor.definition.parameters.find((p) => p.id === 'Ra')!.value = 0.25;
  const view = scopeView(doc, path);
  const { project, added, changed } = mergeProposal(
    view,
    scopeView(proposed, path),
  );
  assert.deepEqual(added, []);
  assert.deepEqual(changed, ['motor']);
  const next = writeScope(doc, path, project);
  const inner = findSubsystem(next, 'sub_grp0001')!;
  assert.equal(
    inner.blocks
      .find((b) => b.id === 'motor')!
      .definition.parameters.find((p) => p.id === 'Ra')!.value,
    0.25,
  );
  // Everything else inside keeps its objects, and the top level is untouched.
  const before = findSubsystem(doc, 'sub_grp0001')!;
  for (const b of inner.blocks.filter((b) => b.id !== 'motor'))
    assert.equal(b, before.blocks.find((x) => x.id === b.id));
  assert.deepEqual(next.blocks, doc.blocks);
});
