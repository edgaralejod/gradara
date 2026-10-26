import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import type { Project } from '../lib/gradara/model';
import { normalizeProject } from '../lib/gradara/normalize-project';
import { groupIntoSubsystem, scopeView } from '../lib/gradara/hierarchy';
import {
  defaultPrefix,
  detectController,
  fixedStepSettings,
  MAX_SIL_STEPS,
  readiness,
  selectionUnit,
  suggestedFixedStep,
} from '../lib/gradara/codegen';

const example = (name: string): Project =>
  normalizeProject(
    JSON.parse(readFileSync(`models/examples/${name}.json`, 'utf8')) as Project,
  );

void test('detects the controller between measurements and actuators', () => {
  assert.deepEqual(detectController(example('dc')), {
    kind: 'selection',
    blockIds: ['controller'],
  });
  const foc = detectController(example('foc'));
  assert.equal(foc?.kind, 'selection');
  const ids = foc?.kind === 'selection' ? foc.blockIds : [];
  // The whole cascade, but neither the reference source nor the inverter and motor models.
  for (const id of [
    'speedPI',
    'qPI',
    'dPI',
    'park',
    'clarke',
    'inversePark',
    'inverseClarke',
    'dReference',
  ])
    assert.ok(ids.includes(id), id);
  for (const id of ['reference', 'inverter', 'motor', 'load'])
    assert.ok(!ids.includes(id), id);
  assert.equal(detectController(example('buck')), null);
});

void test('a grouped controller is detected as its subsystem', () => {
  const dc = example('dc');
  const grouped = groupIntoSubsystem(dc, ['controller'], 'Speed control')!;
  const view = scopeView(grouped.project, []);
  const unit = detectController(view);
  assert.deepEqual(unit, { kind: 'instance', instanceId: grouped.instanceId });
  assert.equal(defaultPrefix(view, unit!), 'speed_control');
  assert.deepEqual(selectionUnit(view, [grouped.instanceId]), unit);
});

void test('the suggested fixed step is the unit\'s sample period, else the recording spacing', () => {
  const dc = example('dc');
  // The speed PI samples every 1 ms.
  assert.equal(suggestedFixedStep(dc, dc, { kind: 'selection', blockIds: ['controller'] }), 0.001);
  // Grouped, the period is found inside the subsystem.
  const grouped = groupIntoSubsystem(dc, ['controller'], 'Speed control')!;
  const view = scopeView(grouped.project, []);
  assert.equal(
    suggestedFixedStep(grouped.project, view, { kind: 'instance', instanceId: grouped.instanceId }),
    0.001,
  );
  // A continuous unit takes the spacing the run records at (4 s / 6000 points).
  const buck = example('buck');
  const continuous = { kind: 'selection' as const, blockIds: buck.blocks.filter((b) => b.definition.kind === 'gain').map((b) => b.id) };
  assert.equal(suggestedFixedStep(buck, buck, continuous), buck.duration / 6000);
  assert.deepEqual(fixedStepSettings({ tolerance: 1e-5 }, 1e-6), { tolerance: 1e-5, solver: 'rk4', step: 1e-6 });
});

void test('readiness follows the solver, the step, and the last run', () => {
  const dc = example('dc');
  // A variable-step model: the solver line offers the fix; nothing can be verified yet.
  let r = readiness(dc, undefined, undefined);
  assert.equal(r.solver.ok, false);
  assert.equal(r.solver.action, 'use-fixed-step');
  assert.match(r.solver.text, /DASSL/);
  assert.equal(r.run.ok, false);
  assert.equal(r.run.action, undefined);
  // Fixed at 1 ms over 4 s: 4,000 steps, no run yet.
  const fixed = { ...dc, simulation: fixedStepSettings(dc.simulation, 0.001) };
  r = readiness(fixed, undefined, undefined);
  assert.equal(r.solver.ok, true);
  assert.match(r.solver.text, /Runge-Kutta 4 · step 1 ms/);
  assert.equal(r.steps, 4000);
  assert.deepEqual([r.run.ok, r.run.action], [false, 'run']);
  // A run of the model at that step matches; a stale, variable-step, or other-step run does not.
  const run = { id: 'r1', simulation: { solver: 'rk4' as const, points: 4000, step: 0.001, tolerance: 1e-6 }, stale: false };
  r = readiness(fixed, undefined, run);
  assert.equal(r.run.ok, true);
  assert.match(r.run.text, /4,000 steps of 1 ms/);
  assert.equal(readiness(fixed, undefined, { ...run, stale: true }).run.action, 'run');
  assert.match(readiness(fixed, undefined, { id: 'r0', stale: false }).run.text, /DASSL, a variable-step solver/);
  const other = { ...run, simulation: { ...run.simulation, points: 2000, step: 0.002 } };
  assert.match(readiness(fixed, undefined, other).run.text, /stepped every 2 ms; the code steps every 1 ms/);
  // An overriding step is allowed but warned about, and verification needs a run at that step.
  r = readiness(fixed, 0.002, run);
  assert.match(r.warning!, /not the model's 1 ms/);
  assert.equal(r.run.ok, false);
  assert.equal(readiness(fixed, 0.002, other).run.ok, true);
  // Too many steps to replay.
  const fine = { ...dc, simulation: fixedStepSettings(dc.simulation, 1e-6) };
  r = readiness(fine, undefined, undefined);
  assert.equal(r.steps, 4_000_000);
  assert.ok(r.steps > MAX_SIL_STEPS);
  assert.match(r.warning!, /Verification replays up to 500,000 steps/);
});
