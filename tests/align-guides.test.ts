import test from 'node:test';
import assert from 'node:assert/strict';
import { alignToNeighbors, boundsOf } from '../lib/gradara/align-guides';

const other = { x: 200, y: 96, width: 80, height: 64 };

void test('a nearby top edge, center, or bottom edge pulls the moving block into line and shows a guide', () => {
  const tops = alignToNeighbors(
    { x: 0, y: 99, width: 80, height: 64 },
    [other],
    6,
  );
  assert.equal(tops.dy, -3);
  assert.deepEqual(
    tops.guides.map((g) => [g.axis, g.value]).sort((a, b) => +a[1] - +b[1]),
    [
      ['y', 96],
      ['y', 128],
      ['y', 160],
    ],
  );
  // A taller block lines its center up with the other's center.
  const centers = alignToNeighbors(
    { x: 0, y: 82, width: 80, height: 96 },
    [other],
    6,
  );
  assert.equal(centers.dy, -2);
  assert.deepEqual(
    centers.guides.map((g) => g.value),
    [128],
  );
  assert.deepEqual(
    [centers.guides[0].from, centers.guides[0].to],
    [0, 280],
    'the guide spans both blocks',
  );
});

void test('the pull is small, an axis a wire decided is left alone, and nothing far away attracts', () => {
  assert.equal(
    alignToNeighbors({ x: 0, y: 110, width: 80, height: 64 }, [other], 6).dy,
    undefined,
  );
  const skipped = alignToNeighbors(
    { x: 202, y: 99, width: 80, height: 64 },
    [other],
    6,
    { y: true },
  );
  assert.equal(skipped.dy, undefined);
  assert.equal(skipped.dx, -2);
  assert.ok(skipped.guides.every((g) => g.axis === 'x'));
});

void test('a group aligns by its bounding box', () => {
  const group = boundsOf([
    { x: 0, y: 0, width: 80, height: 64 },
    { x: 0, y: 100, width: 80, height: 64 },
  ])!;
  assert.deepEqual(group, { x: 0, y: 0, width: 80, height: 164 });
  assert.equal(alignToNeighbors({ ...group, x: 198 }, [other], 6).dx, 2);
});
