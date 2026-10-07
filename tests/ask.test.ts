import test from 'node:test';
import assert from 'node:assert/strict';
import {
  availableActions,
  canSend,
  guessBlockType,
  nextAction,
  portBlockType,
  resolveAction,
  scopeText,
  type AskContext,
} from '../lib/gradara/ask';
import { definitionFor } from '../lib/gradara/model';
import {
  padWindow,
  publishInspectorContext,
  inspectorContext,
  sendInspectorCommand,
  takeInspectorCommand,
  windowAround,
} from '../lib/gradara/inspector-bus';
import {
  answerText,
  evidenceTarget,
  evidenceText,
  formatNumber,
  type Evidence,
} from '../lib/gradara/results-discussion';
import { sanitizeEntries, withStatus, type Entry } from '../lib/gradara/proposals-thread';
import { improveIssueUrl } from '../lib/gradara/improve';

const sheet: AskContext = { selection: [] };
const runs = {
  modelId: 'm1',
  runIds: ['r2', 'r1'],
  signals: ['i.y'],
  titles: { r2: 'Latest run', r1: 'Lower gain' },
  signalNames: { 'i.y': 'Inductor current' },
};

void test('where you ask decides the action, with no model call', () => {
  assert.deepEqual(availableActions(sheet), ['edit', 'block', 'model']);
  assert.deepEqual(availableActions({ ...sheet, emptySheet: true }), ['model', 'block']);
  assert.deepEqual(availableActions({ ...sheet, connection: { blockId: 'a', portId: 'y' } }), ['block']);
  const existing = { id: 'b', definition: definitionFor('gain')! };
  assert.deepEqual(availableActions({ ...sheet, existing }), ['refine-block']);
  const problem = { id: 'd1', severity: 'error' as const, source: 'runtime' as const, message: 'Loop', detail: '', blockIds: [], ports: [], netIds: [], wireIds: [] };
  assert.deepEqual(availableActions({ ...sheet, problems: [problem] }), ['explain', 'fix']);
  assert.deepEqual(availableActions({ ...sheet, runs }), ['results', 'edit']);
});

void test('Tab cycles through the allowed actions and a removed chip falls back', () => {
  const context = { ...sheet, runs };
  assert.equal(nextAction(context, 'results'), 'edit');
  assert.equal(nextAction(context, 'edit'), 'results');
  assert.equal(resolveAction(sheet, 'results'), 'edit'); // runs chip removed
  assert.equal(resolveAction(context), 'results');
});

void test('problems can be sent without words, other actions need a request', () => {
  assert.equal(canSend('explain', ''), true);
  assert.equal(canSend('edit', 'hi'), false);
  assert.equal(canSend('results', 'Why so high?'), true);
});

void test('block types are guessed from the request or the open port', () => {
  assert.equal(guessBlockType('A resistor with a thermal port for dissipated heat'), 'multidomain');
  assert.equal(guessBlockType('Ideal transformer 2:1'), 'electrical');
  assert.equal(guessBlockType('Torsional spring between two shafts'), 'mechanical');
  assert.equal(guessBlockType('Low-pass filter, 50 ms'), 'signal');
  assert.equal(portBlockType('boolean'), 'signal');
  assert.equal(portBlockType('thermal'), 'thermal');
  assert.equal(portBlockType(undefined), undefined);
});

void test('the scope line says what was sent', () => {
  assert.equal(scopeText('results', { ...sheet, runs }, () => undefined), 'Explain results · Latest run · Lower gain');
  assert.equal(
    scopeText('results', { ...sheet, runs: { ...runs, window: [0, 1] } }, () => undefined),
    'Explain results · Latest run · Lower gain · zoomed',
  );
  assert.equal(scopeText('edit', { selection: ['a'] }, () => 'PI'), 'Selection · PI');
  assert.equal(scopeText('edit', sheet, () => undefined), 'Whole model');
});

