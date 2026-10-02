// SPDX-License-Identifier: Apache-2.0
import assert from 'node:assert/strict';
import test from 'node:test';
import { createRequire } from 'node:module';
import { describeUpdate, type UpdateState } from '../lib/gradara/updates';

const base: UpdateState = {
  status: 'idle', currentVersion: '0.3.0', version: null, percent: 0, checkedAt: null, error: '',
};

void test('no bridge: explains that updates are for the desktop app, nothing in the header', () => {
  const s = describeUpdate(null);
  assert.equal(s.indicator, null);
  assert.equal(s.canCheck, false);
  assert.match(s.detail, /desktop app/);
});

void test('up to date and checking stay out of the header', () => {
  assert.equal(describeUpdate({ ...base, status: 'current' }).indicator, null);
  assert.equal(describeUpdate({ ...base, status: 'checking' }).indicator, null);
  assert.equal(describeUpdate({ ...base, status: 'current' }).canCheck, true);
});

void test('downloading shows progress without an action', () => {
  const s = describeUpdate({ ...base, status: 'downloading', version: '0.3.1', percent: 41.6 });
  assert.deepEqual(s.indicator, { label: 'Updating 42%', action: null });
  assert.match(s.detail, /Gradara 0\.3\.1 \(42%\)/);
  assert.equal(s.canCheck, false);
});

void test('a downloaded update asks for a restart', () => {
  const s = describeUpdate({ ...base, status: 'ready', version: '0.3.1', percent: 100 });
  assert.deepEqual(s.indicator, { label: 'Restart to update', action: 'install' });
  assert.match(s.detail, /installs when you restart/);
});

void test('packages that cannot update themselves point to the download page', () => {
  const s = describeUpdate({ ...base, status: 'manual', version: '0.3.1' });
  assert.deepEqual(s.indicator, { label: 'Update available', action: 'download' });
});

void test('disabled builds and errors never show a header button', () => {
  assert.equal(describeUpdate({ ...base, status: 'disabled' }).indicator, null);
  const e = describeUpdate({ ...base, status: 'error', error: 'net::ERR_INTERNET_DISCONNECTED' });
  assert.equal(e.indicator, null);
  assert.match(e.detail, /ERR_INTERNET_DISCONNECTED/);
  assert.equal(e.canCheck, true);
});

void test('download progress never shows past 100% or below 0%', () => {
  const over = describeUpdate({ ...base, status: 'downloading', version: '0.6.6', percent: 148242 });
  assert.deepEqual(over.indicator, { label: 'Updating 100%', action: null });
  assert.match(over.detail, /\(100%\)/);
  assert.match(describeUpdate({ ...base, status: 'downloading', percent: -4 }).detail, /\(0%\)/);
});

const require = createRequire(import.meta.url);
const guard = require('../desktop/update-guard.cjs') as {
  overran: (p: { total?: number; transferred?: number }) => boolean;
  clampPercent: (p: number) => number;
};

void test('a download that receives far more than planned is detected', () => {
  const MB = 1024 * 1024;
  // Planned: 12 MB of changed parts. A proxy that ignores Range sends a whole 250 MB file per part.
  assert.equal(guard.overran({ total: 12 * MB, transferred: 250 * MB }), true);
  assert.equal(guard.overran({ total: 12 * MB, transferred: 12 * MB }), false);
  assert.equal(guard.overran({ total: 12 * MB, transferred: 13 * MB }), false);
  assert.equal(guard.overran({ total: 0, transferred: 5 }), false);
  assert.equal(guard.overran({}), false);
  assert.equal(guard.overran({ total: Number.NaN, transferred: 9e9 }), false);
});

void test('clampPercent stays within 0 to 100', () => {
  assert.equal(guard.clampPercent(148242), 100);
  assert.equal(guard.clampPercent(-1), 0);
  assert.equal(guard.clampPercent(42.5), 42.5);
  assert.equal(guard.clampPercent(Number.NaN), 0);
});
