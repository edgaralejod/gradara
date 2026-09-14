import test from 'node:test';
import assert from 'node:assert/strict';
import {
  DocumentStore,
  type SavedDocument,
} from '../lib/gradara/document-store';
import { blankProject } from '../lib/gradara/workspace';
const saved = (id = 'model-a'): SavedDocument => ({
  project: { ...blankProject(), modelId: id },
  saveVersion: 'initial',
});

void test('queued saves use the preceding acknowledgment and immutable snapshots', async () => {
  const calls: { name: string; version: string | null }[] = [];
  let finish!: () => void;
  const barrier = new Promise<void>((resolve) => {
    finish = resolve;
  });
  const store = new DocumentStore(async (project, version) => {
    calls.push({ name: project.name, version });
    if (calls.length === 1) await barrier;
    return { project, saveVersion: `v${calls.length}` };
  });
  const original = saved();
  store.remember(original);
  const first = { ...original.project, name: 'First edit' };
  const pending = store.save(first);
  first.name = 'Mutation after enqueue';
  const latest = { ...original.project, name: 'Second edit' };
  const next = store.save(latest);
  await Promise.resolve();
  await Promise.resolve();
  assert.equal(calls.length, 1);
  finish();
  await Promise.all([pending, next]);
  assert.deepEqual(calls, [
    { name: 'First edit', version: 'initial' },
    { name: 'Second edit', version: 'v1' },
  ]);
  assert.ok(store.isSaved(latest));
  assert.ok(!store.isSaved(first));
});

void test('a failed save stays unsaved and retry keeps its original version', async () => {
  const versions: (string | null)[] = [];
  const store = new DocumentStore(async (project, version) => {
    versions.push(version);
    if (versions.length === 1) throw new Error('Service disconnected');
    return { project, saveVersion: 'recovered' };
  });
  const original = saved();
  store.remember(original);
  const edits = { ...original.project, name: 'Keep these edits' };
  await assert.rejects(store.save(edits), /disconnected/);
  assert.ok(!store.isSaved(edits));
  await store.save(edits);
  assert.deepEqual(versions, ['initial', 'initial']);
  assert.ok(store.isSaved(edits));
});

void test('acknowledgments and versions belong to their own document across switching', async () => {
  const calls: (string | null)[] = [];
  const store = new DocumentStore(async (project, version) => {
    calls.push(version);
    return { project, saveVersion: project.modelId! };
  });
  const a = saved(),
    b = { ...saved('model-b'), saveVersion: 'b-original' };
  store.remember(a);
  store.remember(b);
  const a2 = { ...a.project, name: 'Edited A' },
    b2 = { ...b.project, name: 'Edited B' };
  await Promise.all([store.save(a2), store.save(b2)]);
  await store.save(b2); // Flushing a saved model must not create another network write.
  assert.deepEqual(calls, ['initial', 'b-original']);
  assert.ok(store.isSaved(a2) && store.isSaved(b2));
});

void test('recovered edits retain their old version so a conflict cannot overwrite newer disk work', async () => {
  const store = new DocumentStore(async (_project, version) => {
    assert.equal(version, 'old-draft-version');
    throw new Error('Conflict');
  });
  const current = saved();
  store.remember(current);
  const draft = {
    project: { ...current.project, name: 'Recovered' },
    saveVersion: 'old-draft-version',
  };
  store.recover(draft);
  await assert.rejects(store.save(draft.project), /Conflict/);
  assert.ok(!store.isSaved(draft.project));
  assert.equal(store.draft(draft.project).saveVersion, 'old-draft-version');
});
