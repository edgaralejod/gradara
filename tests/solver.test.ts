import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import cases from './fixtures/solver-cases.json';
import {
  DEFAULTS,
  MAX_POINTS,
  SOLVER_IDS,
  cleanSettings,
  consequence,
  effective,
  formatSeconds,
  formatTolerance,
  isDefault,
  settingsProblems,
  signature,
  type SimulationSettings,
} from '../lib/gradara/solver';
import { FIELDS, SOLVERS, SYMPTOMS, describeRun, solverGuideMarkdown } from '../lib/gradara/solver-docs';
import { semanticSignature } from '../lib/gradara/project';
import { parameterDifferences } from '../lib/gradara/compare';
import { groupIntoSubsystem, scopeView, syncInstances, writeScope } from '../lib/gradara/hierarchy';
import { initialProject, type Project } from '../lib/gradara/model';
import { normalizeProject } from '../lib/gradara/normalize-project';

void test('settings mean the same run here as in the service (tests/fixtures/solver-cases.json)', () => {
  for (const c of cases) {
    const got = effective(c.duration, (c.settings ?? undefined) as SimulationSettings | undefined);
    assert.deepEqual(got, c.effective, c.about);
  }
});

void test('no settings, or settings equal to the defaults, are the defaults', () => {
  assert.equal(isDefault(4), true);
  assert.equal(isDefault(4, { solver: 'dassl', tolerance: DEFAULTS.tolerance }), true);
  assert.equal(isDefault(4, { step: 0.1 }), true, 'a fixed step does not apply to DASSL');
  assert.equal(isDefault(4, { solver: 'esdirk' }), false);
  assert.equal(isDefault(4, { tolerance: 1e-8 }), false);
  assert.equal(signature(4, { step: 0.1 }), undefined);
});

void test('a settings change makes the last result stale; a change that does not apply does not', () => {
  const base = initialProject();
  const signatureOf = (simulation?: SimulationSettings) => semanticSignature({ ...base, simulation } as Project);
  assert.equal(signatureOf(), signatureOf({ solver: 'dassl' }));
  assert.equal(signatureOf(), signatureOf({ step: 0.01 }));
  assert.notEqual(signatureOf(), signatureOf({ tolerance: 1e-8 }));
  assert.notEqual(signatureOf({ solver: 'rk4', step: 0.01 }), signatureOf({ solver: 'rk4', step: 0.02 }));
});

void test('settings that cannot run name the field and the limit', () => {
  assert.deepEqual(settingsProblems(1), []);
  const tooMany = settingsProblems(1, { solver: 'rk4', step: 1e-7 });
  assert.equal(tooMany.length, 1);
  assert.equal(tooMany[0].field, 'step');
  assert.match(tooMany[0].message, /10,000,000 points; the limit is 200,000/);
  assert.equal(settingsProblems(1, { solver: 'rk4', step: 1 / MAX_POINTS }).length, 0);
  assert.equal(settingsProblems(1, { outputInterval: 2 })[0].field, 'outputInterval');
  // Fields of the other solver type never block a run.
  assert.deepEqual(settingsProblems(1, { step: 1e-9 }), []);
});

void test('the consequence line says what the values mean', () => {
  assert.equal(consequence(1).text, 'Records 6,001 points, one every 167 µs, plus events');
  assert.equal(consequence(2, { solver: 'rk4', step: 0.01 }).text, '200 steps of 10 ms');
  assert.match(consequence(1, { solver: 'rk4', step: 1e-5 }).warning ?? '', /a lot of data/);
  assert.match(consequence(1, { solver: 'rk4', step: 0.1 }).warning ?? '', /Fewer than 100 steps/);
  assert.match(consequence(3600, { maxStep: 1e-4 }).warning ?? '', /36,000,000 steps/);
  assert.match(consequence(1, { solver: 'rk4', step: 1e-7 }).warning ?? '', /the limit is 200,000/);
});

void test('numbers read the way people write them', () => {
  assert.equal(formatTolerance(1e-6), '1e-6');
  assert.equal(formatTolerance(0.01), '1e-2');
  assert.equal(formatTolerance(2.5e-7), '2.5e-7');
  assert.equal(formatSeconds(1 / 6000), '167 µs');
  assert.equal(formatSeconds(14.4), '14.4 s');
  assert.equal(formatSeconds(0.25), '250 ms');
  assert.equal(cleanSettings({ solver: undefined, tolerance: undefined }), undefined);
  assert.deepEqual(cleanSettings({ solver: 'rk4', step: undefined }), { solver: 'rk4' });
});

void test('every solver, field and symptom has its text, and runs describe themselves', () => {
  for (const id of SOLVER_IDS) assert.ok(SOLVERS[id].name && SOLVERS[id].whenToUse && SOLVERS[id].detail, id);
  for (const f of Object.values(FIELDS)) assert.ok(f.line.length < 110, `${f.label}: one line under the field`);
  assert.equal(new Set(SYMPTOMS.map((s) => s.id)).size, SYMPTOMS.length);
  assert.equal(describeRun(effective(1)), 'DASSL · tolerance 1e-6');
  assert.equal(
    describeRun(effective(0.02, { solver: 'esdirk', tolerance: 1e-8, maxStep: 1e-5, outputInterval: 1e-6 }), 0.02),
    'Implicit Runge-Kutta · tolerance 1e-8 · max step 10 µs · output every 1 µs',
  );
  assert.equal(describeRun(effective(2, { solver: 'rk4', step: 0.01 })), 'Runge-Kutta 4 · step 10 ms');
});

void test('the service names every help topic a diagnostic can link to', () => {
  const service = readFileSync('server/engine.py', 'utf8');
  for (const topic of service.matchAll(/help='([a-z-]+)'|'(slow|too-much-data|stopped-early)'\)/g)) {
    const id = topic[1] ?? topic[2];
    assert.ok(SYMPTOMS.some((s) => s.id === id), `server topic ${id} has a symptom`);
  }
});

void test('docs/SOLVER.md is the guide the app shows (npm run docs:solver)', () => {
  assert.equal(readFileSync('docs/SOLVER.md', 'utf8'), solverGuideMarkdown());
});

void test('a settings change shows up when runs are compared', () => {
  const base = initialProject();
  assert.deepEqual(parameterDifferences(base, { ...base }), []);
  assert.deepEqual(parameterDifferences(base, { ...base, simulation: { tolerance: 1e-8 } }), [
    'Solver: DASSL · tolerance 1e-6 → DASSL · tolerance 1e-8',
  ]);
});

void test('settings edited while a subsystem is open are kept for the whole model', () => {
  const dc = normalizeProject(JSON.parse(readFileSync('models/examples/dc.json', 'utf8')) as Project);
  const grouped = groupIntoSubsystem(dc, ['controller', 'drive'], 'Drive')!;
  const doc = syncInstances(normalizeProject(grouped.project, dc));
  const path = [grouped.instanceId];
  const view = { ...scopeView(doc, path), simulation: { solver: 'esdirk' as const } };
  const written = writeScope(doc, path, view);
  assert.deepEqual(written.simulation, { solver: 'esdirk' });
  const cleared = writeScope(written, path, { ...scopeView(written, path), simulation: undefined });
  assert.equal('simulation' in cleared, false);
});
