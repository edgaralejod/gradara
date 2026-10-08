import test from 'node:test';
import assert from 'node:assert/strict';
import {
  advance,
  barFraction,
  elapsedText,
  leftText,
  phaseLabel,
  secondsLeft,
  simulatedText,
  startTrack,
  statusText,
  stepIndex,
} from '../lib/gradara/run-progress';

void test('a run moves through translate, compile, simulate and results', () => {
  assert.deepEqual(
    (['preparing', 'translating', 'compiling', 'starting', 'simulating', 'reading'] as const).map(stepIndex),
    [0, 0, 1, 1, 2, 3],
  );
  assert.equal(phaseLabel('compiling'), 'Compiling the simulation');
});

void test('reports only move forward', () => {
  let t = startTrack(4, undefined, 0);
  t = advance(t, { phase: 'compiling' }, 1000);
  assert.equal(advance(t, { phase: 'translating' }, 1100), t, 'a late earlier phase is ignored');
  t = advance(t, { phase: 'simulating', time: 2, fraction: 0.5 }, 2000);
  assert.equal(t.simulatingSince, 2000);
  assert.equal(t.fractionAtStart, 0.5);
  assert.equal(advance(t, { phase: 'simulating', time: 1, fraction: 0.25 }, 2100), t, 'progress never goes back');
  const later = advance(t, { phase: 'simulating', time: 3, fraction: 0.75 }, 3000);
  assert.equal(later.simulatingSince, 2000, 'the start of simulating is kept');
});

void test('the bar fills with simulated time and is indeterminate otherwise', () => {
  let t = startTrack(4, undefined, 0);
  assert.equal(barFraction(t), undefined);
  t = advance(t, { phase: 'simulating', time: 1, fraction: 0.25 }, 500);
  assert.equal(barFraction(t), 0.25);
  assert.equal(simulatedText(t), '1 s of 4 s');
  assert.equal(statusText(t), 'Simulating · 25%');
  assert.equal(statusText({ ...t, label: 'Eco · 1 of 2' }), 'Eco · 1 of 2 · Simulating · 25%');
  t = advance(t, { phase: 'reading' }, 900);
  assert.equal(barFraction(t), undefined);
  assert.equal(simulatedText(t), '4 s of 4 s');
  assert.equal(simulatedText(startTrack(0.02, undefined, 0)), '');
});

void test('time left comes from the rate since simulating began, once there is enough to go on', () => {
  let t = startTrack(10, undefined, 0);
  t = advance(t, { phase: 'simulating', time: 0, fraction: 0 }, 5000);
  t = advance(t, { phase: 'simulating', time: 0.2, fraction: 0.02 }, 6000);
  assert.equal(secondsLeft(t, 6000), undefined, 'too little progress');
  t = advance(t, { phase: 'simulating', time: 2.5, fraction: 0.25 }, 7000);
  assert.equal(secondsLeft(t, 7000), 6, '25% in 2 s leaves 6 s');
  assert.equal(leftText(6), 'about 6 s left');
  assert.equal(leftText(150), 'about 3 min left');
  assert.equal(leftText(1), 'almost done');
  assert.equal(leftText(undefined), '');
  assert.equal(elapsedText(t, 65_400), '1:05');
});
