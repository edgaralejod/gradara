import test from 'node:test';
import assert from 'node:assert/strict';
import { initialProject, library } from '../lib/gradara/model';
import {
  countBySeverity,
  validateProject,
} from '../lib/gradara/validate-project';

void test('a complete model has no live problems', () => {
  assert.deepEqual(validateProject(initialProject()), []);
});

void test('an unconnected signal input names its block and port', () => {
  const p = initialProject();
  const wire = p.wires.find(
    (w) => w.target === 'controller' && w.targetHandle === 'measured',
  )!;
  const problems = validateProject({
    ...p,
    wires: p.wires.filter((w) => w !== wire),
  });
  const [input] = problems.filter((d) => d.id.startsWith('v-input'));
  assert.equal(input.severity, 'error');
  assert.equal(input.source, 'validation');
  assert.deepEqual(input.ports, [
    { blockId: 'controller', portId: 'measured' },
  ]);
  assert.match(input.message, /is not connected/);
});

void test('a wire to a missing port is an error and an isolated block is info', () => {
  const p = initialProject();
  const gain = structuredClone(library.find((d) => d.kind === 'gain')!);
  const problems = validateProject({
    ...p,
    blocks: [
      ...p.blocks,
      { id: 'lonely', definition: gain, position: { x: 0, y: 0 } },
    ],
    wires: [{ ...p.wires[0], id: 'stale', targetHandle: 'gone' }, ...p.wires],
  });
  const stale = problems.find((d) => d.wireIds.includes('stale'))!;
  assert.equal(stale.severity, 'error');
  const lonely = problems.filter((d) => d.blockIds.includes('lonely'));
  assert.ok(lonely.some((d) => d.severity === 'info'));
  assert.ok(lonely.some((d) => d.id.startsWith('v-input')));
  const counts = countBySeverity(problems);
  assert.equal(counts.info, 1);
  assert.ok(counts.error >= 2);
});

void test('drawing-only blocks are reported', () => {
  const p = initialProject();
  const mux = structuredClone(library.find((d) => d.kind === 'mux')!);
  const problems = validateProject({
    ...p,
    blocks: [...p.blocks, { id: 'm', definition: mux, position: { x: 0, y: 0 } }],
  });
  assert.ok(problems.some((d) => d.id === 'v-drawing-m'));
});
