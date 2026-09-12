// React Flow 12.11.6 publishes store updates inside ResizeObserver delivery.
// Schedule only that observer's updates after delivery; preserve all diagnostics.
// Both ESM exports are patched. Gradara does not consume the CommonJS/UMD build.
import {readFileSync, writeFileSync} from 'node:fs';
const root = new URL('../', import.meta.url);
const pkg = JSON.parse(readFileSync(new URL('node_modules/@xyflow/react/package.json', root), 'utf8'));
if (pkg.version !== '12.11.6') throw new Error('Recheck the React Flow observer patch before upgrading.');
const before = readFileSync(new URL('patches/react-flow-observer.before.txt', root), 'utf8');
const after = readFileSync(new URL('patches/react-flow-observer.after.txt', root), 'utf8');
for (const name of ['index.js', 'index.mjs']) {
  const path = new URL(`node_modules/@xyflow/react/dist/esm/${name}`, root);
  const source = readFileSync(path, 'utf8');
  if (source.includes(after)) continue;
  if (!source.includes(before)) throw new Error(`React Flow observer patch does not match ${name}.`);
  writeFileSync(path, source.replace(before, after));
}
console.log('React Flow node measurements use a frame boundary.');
