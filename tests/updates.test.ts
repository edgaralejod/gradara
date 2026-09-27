// SPDX-License-Identifier: Apache-2.0
import assert from 'node:assert/strict';
import test from 'node:test';
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
