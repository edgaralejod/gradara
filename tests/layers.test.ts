import test from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import zlib from 'node:zlib';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const layers = require('../desktop/layers.cjs') as any;

const { privateKey, publicKey } = crypto.generateKeyPairSync('ed25519');
const privatePem = privateKey.export({ type: 'pkcs8', format: 'pem' }).toString();
const keys = [{ id: 'test', repository: 'owner/repo', publicKey: publicKey.export({ type: 'spki', format: 'pem' }).toString() }];

function layerFiles(overrides: Record<string, string> = {}, version = '0.7.0') {
  const files = [
    { name: 'web/index.html', data: Buffer.from('<div id="root"></div>') },
    { name: 'web/assets/app.js', data: Buffer.from('console.log(1)') },
    { name: 'server/__init__.py', data: Buffer.from('') },
    { name: 'server/app.py', data: Buffer.from('app = None') },
    { name: 'lib/gradara/port-units.json', data: Buffer.from('{}') },
  ];
  const manifest = {
    format: 1,
    id: 'f-speed-plot',
    base: version,
    repository: 'owner/repo',
    commit: 'abc',
    features: [{ id: 'f-speed-plot', title: 'Speed plot' }],
    files: Object.fromEntries(files.map((f) => [f.name, layers.sha256(f.data)])),
  };
  for (const [name, text] of Object.entries(overrides)) {
    const file = files.find((f) => f.name === name);
    if (file) file.data = Buffer.from(text);
  }
  return [...files, { name: 'manifest.json', data: Buffer.from(JSON.stringify(manifest)) }];
}

function tempRoot() {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'gradara-layers-'));
}

void test('archives round-trip byte for byte and pack deterministically', () => {
  const files = layerFiles();
  const archive = layers.pack(files);
  assert.deepEqual(layers.pack(files), archive);
  const back = layers.unpackEntries(archive);
  assert.deepEqual(
    back.map((f: { name: string }) => f.name),
    files.map((f) => f.name).sort(),
  );
  const long = 'web/' + 'd'.repeat(120) + '/x.js'; // past 100 characters: uses the ustar prefix
  const roundTrip = layers.unpackEntries(layers.pack([{ name: long, data: Buffer.from('x') }]));
  assert.equal(roundTrip[0].name, long);
});

void test('paths that leave the layer or replace the shell are refused', () => {
  for (const bad of ['../evil', '/etc/passwd', 'web/../../x', 'desktop/main.cjs', 'packaging/backend_entry.py', 'C:/x', 'web//x']) {
    assert.throws(() => layers.safeName(bad), /Unsafe|may not/, bad);
  }
  assert.equal(layers.safeName('server/llm/dispatch.py'), 'server/llm/dispatch.py');
});

void test('links and special files are refused', () => {
  const tar = Buffer.from(zlib.gunzipSync(layers.pack([{ name: 'web/x', data: Buffer.from('1') }])) as Uint8Array);
  tar[156] = '2'.charCodeAt(0); // symlink
  let sum = 0;
  tar.write('        ', 148, 8, 'ascii');
  for (const byte of tar.subarray(0, 512)) sum += byte;
  tar.write(`${sum.toString(8).padStart(6, '0')}\0 `, 148, 8, 'ascii');
  assert.throws(() => layers.unpackEntries(zlib.gzipSync(tar)), /link or special file/);
});

void test('a signature is tied to its key and its repository', () => {
  const archive = layers.pack(layerFiles());
  const signature = layers.sign(archive, privatePem);
  assert.equal(layers.verify(archive, signature, keys, 'owner/repo').id, 'test');
  assert.equal(layers.verify(archive, signature, keys, 'someone/else'), null);
  assert.equal(layers.verify(Buffer.concat([archive, Buffer.from('x')]), signature, keys, 'owner/repo'), null);
  assert.equal(layers.verify(archive, 'not base64 !!', keys, 'owner/repo'), null);
});

void test('install unpacks a valid layer and makes it the active one', () => {
  const root = tempRoot();
  const archive = layers.pack(layerFiles());
  const active = layers.install({ archive, signature: layers.sign(archive, privatePem), keys, repository: 'owner/repo', version: '0.7.0', root });
  assert.equal(active.id, 'f-speed-plot');
  assert.equal(fs.readFileSync(path.join(active.dir, 'server', 'app.py'), 'utf8'), 'app = None');
  const state = layers.readState(root);
  assert.equal(state.active.id, 'f-speed-plot');
  assert.deepEqual(layers.launchPlan(state, '0.7.0'), { layer: state.active, notice: '' });
});

void test('install refuses unsigned, tampered, foreign and other-version layers', () => {
  const root = tempRoot();
  const good = layers.pack(layerFiles());
  const tampered = layers.pack(layerFiles({ 'server/app.py': 'import os; os.system("x")' }));
  const other = layers.pack(layerFiles({}, '0.6.9'));
  const attempt = (archive: Buffer, signature = layers.sign(archive, privatePem), repository = 'owner/repo') => () =>
    layers.install({ archive, signature, keys, repository, version: '0.7.0', root });
  assert.throws(attempt(good, Buffer.alloc(64, 7).toString('base64')), /not signed/);
  assert.throws(attempt(tampered), /does not match the layer manifest/);
  assert.throws(attempt(other), /for Gradara 0\.6\.9, not 0\.7\.0/);
  assert.throws(attempt(good, undefined, 'someone/else'), /not signed/);
  assert.equal(layers.readState(root).active, null); // nothing was activated
});

void test('the launch plan falls back to the shipped code with a reason', () => {
  const active = { id: 'f1', base: '0.7.0', dir: '/layers/f1-0.7.0', features: [] };
  const exists = () => true;
  assert.equal(layers.launchPlan({ active, off: false, faulty: null }, '0.7.0', exists).layer, active);
  assert.equal(layers.launchPlan({ active, off: true, faulty: null }, '0.7.0', exists).layer, null);
  assert.equal(layers.launchPlan({ active, off: false, faulty: { id: 'f1' } }, '0.7.0', exists).layer, null);
  const updated = layers.launchPlan({ active, off: false, faulty: null }, '0.7.1', exists);
  assert.equal(updated.layer, null);
  assert.match(updated.notice, /built for Gradara 0\.7\.0 and are switched off in 0\.7\.1/);
  assert.match(layers.launchPlan({ active, off: false, faulty: null }, '0.7.0', () => false).notice, /missing/);
  assert.deepEqual(layers.launchPlan({ active: null, off: false, faulty: null }, '0.7.0'), { layer: null, notice: '' });
});

void test('pruning keeps only the active layer', () => {
  const root = tempRoot();
  for (const name of ['a-0.6.9', 'b-0.7.0', 'b-0.7.0.partial']) fs.mkdirSync(path.join(root, name));
  layers.prune(root, { active: { dir: path.join(root, 'b-0.7.0') } });
  assert.deepEqual(fs.readdirSync(root).sort(), ['b-0.7.0']);
});

void test('the shipped workshop key is an Ed25519 key for the main repository', () => {
  const shipped = JSON.parse(fs.readFileSync(new URL('../desktop/layer-keys.json', import.meta.url), 'utf8'));
  assert.ok(shipped.length >= 1);
  for (const key of shipped) {
    assert.equal(crypto.createPublicKey(key.publicKey).asymmetricKeyType, 'ed25519');
    assert.match(key.repository, /^[\w.-]+\/[\w.-]+$/);
  }
});
