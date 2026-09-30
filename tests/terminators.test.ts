import test from 'node:test';
import assert from 'node:assert/strict';
import { definitionFor, type Project } from '../lib/gradara/model';
import { normalizeProject } from '../lib/gradara/normalize-project';
import { linkEnds } from '../lib/gradara/project';
import {
  removeTerminators,
  settleTerminators,
  terminateOpenOutputs,
} from '../lib/gradara/terminators';

const sheet = (): Project => ({
  version: 1,
  name: 't',
  duration: 1,
  revision: 0,
  blocks: [
    {
      id: 'src',
      definition: structuredClone(definitionFor('sine')!),
      position: { x: 0, y: 0 },
    },
    {
      id: 'split',
      definition: structuredClone(definitionFor('demux')!),
      position: { x: 200, y: 0 },
    },
    {
      id: 'k',
      definition: structuredClone(definitionFor('gain')!),
      position: { x: 400, y: 0 },
    },
  ],
  wires: [],
});

void test('terminating caps only the open outputs of the selected blocks', () => {
  const p = linkEnds(
    sheet(),
    { id: 'split', handle: 'y1' },
    { id: 'k', handle: 'u' },
  );
  const capped = terminateOpenOutputs(p, ['split']);
  assert.deepEqual(capped.blocks.find((b) => b.id === 'split')!.terminated, [
    'y2',
    'y3',
  ]);
  assert.equal(
    capped.blocks.find((b) => b.id === 'src')!.terminated,
    undefined,
  );
  assert.equal(terminateOpenOutputs(capped, ['split']), capped);
  const cleared = removeTerminators(capped, ['split']);
  assert.ok(!('terminated' in cleared.blocks.find((b) => b.id === 'split')!));
});

void test('a wire to a terminated output removes its mark', () => {
  const capped = terminateOpenOutputs(sheet(), ['src']);
  assert.deepEqual(capped.blocks[0].terminated, ['y']);
  const wired = normalizeProject(
    linkEnds(capped, { id: 'src', handle: 'y' }, { id: 'k', handle: 'u' }),
  );
  assert.equal(wired.blocks.find((b) => b.id === 'src')!.terminated, undefined);
  // A mark on a port that no longer exists goes too.
  const stale = {
    ...capped,
    blocks: capped.blocks.map((b) => ({ ...b, terminated: ['gone'] })),
  };
  assert.ok(settleTerminators(stale).blocks.every((b) => !b.terminated));
});
