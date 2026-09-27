import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import type { Project } from '../lib/gradara/model';
import { netComponents } from '../lib/gradara/net';
import { normalizeProject } from '../lib/gradara/normalize-project';
import {
  breadcrumb,
  groupIntoSubsystem,
  instancePorts,
  makeUnique,
  scopeView,
  subsystemsOf,
  syncInstances,
  ungroupSubsystem,
  usageCount,
  writeScope,
} from '../lib/gradara/hierarchy';

const example = (name: string): Project =>
  normalizeProject(JSON.parse(readFileSync(`models/examples/${name}.json`, 'utf8')) as Project);

/** Connectivity as sets of block terminals, independent of junctions and wire records. */
function connectivity(p: Project) {
  return netComponents(p)
    .map((c) => c.filter((k) => !k.startsWith('j:')).sort().join(' '))
    .filter(Boolean)
    .sort();
}

void test('grouping cuts nets into typed ports and keeps connectivity', () => {
  const dc = example('dc');
  const grouped = groupIntoSubsystem(dc, ['controller', 'drive'], 'Drive')!;
  const doc = syncInstances(normalizeProject(grouped.project, dc));
  assert.equal(doc.version, 2);
  const sub = subsystemsOf(doc)[0];
  const ports = instancePorts(sub);
  const kinds = ports.map((p) => `${p.direction}:${p.domain}`).sort();
  assert.deepEqual(kinds, ['input:signal', 'input:signal', 'physical:electrical', 'physical:electrical']);
  const instance = doc.blocks.find((b) => b.id === grouped.instanceId)!;
  assert.equal(instance.definition.subsystem?.ref, sub.id);
  assert.ok(!doc.blocks.some((b) => b.id === 'controller'));
  const back = ungroupSubsystem(doc, grouped.instanceId)!;
  assert.deepEqual(connectivity(back.project), connectivity(dc));
});

void test('grouping inside a subsystem nests, and scope edits update every instance', () => {
  const dc = example('dc');
  const first = groupIntoSubsystem(dc, ['controller', 'drive', 'reference'], 'Control')!;
  const doc = syncInstances(normalizeProject(first.project, dc));
  const path = [first.instanceId];
  const inside = scopeView(doc, path);
  assert.ok(inside.blocks.some((b) => b.id === 'controller'));
  const nested = groupIntoSubsystem(inside, ['controller'], 'PI')!;
  const written = writeScope(doc, path, normalizeProject(nested.project, inside));
  assert.equal(subsystemsOf(written).length, 2);
  assert.deepEqual(
    breadcrumb(written, [...path, nested.instanceId]).map((c) => c.name),
    [dc.name, 'Control', 'PI'],
  );
  // Rename a boundary block inside: the instance port follows.
  const view = scopeView(written, path);
  const boundary = view.blocks.find((b) => b.definition.kind === 'connport')!;
  const renamed = writeScope(written, path, {
    ...view,
    blocks: view.blocks.map((b) =>
      b.id === boundary.id ? { ...b, definition: { ...b.definition, name: 'Vbus' } } : b,
    ),
  });
  const instance = renamed.blocks.find((b) => b.id === first.instanceId)!;
  assert.equal(instance.definition.ports.find((p) => p.id === boundary.id)?.name, 'Vbus');
  // Remove it: the outside wire to that port goes with it.
  const removed = writeScope(renamed, path, {
    ...view,
    blocks: view.blocks.filter((b) => b.id !== boundary.id),
    wires: view.wires.filter((w) => w.source !== boundary.id && w.target !== boundary.id),
  });
  assert.ok(!removed.wires.some((w) => w.targetHandle === boundary.id || w.sourceHandle === boundary.id));
});

void test('copies share a definition until made unique; unused definitions disappear', () => {
  const dc = example('dc');
  const grouped = groupIntoSubsystem(dc, ['controller'], 'PI')!;
  let doc = syncInstances(grouped.project);
  const instance = doc.blocks.find((b) => b.id === grouped.instanceId)!;
  doc = syncInstances({ ...doc, blocks: [...doc.blocks, { ...structuredClone(instance), id: 'copy' }] });
  assert.equal(usageCount(doc, grouped.subsystemId), 2);
  doc = syncInstances(makeUnique(doc, 'copy'));
  assert.equal(subsystemsOf(doc).length, 2);
  assert.equal(usageCount(doc, grouped.subsystemId), 1);
  doc = syncInstances({ ...doc, blocks: doc.blocks.filter((b) => !b.definition.subsystem) });
  assert.equal(doc.version, 1);
  assert.equal(doc.subsystems, undefined);
});

void test('a flat document passes through unchanged', () => {
  const dc = example('dc');
  assert.equal(syncInstances(dc), dc);
  assert.equal(scopeView(dc, []), dc);
});

void test('a promoted parameter appears on every instance, which keeps its own value', async () => {
  const { promoteParameter, demoteParameter } = await import('../lib/gradara/hierarchy');
  const dc = example('dc');
  const grouped = groupIntoSubsystem(dc, ['controller'], 'PI')!;
  let doc = syncInstances(grouped.project);
  doc = syncInstances(promoteParameter(doc, grouped.subsystemId, 'controller', 'kp'));
  const instance = () => doc.blocks.find((b) => b.id === grouped.instanceId)!;
  const kp = instance().definition.parameters[0];
  assert.equal(kp.value, 0.6);
  doc = syncInstances({
    ...doc,
    blocks: doc.blocks.map((b) =>
      b.id === grouped.instanceId
        ? { ...b, definition: { ...b.definition, parameters: [{ ...kp, value: 1.5 }] } }
        : b,
    ),
  });
  assert.equal(instance().definition.parameters[0].value, 1.5);
  doc = syncInstances(demoteParameter(doc, grouped.subsystemId, kp.id));
  assert.deepEqual(instance().definition.parameters, []);
});
