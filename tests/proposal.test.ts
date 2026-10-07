import test from 'node:test';
import assert from 'node:assert/strict';
import { GRID } from '../lib/gradara/grid';
import { definitionFor, initialProject, library } from '../lib/gradara/model';
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
