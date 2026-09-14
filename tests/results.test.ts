import test from 'node:test';
import assert from 'node:assert/strict';
import { plotOptions, plotStart, formatPlotTime } from '../lib/gradara/results';
import { initialProject } from '../lib/gradara/model';
import type { SimulationResult } from '../lib/gradara/api';
const series = ['b_123.y', 'b_456.u'].map((key, i) => ({
  key,
  name: ['Step.out', 'Scope.in'][i],
  blockId: key.split('.')[0],
  unit: '',
  values: [0, 1],
}));
const result: SimulationResult = {
  id: 'run1',
  engine: 'OpenModelica',
  projectKey: 'key',
  modelHash: 'hash',
  projectRevision: 0,
  duration: 1,
  elapsed: 1,
  samples: 2,
  time: [0, 1],
  series,
  diagnostics: '',
};
void test('arbitrary block IDs and sink inputs are available without motor-specific keys', () => {
  assert.deepEqual(
    plotOptions(result).map((p) => p.label),
    ['Step.out', 'Scope.in'],
  );
  assert.deepEqual(plotOptions(null), []);
});
void test('missing saved plot channels never substitute unrelated signals', () => {
  const snapshot = {
    ...initialProject(),
    plots: [
      { id: 'absent', label: 'Missing', series: ['load.w'] },
      {
        id: 'mixed',
        label: 'Response',
        series: ['absent', 'b_456.u'],
        labels: ['Missing', 'Measured'],
      },
    ],
  };
  const options = plotOptions({ ...result, snapshot });
  assert.equal(
    options.some((p) => p.label === 'Missing'),
    false,
  );
  assert.deepEqual(
    options[0].series.map((s) => [s.key, s.name]),
    [['b_456.u', 'Measured']],
  );
  assert.equal(options.filter((p) => !p.group).length, 2);
});

void test('short simulations and switching windows have distinct readable time labels', () => {
  assert.equal(formatPlotTime(0.02, 0.02), '20 ms');
  assert.equal(formatPlotTime(0.01925, 0.02, 0.001), '19.25 ms');
  assert.equal(formatPlotTime(0.0001, 0.0002), '100 µs');
  assert.equal(formatPlotTime(1.5, 2), '1.5 s');
  assert.equal(plotStart(0.02, 'last1'), 0.019);
  assert.equal(plotStart(0.02, 'last50'), 0);
  assert.equal(plotStart(0.02, 'last10'), 0.018000000000000002);
  assert.equal(plotStart(0.02, 'full'), 0);
  const ticks = Array.from({ length: 7 }, (_, i) =>
    formatPlotTime(0.019 + (i * 0.001) / 6, 0.02, 0.001),
  );
  assert.equal(new Set(ticks).size, ticks.length);
});
