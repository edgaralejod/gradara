import assert from 'node:assert/strict';
import test from 'node:test';
import type { SimulationResult } from '../lib/gradara/api';
import {
  compareMany,
  compareRuns,
  exactTolerance,
  mergeRegions,
  signalDetail,
  toleranceBounds,
  toleranceValue,
  unionTime,
} from '../lib/gradara/run-compare';

function run(
  id: string,
  time: number[],
  series: Record<string, number[]>,
  duration = time[time.length - 1],
): SimulationResult {
  return {
    id,
    engine: 'test',
    projectKey: 'k',
    modelHash: 'h',
    projectRevision: 1,
    duration,
    elapsed: 0,
    time,
    samples: time.length,
    series: Object.entries(series).map(([key, values]) => ({
      key,
      name: key.toUpperCase(),
      unit: 'V',
      blockId: key,
      values,
    })),
    diagnostics: '',
  };
}

void test('unionTime merges both grids in order, without repeats, up to the end', () => {
  // Event pairs repeat a time inside one run; the grid keeps one instant.
  assert.deepEqual(unionTime([0, 1, 1, 2, 3], [0, 0.5, 1, 2.5, 4], 3), [0, 0.5, 1, 2, 2.5, 3]);
  assert.deepEqual(unionTime([], [0, 1], 5), [0, 1]);
});

void test('identical runs are within an exact tolerance', () => {
  const a = run('a', [0, 1, 2], { x: [0, 1, 4], y: [5, 5, 5] });
  const result = compareRuns(a, run('b', [0, 1, 2], { x: [0, 1, 4], y: [5, 5, 5] }), exactTolerance);
  assert.equal(result.out, 0);
  assert.equal(result.within, 2);
  assert.ok(result.signals.every((s) => s.status === 'within' && s.maxDifference === 0));
});

void test('a different signal is out, with its largest difference and when it happens', () => {
  const base = run('a', [0, 1, 2, 3], { x: [0, 1, 2, 3], y: [1, 1, 1, 1] });
  const next = run('b', [0, 1, 2, 3], { x: [0, 1, 2.5, 3], y: [1, 1, 1, 1] });
  const result = compareRuns(base, next, exactTolerance);
  assert.deepEqual(
    result.signals.map((s) => [s.key, s.status]),
    [['x', 'out'], ['y', 'within']],
  );
  const x = result.signals[0];
  assert.equal(x.maxDifference, 0.5);
  assert.equal(x.maxAt, 2);
  assert.equal(x.regions, 1);
  const detail = signalDetail(result, base, next, 'x', exactTolerance)!;
  assert.deepEqual(detail.difference, [0, 0, 0.5, 0]);
  assert.deepEqual(detail.regions, [[2, 2]]);
});

void test('absolute and relative tolerances use the larger margin', () => {
  const base = run('a', [0, 1, 2], { x: [0, 10, 100] });
  const next = run('b', [0, 1, 2], { x: [0.4, 10.4, 104] });
  // absolute 0.5 covers the first two samples; the third needs relative 5 % of 100.
  assert.equal(compareRuns(base, next, { absolute: 0.5, relative: 0, time: 0 }).signals[0].status, 'out');
  assert.equal(compareRuns(base, next, { absolute: 0.5, relative: 0.05, time: 0 }).signals[0].status, 'within');
  const detail = signalDetail(compareRuns(base, next, exactTolerance), base, next, 'x', { absolute: 0.5, relative: 0.05, time: 0 })!;
  assert.deepEqual(detail.upper, [0.5, 0.5, 5]);
  assert.deepEqual(detail.lower, [-0.5, -0.5, -5]);
});

void test('a time tolerance forgives a shifted edge', () => {
  const time = [0, 1, 2, 3, 4, 5];
  const base = run('a', time, { x: [0, 0, 0, 1, 1, 1] });
  const late = run('b', time, { x: [0, 0, 0, 0, 1, 1] }); // the step arrives one sample later
  assert.equal(compareRuns(base, late, exactTolerance).signals[0].status, 'out');
  assert.equal(compareRuns(base, late, { absolute: 0, relative: 0, time: 1 }).signals[0].status, 'within');
  const bounds = toleranceBounds(time, base.series[0].values, { absolute: 0, relative: 0, time: 1 });
  assert.deepEqual(bounds.lower, [0, 0, 0, 0, 1, 1]);
  assert.deepEqual(bounds.upper, [0, 0, 1, 1, 1, 1]);
});

