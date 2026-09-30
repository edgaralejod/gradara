import test from 'node:test';
import assert from 'node:assert/strict';
import {
  parseInRange,
  parseOptionalPositive,
  rangeMessage,
  STOP_TIME,
} from '../lib/gradara/number-input';

test('a stop time draft is a value only inside the engine range', () => {
  const stop = (raw: string) => parseInRange(raw, STOP_TIME.min, STOP_TIME.max);
  // What Run must not act on (B01): the last committed value is not the field's text.
  for (const raw of ['0', '-1', '', '   ', 'abc', 'NaN', 'Infinity', '86401', '1e9'])
    assert.equal(stop(raw), null, raw);
  assert.equal(stop('4'), 4);
  assert.equal(stop('2'), 2);
  assert.equal(stop('1e-6'), 0.000001);
  assert.equal(stop('86400'), 86400);
  assert.equal(stop(' 0.5 '), 0.5);
});

test('the range message names the limits', () => {
  assert.equal(rangeMessage(STOP_TIME.min, STOP_TIME.max), 'Enter a number from 0.000001 to 86400.');
  assert.equal(rangeMessage(1), 'Enter a number of at least 1.');
  assert.equal(rangeMessage(undefined, 10), 'Enter a number of at most 10.');
  assert.equal(rangeMessage(), 'Enter a number.');
});

test('an optional positive step: blank is automatic, zero is an error (B02)', () => {
  assert.equal(parseOptionalPositive(''), undefined);
  assert.equal(parseOptionalPositive('  '), undefined);
  assert.equal(parseOptionalPositive('0.001'), 0.001);
  assert.equal(parseOptionalPositive('1e-4'), 0.0001);
  for (const raw of ['0', '-0.001', 'NaN', 'abc', 'Infinity', '-0'])
    assert.equal(parseOptionalPositive(raw), null, raw);
});

test('download names come from the model name', async () => {
  const { fileSlug } = await import('../lib/gradara/api');
  assert.equal(fileSlug('DC motor'), 'DC-motor');
  assert.equal(fileSlug('  Buck converter (v2) '), 'Buck-converter-v2');
  assert.equal(fileSlug('Example: Flyback 2.1'), 'Example-Flyback-2.1');
  assert.equal(fileSlug('***'), 'model');
  assert.equal(fileSlug('x'.repeat(80)).length, 60);
});

test('kept runs name what changed between them (parameters, blocks, stop time)', async () => {
  const { parameterDifferences } = await import('../lib/gradara/compare');
  const { readFileSync } = await import('node:fs');
  const from = JSON.parse(readFileSync(new URL('../models/examples/dc.json', import.meta.url), 'utf8'));
  const to = structuredClone(from);
  const reference = to.blocks.find((b: { id: string }) => b.id === 'reference');
  const height = reference.definition.parameters.find((p: { id: string; value: number }) => p.value === 100);
  height.value = 60;
  to.duration = 2;
  to.blocks = to.blocks.filter((b: { id: string }) => b.id !== 'ground');
  const diff = parameterDifferences(from, to);
  assert.ok(diff.some((d) => /Speed reference · .*: 100 → 60/.test(d)), diff.join('\n'));
  assert.ok(diff.includes('Ground: removed'));
  assert.ok(diff.includes('Stop time: 4 → 2 s'));
  assert.deepEqual(parameterDifferences(from, from), []);
});
