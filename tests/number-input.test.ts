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