void test('runs sampled at different times are compared on the merged grid by interpolation', () => {
  const base = run('a', [0, 2], { x: [0, 2] });
  const next = run('b', [0, 1, 2], { x: [0, 1, 2] });
  const result = compareRuns(base, next, exactTolerance);
  assert.deepEqual(result.time, [0, 1, 2]);
  assert.equal(result.signals[0].status, 'within');
});

void test('only the shared time span is compared, and unmatched signals are listed last', () => {
  const base = run('a', [0, 1, 2, 3], { x: [0, 0, 0, 9], old: [1, 1, 1, 1] });
  const next = run('b', [0, 1, 2], { x: [0, 0, 0], added: [2, 2, 2] });
  const result = compareRuns(base, next, exactTolerance);
  assert.equal(result.truncated, true);
  assert.equal(result.duration, 2);
  assert.deepEqual(result.time, [0, 1, 2]);
  assert.deepEqual(
    result.signals.map((s) => [s.key, s.status]),
    [['x', 'within'], ['added', 'compared-only'], ['old', 'baseline-only']],
  );
  assert.equal(result.unmatched, 2);
  assert.equal(signalDetail(result, base, next, 'old', exactTolerance), null);
});

void test('several separate stretches outside the tolerance are counted', () => {
  const time = [0, 1, 2, 3, 4, 5];
  const base = run('a', time, { x: [0, 0, 0, 0, 0, 0] });
  const next = run('b', time, { x: [1, 0, 0, 2, 2, 0] });
  const result = compareRuns(base, next, exactTolerance);
  assert.equal(result.signals[0].regions, 2);
  assert.deepEqual(signalDetail(result, base, next, 'x', exactTolerance)!.regions, [[0, 0], [3, 4]]);
  assert.equal(result.signals[0].maxAt, 3);
});

void test('typed tolerances fall back to zero unless they are positive numbers', () => {
  assert.equal(toleranceValue('0.5'), 0.5);
  assert.equal(toleranceValue('1e-3'), 0.001);
  for (const text of ['', ' ', '-1', 'abc', 'Infinity', 'NaN']) assert.equal(toleranceValue(text), 0);
});

void test('compareMany ranks a signal by its worst run and keeps each run\'s own numbers', () => {
  const t = [0, 1, 2];
  const base = run('base', t, { a: [0, 0, 0], b: [1, 1, 1] });
  const near = run('near', t, { a: [0, 0, 0.05], b: [1, 1, 1] });
  const far = run('far', t, { a: [0, 0, 0.5], b: [1, 1, 1], c: [9, 9, 9] });
  const many = compareMany(
    base,
    [
      { id: 'near', data: near },
      { id: 'far', data: far },
    ],
    { absolute: 0.1, relative: 0, time: 0 },
  );
  assert.deepEqual(many.pairs.map((p) => p.id), ['near', 'far']);
  const a = many.signals.find((s) => s.key === 'a')!;
  assert.equal(a.status, 'out');
  assert.equal(a.byRun.near.status, 'within');
  assert.equal(a.byRun.far.status, 'out');
  assert.ok(Math.abs(a.maxDifference - 0.5) < 1e-12);
  assert.equal(many.signals[0].key, 'a');
  assert.equal(many.signals.find((s) => s.key === 'c')!.status, 'compared-only');
  assert.equal(many.out, 1);
  assert.equal(many.within, 1);
  assert.equal(many.unmatched, 1);
  assert.equal(many.truncated, false);
});

void test('mergeRegions orders spans from several runs and joins the ones that overlap', () => {
  assert.deepEqual(
    mergeRegions([
      [[5, 6], [1, 2]],
      [[1.5, 3], [8, 9]],
    ]),
    [[1, 3], [5, 6], [8, 9]],
  );
  assert.deepEqual(mergeRegions([]), []);
});
