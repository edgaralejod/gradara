import test from 'node:test';
import assert from 'node:assert/strict';
import type { Project } from '../lib/gradara/model';
import { appendLive, halve, liveResult } from '../lib/gradara/live-run';

const meta = [
  { key: 'a.y', name: 'a.y', unit: '', blockId: 'a' },
  { key: 'b.y', name: 'b.y', unit: 'V', blockId: 'b' },
];

void test('answers merge in order, and a reset starts over', () => {
  let s = appendLive(null, { row: 0, meta, time: [], series: [] });
  assert.ok(s);
  assert.equal(s.time.length, 0);
  s = appendLive(s, {
    row: 2,
    time: [0, 0.1],
    series: [
      { key: 'a.y', values: [1, 2] },
      { key: 'b.y', values: [3, 4] },
    ],
    fraction: 0.1,
  })!;
  s = appendLive(s, { row: 3, time: [0.2], series: [{ key: 'a.y', values: [5] }, { key: 'b.y', values: [6] }], fraction: 0.2 })!;
  assert.deepEqual(s.time, [0, 0.1, 0.2]);
  assert.deepEqual(s.values['a.y'], [1, 2, 5]);
  assert.equal(s.row, 3);
  assert.equal(s.fraction, 0.2);
  // Nothing new keeps the fraction.
  assert.equal(appendLive(s, { row: 3, time: [], series: [] })!.fraction, 0.2);
  // A reset replaces what was there.
  const r = appendLive(s, { row: 1, reset: true, meta, time: [0], series: [{ key: 'a.y', values: [9] }, { key: 'b.y', values: [9] }], fraction: 0 })!;
  assert.deepEqual(r.time, [0]);
  assert.deepEqual(r.values['a.y'], [9]);
  // Done, pending, or unavailable change nothing.
  assert.equal(appendLive(s, { done: true }), s);
  assert.equal(appendLive(null, { pending: true, row: 0 }), null);
});

void test('a long run is kept under the cap, with every extreme', () => {
  let s = appendLive(null, { row: 0, meta: meta.slice(0, 1), time: [], series: [] })!;
  for (let k = 0; k < 50; k++) {
    const time = Array.from({ length: 100 }, (_, i) => (k * 100 + i) / 5000);
    const values = time.map((_, i) => (k === 13 && i === 37 ? 7 : 0));
    s = appendLive(s, { row: (k + 1) * 100, time, series: [{ key: 'a.y', values }], fraction: (k + 1) / 50 }, 1000)!;
  }
  assert.ok(s.time.length <= 1000);
  assert.equal(Math.max(...s.values['a.y']), 7);
  assert.ok(s.time.every((t, i) => i === 0 || t >= s.time[i - 1]));
  assert.equal(s.time.at(-1), 4999 / 5000);
});

void test('halving keeps order and extremes', () => {
  const [t, [c]] = halve([0, 1, 2, 3, 4, 5], [[0, 5, -2, 1, 3, 3]]);
  assert.deepEqual(t, [0, 3, 4, 5]);
  assert.deepEqual(c, [5, -2, 3, 3]);
});

void test('the preview is a result the inspector can draw', () => {
  const snapshot = { name: 'm', blocks: [], wires: [], duration: 2, revision: 4 } as unknown as Project;
  const s = appendLive(null, { row: 1, meta, time: [0], series: [{ key: 'a.y', values: [1] }, { key: 'b.y', values: [2] }], fraction: 0 })!;
  const r = liveResult('job1', snapshot, s);
  assert.equal(r.id, 'job1');
  assert.deepEqual(r.live, { fraction: 0 });
  assert.equal(r.duration, 2);
  assert.equal(r.series[1].unit, 'V');
  assert.deepEqual(r.series[1].values, [2]);
  assert.equal(r.simulation?.solver, 'dassl');
});
