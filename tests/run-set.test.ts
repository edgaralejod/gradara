import assert from 'node:assert/strict';
import test from 'node:test';
import type { SimulationResult } from '../lib/gradara/api';
import { fitSeries } from '../lib/gradara/plot-navigation';
import {
  freeColor,
  isAssigned,
  maxOpenRuns,
  normalizeAssignments,
  openRuns,
  plotTraces,
  runPalette,
  toggleAssignment,
} from '../lib/gradara/run-set';

const open = ['new', 'old'];

void test('ticking a signal once shows it on every open run; unticking hides it in one run only', () => {
  let list = toggleAssignment([], 'speed', 'new', true, open);
  assert.deepEqual(list, [{ key: 'speed' }]);
  assert.ok(isAssigned(list, 'speed', 'old', open));
  list = toggleAssignment(list, 'speed', 'old', false, open);
  assert.deepEqual(list, [{ key: 'speed', runs: ['new'] }]);
  assert.ok(!isAssigned(list, 'speed', 'old', open));
  list = toggleAssignment(list, 'speed', 'old', true, open);
  assert.deepEqual(list, [{ key: 'speed' }]);
  list = toggleAssignment(list, 'speed', 'old', false, open);
  list = toggleAssignment(list, 'speed', 'new', false, open);
  assert.deepEqual(list, []);
});

void test('a run opened later shows signals that were placed on every run', () => {
  const list = [{ key: 'speed' }, { key: 'torque', runs: ['new'] }];
  const wider = ['new', 'old', 'older'];
  assert.ok(isAssigned(list, 'speed', 'older', wider));
  assert.ok(!isAssigned(list, 'torque', 'older', wider));
});

void test('assignments saved before runs existed are read as bare keys', () => {
  assert.deepEqual(normalizeAssignments(['a', { key: 'b', runs: ['x'] }]), [{ key: 'a' }, { key: 'b', runs: ['x'] }]);
  assert.equal(normalizeAssignments('a'), null);
  assert.equal(normalizeAssignments([{ key: 1 }]), null);
  assert.equal(normalizeAssignments([{ key: 'a', runs: [1] }]), null);
});

void test('the latest run leads, chosen runs follow newest first, and at most three show', () => {
  const known = ['r5', 'r4', 'r3', 'r2', 'r1'];
  assert.deepEqual(openRuns('r5', false, [], known), ['r5']);
  assert.deepEqual(openRuns('r5', false, ['r2', 'r4'], known), ['r5', 'r4', 'r2']);
  assert.deepEqual(openRuns('r5', false, ['r1', 'r2', 'r3', 'r4'], known).length, maxOpenRuns);
  assert.deepEqual(openRuns('r5', true, ['r3'], known), ['r3']);
  // A deleted run that was chosen is dropped.
  assert.deepEqual(openRuns('r5', false, ['gone', 'r3'], known), ['r5', 'r3']);
  // The latest is not duplicated when it was also chosen.
  assert.deepEqual(openRuns('r5', false, ['r5'], known), ['r5']);
});

void test('a free palette colour is chosen before any is reused', () => {
  assert.equal(freeColor([]), runPalette[0]);
  assert.equal(freeColor([runPalette[0]]), runPalette[1]);
  assert.equal(freeColor(runPalette), runPalette[0]);
});

function result(id: string, time: number[], values: Record<string, number[]>): SimulationResult {
  return {
    id,
    engine: 'test',
    projectKey: 'k',
    modelHash: 'h',
    projectRevision: 1,
    duration: time[time.length - 1],
    elapsed: 0,
    time,
    samples: time.length,
    series: Object.entries(values).map(([key, v]) => ({ key, name: key, unit: '', blockId: key, values: v })),
    diagnostics: '',
  };
}

void test('one run keeps a colour per signal; several colour by run and dash by signal', () => {
  const a = result('a', [0, 1], { x: [0, 1], y: [2, 3] });
  const b = result('b', [0, 0.5, 1], { x: [0, 0.5, 1] });
  const place = [{ key: 'x' }, { key: 'y' }];
  const one = plotTraces(place, [{ id: 'a', color: '#111111', data: a }], (_, key) => `c-${key}`);
  assert.deepEqual(one.map((t) => [t.color, t.dash]), [['c-x', undefined], ['c-y', undefined]]);
  const two = plotTraces(
    place,
    [
      { id: 'a', color: '#111111', data: a },
      { id: 'b', color: '#222222', data: b },
    ],
    () => 'unused',
  );
  // y exists only in run a; each run keeps its own sample times.
  assert.deepEqual(two.map((t) => [t.run, t.signal, t.color]), [
    ['a', 'x', '#111111'],
    ['b', 'x', '#222222'],
    ['a', 'y', '#111111'],
  ]);
  assert.deepEqual(two[0].dash, []);
  assert.notDeepEqual(two[2].dash, two[0].dash);
  assert.deepEqual(two[1].time, b.time);
  assert.equal(new Set(two.map((t) => t.key)).size, two.length);
});

void test('fitSeries covers lines that sample at different times', () => {
  const [lo, hi] = fitSeries(
    [
      { time: [0, 1, 2], values: [0, 1, 2] },
      { time: [0, 0.5, 2], values: [0, 10, -4] },
    ],
    [0, 2],
  );
  assert.ok(lo < -4 && hi > 10);
  assert.deepEqual(fitSeries([], [0, 1]), [-1, 1]);
});

void test('hiding every run leaves none shown, and any run can be brought back', () => {
  assert.deepEqual(openRuns('new', true, [], ['new', 'old']), []);
  assert.deepEqual(openRuns('new', true, ['old'], ['new', 'old']), ['old']);
  assert.deepEqual(openRuns('new', false, [], ['new', 'old']), ['new']);
});
