// SPDX-License-Identifier: Apache-2.0
// Personal features ("layers"): a signed archive holding a complete workbench build
// and the complete `server` package, built by the workshop pipeline for one exact
// app version. The shell chooses between the shipped code and one valid layer;
// it never patches files. Nothing here runs a layer's code: it only checks,
// unpacks and chooses. This module has no Electron dependency so tests and the
// pipeline's build script can use it.
'use strict';

const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');
const zlib = require('node:zlib');

const FORMAT = 1;
const MAX_FILES = 20000;
const MAX_BYTES = 400 * 1024 * 1024; // unpacked
// A layer replaces only these platform-independent parts; everything else stays the app's own.
const ALLOWED = [/^web\//, /^server\//, /^lib\/gradara\/[\w-]+\.json$/, /^manifest\.json$/];

// ------------------------------------------------------------------ tar (ustar)

function octal(value, width) {
  return `${value.toString(8).padStart(width - 1, '0')}\0`;
}

function header(name, size, mode) {
  const block = Buffer.alloc(512, 0);
  let prefix = '';
  let base = name;
  if (Buffer.byteLength(name) > 100) {
    const cut = name.lastIndexOf('/', 155);
    if (cut <= 0 || Buffer.byteLength(name.slice(cut + 1)) > 100) throw new Error(`Path too long for a layer: ${name}`);
    prefix = name.slice(0, cut);
    base = name.slice(cut + 1);
  }
  block.write(base, 0, 100, 'utf8');
  block.write(octal(mode, 8), 100, 8, 'ascii');
  block.write(octal(0, 8), 108, 8, 'ascii');
  block.write(octal(0, 8), 116, 8, 'ascii');
  block.write(octal(size, 12), 124, 12, 'ascii');
  block.write(octal(0, 12), 136, 12, 'ascii'); // fixed mtime: the same tree packs to the same bytes
  block.write('        ', 148, 8, 'ascii');
  block.write('0', 156, 1, 'ascii');
  block.write('ustar\0', 257, 6, 'ascii');
  block.write('00', 263, 2, 'ascii');
  block.write(prefix, 345, 155, 'utf8');
  let sum = 0;
  for (const byte of block) sum += byte;
  block.write(`${sum.toString(8).padStart(6, '0')}\0 `, 148, 8, 'ascii');
  return block;
}

/** A gzipped ustar archive of `files` ({ name, data }), in name order. */
function pack(files) {
  const parts = [];
  for (const file of [...files].sort((a, b) => (a.name < b.name ? -1 : 1))) {
    parts.push(header(file.name, file.data.length, 0o644), file.data);
    const pad = (512 - (file.data.length % 512)) % 512;
    if (pad) parts.push(Buffer.alloc(pad, 0));
  }
  parts.push(Buffer.alloc(1024, 0));
  return zlib.gzipSync(Buffer.concat(parts), { level: 9 });
}

function text(buffer, start, length) {
  const slice = buffer.subarray(start, start + length);
  const end = slice.indexOf(0);
  return slice.subarray(0, end < 0 ? length : end).toString('utf8');
}

/** The regular files of a gzipped ustar archive. Anything else (links, devices) is refused. */
function unpackEntries(archive) {
  const tar = zlib.gunzipSync(archive, { maxOutputLength: MAX_BYTES + 1024 * 1024 });
  const files = [];
  let total = 0;
  let at = 0;
  while (at + 512 <= tar.length) {
    const block = tar.subarray(at, at + 512);
    if (block.every((b) => b === 0)) break;
    const name = [text(block, 345, 155), text(block, 0, 100)].filter(Boolean).join('/');
    const size = parseInt(text(block, 124, 12).trim() || '0', 8);
    const type = String.fromCharCode(block[156] || 48);
    at += 512;
    if (type === '5') {
      at += Math.ceil(size / 512) * 512;
      continue; // directories are implied by files
    }
    if (type !== '0') throw new Error(`The layer contains a link or special file: ${name}`);
    total += size;
    if (files.length >= MAX_FILES || total > MAX_BYTES) throw new Error('The layer is too large.');
    files.push({ name: safeName(name), data: Buffer.from(tar.subarray(at, at + size)) });
    at += Math.ceil(size / 512) * 512;
  }
  return files;
}

/** A relative path inside the layer, or an error for anything that could leave it. */
function safeName(name) {
  const clean = name.replace(/\\/g, '/');
  if (!clean || clean.startsWith('/') || /^[A-Za-z]:/.test(clean) || clean.split('/').some((p) => p === '..' || p === '')) {
    throw new Error(`Unsafe path in the layer: ${name}`);
  }
  if (!ALLOWED.some((rule) => rule.test(clean))) throw new Error(`The layer may not contain ${clean}.`);
  return clean;
}

// ------------------------------------------------------------------ signatures

const sha256 = (data) => crypto.createHash('sha256').update(data).digest('hex');

/** Base64 Ed25519 signature of the archive bytes. */
function sign(data, privateKeyPem) {
  return crypto.sign(null, data, crypto.createPrivateKey(privateKeyPem)).toString('base64');
}

/** The trusted key that signed `data` for `repository`, or null. */
function verify(data, signature, keys, repository) {
  let raw;
  try {
    raw = Buffer.from(String(signature).trim(), 'base64');
  } catch {
    return null;
  }
  for (const key of keys) {
    if (repository && key.repository && key.repository.toLowerCase() !== repository.toLowerCase()) continue;
    try {
      if (crypto.verify(null, data, crypto.createPublicKey(key.publicKey), raw)) return key;
    } catch {
      /* a malformed key never verifies */
    }
  }
  return null;
}

// ------------------------------------------------------------------ manifest

function validManifest(manifest, version) {
  const problems = [];
  if (!manifest || typeof manifest !== 'object') return ['The layer has no manifest.'];
  if (manifest.format !== FORMAT) problems.push(`Unknown layer format ${manifest.format}.`);
  if (typeof manifest.id !== 'string' || !/^[a-z0-9][a-z0-9-]{2,80}$/.test(manifest.id)) problems.push('The layer ID is invalid.');
  if (version && manifest.base !== version) problems.push(`The layer is for Gradara ${manifest.base}, not ${version}.`);
  if (!Array.isArray(manifest.features) || !manifest.features.length) problems.push('The layer lists no features.');
  if (!manifest.files || typeof manifest.files !== 'object') problems.push('The layer lists no files.');
  return problems;
}

/** Every file the manifest lists, with its hash, and nothing else; refuses a layer that does not match. */
function checkFiles(manifest, files) {
  const listed = manifest.files;
  const seen = new Set();
  for (const file of files) {
    if (file.name === 'manifest.json') continue;
    if (listed[file.name] !== sha256(file.data)) throw new Error(`${file.name} does not match the layer manifest.`);
    seen.add(file.name);
  }
  const missing = Object.keys(listed).filter((name) => !seen.has(name));
  if (missing.length) throw new Error(`The layer is missing ${missing[0]}.`);
  if (!files.some((f) => f.name === 'web/index.html')) throw new Error('The layer has no workbench.');
  if (!files.some((f) => f.name === 'server/app.py')) throw new Error('The layer has no service.');
}

// ------------------------------------------------------------------ state

/** The layer folder inside the app's user-data folder. */
function rootOf(userData) {
  return path.join(userData, 'layers');
}

function readState(root) {
  try {
    const state = JSON.parse(fs.readFileSync(path.join(root, 'state.json'), 'utf8'));
    return {
      active: state.active && typeof state.active.id === 'string' ? state.active : null,
      off: !!state.off,
      faulty: state.faulty && typeof state.faulty.id === 'string' ? state.faulty : null,
    };
  } catch {
    return { active: null, off: false, faulty: null };
  }
}

function writeState(root, state) {
  fs.mkdirSync(root, { recursive: true });
  const file = path.join(root, 'state.json');
  fs.writeFileSync(`${file}.tmp`, JSON.stringify(state, null, 2));
  fs.renameSync(`${file}.tmp`, file);
}

/**
 * What to start: the active layer when it is for this exact version, switched on,
 * not marked faulty, and still on disk; otherwise the shipped code, with a reason.
 */
function launchPlan(state, version, exists = fs.existsSync) {
  const active = state.active;
  if (!active) return { layer: null, notice: '' };
  if (state.off) return { layer: null, notice: '' };
  if (state.faulty && state.faulty.id === active.id) return { layer: null, notice: '' };
  if (active.base !== version) {
    return {
      layer: null,
      notice: `Your personal features were built for Gradara ${active.base} and are switched off in ${version} until they are rebuilt for it.`,
    };
  }
  if (!exists(path.join(active.dir, 'manifest.json'))) {
    return { layer: null, notice: 'Your personal features are missing from disk and are switched off.' };
  }
  return { layer: active, notice: '' };
}

/**
 * Check a downloaded layer and unpack it beside the others, then make it the
 * active one. Refuses anything unsigned by a trusted key for that repository,
 * for another version, or whose files do not match its manifest.
 */
function install({ archive, signature, keys, repository, version, root }) {
  const key = verify(archive, signature, keys, repository);
  if (!key) throw new Error('The layer is not signed by a key this app trusts for that repository.');
  const files = unpackEntries(archive);
  const manifestFile = files.find((f) => f.name === 'manifest.json');
  if (!manifestFile) throw new Error('The layer has no manifest.');
  const manifest = JSON.parse(manifestFile.data.toString('utf8'));
  const problems = validManifest(manifest, version);
  if (problems.length) throw new Error(problems.join(' '));
  if (repository && manifest.repository && manifest.repository.toLowerCase() !== repository.toLowerCase()) {
    throw new Error('The layer was built for another repository.');
  }
  checkFiles(manifest, files);
  const dir = path.join(root, `${manifest.id}-${manifest.base}`);
  const staging = `${dir}.partial`;
  fs.rmSync(staging, { recursive: true, force: true });
  for (const file of files) {
    const target = path.join(staging, ...file.name.split('/'));
    fs.mkdirSync(path.dirname(target), { recursive: true });
    fs.writeFileSync(target, file.data);
  }
  fs.rmSync(dir, { recursive: true, force: true });
  fs.renameSync(staging, dir);
  const active = {
    id: manifest.id,
    base: manifest.base,
    dir,
    repository: manifest.repository || repository || '',
    commit: manifest.commit || '',
    features: manifest.features.map((f) => ({ id: f.id, title: f.title, commit: f.commit || '' })),
    key: key.id,
    installedAt: new Date().toISOString(),
  };
  writeState(root, { active, off: false, faulty: null });
  return active;
}

/** Remove layer folders other than the active one (old versions, failed unpacks). */
function prune(root, state) {
  let names = [];
  try {
    names = fs.readdirSync(root, { withFileTypes: true }).filter((d) => d.isDirectory()).map((d) => d.name);
  } catch {
    return;
  }
  const keep = state.active ? path.basename(state.active.dir) : '';
  for (const name of names) if (name !== keep) fs.rmSync(path.join(root, name), { recursive: true, force: true });
}

module.exports = {
  FORMAT,
  pack,
  unpackEntries,
  safeName,
  sha256,
  sign,
  verify,
  validManifest,
  checkFiles,
  rootOf,
  readState,
  writeState,
  launchPlan,
  install,
  prune,
};
