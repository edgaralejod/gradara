#!/usr/bin/env node
// SPDX-License-Identifier: Apache-2.0
// Build, sign, check and unpack personal-feature layers (see docs/architecture/LAYERS.md).
//
//   node scripts/build-layer.cjs build --id <id> --base <version> --features <file.json>
//        [--repository owner/name] [--commit sha] [--out dist-layer]
//        Packs dist-desktop/web (run `npm run desktop:web` first), the whole
//        server/ package and lib/gradara/port-units.json with a manifest.
//   node scripts/build-layer.cjs sign <archive>        signature from LAYER_SIGNING_KEY (PEM)
//   node scripts/build-layer.cjs verify <archive> [--repository owner/name] [--version x.y.z]
//        checks the signature against desktop/layer-keys.json, then the files
//   node scripts/build-layer.cjs unpack <archive> <folder>   for smoke tests
'use strict';

const fs = require('node:fs');
const path = require('node:path');
const layers = require('../desktop/layers.cjs');

const ROOT = path.resolve(__dirname, '..');

function option(args, name, fallback) {
  const at = args.indexOf(`--${name}`);
  return at >= 0 && args[at + 1] ? args[at + 1] : fallback;
}

function walk(dir, prefix, skip) {
  const out = [];
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    const name = `${prefix}/${entry.name}`;
    if (skip(entry.name, name)) continue;
    if (entry.isDirectory()) out.push(...walk(full, name, skip));
    else if (entry.isFile()) out.push({ name, data: fs.readFileSync(full) });
  }
  return out;
}

function build(args) {
  const id = option(args, 'id');
  const base = option(args, 'base');
  const featuresFile = option(args, 'features');
  if (!id || !base || !featuresFile) throw new Error('build needs --id, --base and --features.');
  const web = path.join(ROOT, 'dist-desktop', 'web');
  if (!fs.existsSync(path.join(web, 'index.html'))) throw new Error('Run `npm run desktop:web` first.');
  const skip = (name) => name === '__pycache__' || name.endsWith('.pyc') || name === '.DS_Store';
  const files = [
    ...walk(web, 'web', skip),
    ...walk(path.join(ROOT, 'server'), 'server', skip),
    { name: 'lib/gradara/port-units.json', data: fs.readFileSync(path.join(ROOT, 'lib', 'gradara', 'port-units.json')) },
  ];
  const manifest = {
    format: layers.FORMAT,
    id,
    base,
    repository: option(args, 'repository', ''),
    commit: option(args, 'commit', ''),
    built: new Date().toISOString(),
    features: JSON.parse(fs.readFileSync(featuresFile, 'utf8')),
    files: Object.fromEntries(files.map((f) => [f.name, layers.sha256(f.data)])),
  };
  const problems = layers.validManifest(manifest, base);
  if (problems.length) throw new Error(problems.join(' '));
  const out = path.resolve(option(args, 'out', path.join(ROOT, 'dist-layer')));
  fs.mkdirSync(out, { recursive: true });
  const archive = layers.pack([...files, { name: 'manifest.json', data: Buffer.from(JSON.stringify(manifest, null, 2)) }]);
  const name = `gradara-layer-${base}-${id}.tar.gz`;
  fs.writeFileSync(path.join(out, name), archive);
  const { files: _files, ...summary } = manifest;
  fs.writeFileSync(path.join(out, 'layer.json'), JSON.stringify({ ...summary, archive: name, bytes: archive.length, sha256: layers.sha256(archive) }, null, 2));
  console.log(`${path.join(out, name)} (${(archive.length / 1048576).toFixed(1)} MB, ${files.length} files)`);
}

function signArchive(args) {
  const file = args[0];
  const key = process.env.LAYER_SIGNING_KEY;
  if (!file) throw new Error('sign needs an archive.');
  if (!key) throw new Error('LAYER_SIGNING_KEY is not set (an Ed25519 private key in PEM).');
  fs.writeFileSync(`${file}.sig`, `${layers.sign(fs.readFileSync(file), key)}\n`);
  console.log(`${file}.sig`);
}

function verifyArchive(args) {
  const file = args[0];
  const archive = fs.readFileSync(file);
  const keys = JSON.parse(fs.readFileSync(path.join(ROOT, 'desktop', 'layer-keys.json'), 'utf8'));
  const repository = option(args, 'repository', '');
  const key = layers.verify(archive, fs.readFileSync(`${file}.sig`, 'utf8'), keys, repository);
  if (!key) throw new Error('The signature does not match a trusted key.');
  const files = layers.unpackEntries(archive);
  const manifest = JSON.parse(files.find((f) => f.name === 'manifest.json').data.toString('utf8'));
  const problems = layers.validManifest(manifest, option(args, 'version', manifest.base));
  if (problems.length) throw new Error(problems.join(' '));
  layers.checkFiles(manifest, files);
  console.log(`Signed by ${key.id}; ${files.length} files match the manifest of ${manifest.id} for ${manifest.base}.`);
}

function unpack(args) {
  const [file, dest] = args;
  if (!file || !dest) throw new Error('unpack needs an archive and a folder.');
  for (const entry of layers.unpackEntries(fs.readFileSync(file))) {
    const target = path.join(dest, ...entry.name.split('/'));
    fs.mkdirSync(path.dirname(target), { recursive: true });
    fs.writeFileSync(target, entry.data);
  }
  console.log(dest);
}

const [command, ...rest] = process.argv.slice(2);
const commands = { build, sign: signArchive, verify: verifyArchive, unpack };
try {
  if (!commands[command]) throw new Error('Use build, sign, verify or unpack.');
  commands[command](rest);
} catch (error) {
  console.error(error.message);
  process.exit(1);
}
