import assert from 'node:assert/strict';
import test from 'node:test';
import { clampSize, dialogSize, moveDivider } from '../lib/gradara/pane-sizes';

const near = (a: number[], b: number[]) =>
  assert.ok(a.length === b.length && a.every((v, i) => Math.abs(v - b[i]) < 1e-9), `${a.join(',')} vs ${b.join(',')}`);

void test('moving a divider shifts space between its two neighbours only', () => {
  near(moveDivider([0.25, 0.25, 0.5], 0, 0.1), [0.35, 0.15, 0.5]);
  near(moveDivider([0.25, 0.25, 0.5], 1, -0.1), [0.25, 0.15, 0.6]);
});

void test('no pane shrinks below the minimum, and the total stays one', () => {
  near(moveDivider([0.5, 0.5], 0, 0.9, 0.12), [0.88, 0.12]);
  near(moveDivider([0.5, 0.5], 0, -0.9, 0.12), [0.12, 0.88]);
  const out = moveDivider([0.2, 0.3, 0.5], 0, 0.7);
  assert.ok(Math.abs(out.reduce((t, v) => t + v, 0) - 1) < 1e-9);
});

void test('a divider that does not exist changes nothing', () => {
  assert.deepEqual(moveDivider([1], 0, 0.3), [1]);
  assert.deepEqual(moveDivider([0.5, 0.5], 1, 0.3), [0.5, 0.5]);
  assert.deepEqual(moveDivider([0.5, 0.5], -1, 0.3), [0.5, 0.5]);
});

void test('sizes are kept inside their limits', () => {
  assert.equal(clampSize(10, 60, 400), 60);
  assert.equal(clampSize(900, 60, 400), 400);
  assert.equal(clampSize(200.4, 60, 400), 200);
  assert.equal(clampSize(Number.NaN, 60, 400), 60);
  // A window smaller than the minimum cannot push the size under it.
  assert.equal(clampSize(300, 320, 200), 320);
});

void test('a centred dialog changes by twice the pointer travel so the edge follows it', () => {
  assert.equal(dialogSize(500, 40, 'far', 300, 1000), 580);
  assert.equal(dialogSize(500, 40, 'near', 300, 1000), 420);
  assert.equal(dialogSize(500, -40, 'near', 300, 1000), 580);
  assert.equal(dialogSize(500, 400, 'far', 300, 700), 700);
});