void test('inspector commands wait for the inspector of their model', () => {
  sendInspectorCommand({ type: 'focus', modelId: 'm1', runId: 'r1', key: 'i.y', at: 0.2 });
  assert.equal(takeInspectorCommand('m2'), null);
  assert.equal(takeInspectorCommand('m1')?.type, 'focus');
  assert.equal(takeInspectorCommand('m1'), null);
  publishInspectorContext(runs);
  assert.deepEqual(inspectorContext(), runs);
  publishInspectorContext(null);
  assert.equal(inspectorContext(), null);
});

void test('evidence windows stay inside the run', () => {
  assert.deepEqual(windowAround(0, 1), [0, 0.08]);
  const [a, b] = windowAround(1, 1);
  assert.ok(Math.abs(a - 0.92) < 1e-12 && b === 1);
  const [c, d] = padWindow([0.4, 0.5], 1);
  assert.ok(c < 0.4 && d > 0.5 && c >= 0 && d <= 1);
});

void test('evidence reads like an engineer wrote it', () => {
  const max: Evidence = { run: 'A', signal: 'i.y', metric: 'max', t0: null, t1: null, at: null, value: 12.53826, checked: true };
  assert.equal(evidenceText(max, 'A'), 'maximum 12.54 A');
  assert.equal(evidenceText({ ...max, metric: 'settlingTime', value: 0.31 }, 'A'), 'settles at 0.31 s');
  assert.equal(evidenceText({ ...max, metric: 'overshootPercent', value: 25.38 }, ''), 'overshoot 25.38 %');
  assert.equal(evidenceText({ ...max, metric: 'valueAt', at: 0.5, value: 8 }, 'A'), 'value at 0.5 s 8 A');
  assert.equal(formatNumber(0.0000123), '1.23e-5');
  assert.equal(formatNumber(-1500), '-1500');
  assert.deepEqual(evidenceTarget({ ...max, metric: 'tMax', value: 0.17 }, [0, 1]), { at: 0.17 });
  assert.deepEqual(evidenceTarget(max, [0, 1]), { window: [0, 1] });
  const text = answerText({
    explanation: 'Underdamped.',
    findings: [{ text: 'Peak.', evidence: [max] }],
    causes: [{ text: 'Gain too high.', kind: 'hypothesis', blockIds: [], evidence: [] }],
    nextSteps: [],
    missing: ['Speed'],
    changePrompt: null,
    removed: 0,
  });
  assert.match(text, /Underdamped\.\n- Peak\. \[A i\.y max=12\.54\]\n- hypothesis: Gain too high\.\nNot recorded: Speed/);
});

void test('saved threads are read back defensively', () => {
  const entries = sanitizeEntries([
    { id: 'a', kind: 'request', text: 'x', scope: 'y', at: 1 },
    { id: 'b', kind: 'mystery' },
    { id: 'c', kind: 'proposal' },
    'junk',
    { id: 'd', kind: 'results', runIds: ['r'], turns: [] },
  ]);
  assert.deepEqual(entries.map((e) => e.id), ['a', 'd']);
  assert.deepEqual(sanitizeEntries(null), []);
  const block = { id: 'b', at: 1, kind: 'block', status: 'pending' } as unknown as Entry;
  assert.equal((withStatus([block], 'b', 'applied')[0] as { status: string }).status, 'applied');
});

void test('Improve Gradara opens a filled-in public issue without any model', () => {
  const url = new URL(improveIssueUrl({ request: 'Add a hydraulic pump\nwith a relief valve', reason: 'No hydraulic domain.', version: '0.7.0', platform: 'MacIntel' }));
  assert.equal(url.origin + url.pathname, 'https://github.com/edgaralejod/gradara/issues/new');
  assert.equal(url.searchParams.get('template'), 'improve-gradara.yml');
  assert.equal(url.searchParams.get('title'), 'Improve Gradara: Add a hydraulic pump');
  assert.equal(url.searchParams.get('reason'), 'No hydraulic domain.');
  assert.equal(url.searchParams.get('environment'), 'Gradara 0.7.0 · MacIntel');
  assert.ok((url.searchParams.get('request') ?? '').length <= 2501);
});
