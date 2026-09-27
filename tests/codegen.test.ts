import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import type { Project } from '../lib/gradara/model';
import { normalizeProject } from '../lib/gradara/normalize-project';
import { groupIntoSubsystem, scopeView } from '../lib/gradara/hierarchy';
import {
  defaultPrefix,
  detectController,
  selectionUnit,
} from '../lib/gradara/codegen';

const example = (name: string): Project =>
  normalizeProject(
    JSON.parse(readFileSync(`models/examples/${name}.json`, 'utf8')) as Project,
  );

void test('detects the controller between measurements and actuators', () => {
  assert.deepEqual(detectController(example('dc')), {
    kind: 'selection',
    blockIds: ['controller'],
  });
  const foc = detectController(example('foc'));
  assert.equal(foc?.kind, 'selection');
  const ids = foc?.kind === 'selection' ? foc.blockIds : [];
  // The whole cascade, but neither the reference source nor the inverter and motor models.
  for (const id of [
    'speedError',
    'qPI',
    'dPI',
    'park',
    'clarke',
    'inverse',
    'dReference',
  ])
    assert.ok(ids.includes(id), id);
  for (const id of ['reference', 'inverter', 'motor', 'load'])
    assert.ok(!ids.includes(id), id);
  assert.equal(detectController(example('buck')), null);
});

void test('a grouped controller is detected as its subsystem', () => {
  const dc = example('dc');
  const grouped = groupIntoSubsystem(dc, ['controller'], 'Speed control')!;
  const view = scopeView(grouped.project, []);
  const unit = detectController(view);
  assert.deepEqual(unit, { kind: 'instance', instanceId: grouped.instanceId });
  assert.equal(defaultPrefix(view, unit!), 'speed_control');
  assert.deepEqual(selectionUnit(view, [grouped.instanceId]), unit);
});
