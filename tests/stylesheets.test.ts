import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

// The installed app (desktop/web/main.tsx) and the development workbench (app/layout.tsx)
// each import the workbench stylesheets. A sheet imported by only one of them leaves that
// build unstyled where it is used, as the symbol editor was in the 0.8.0 installers.
const sheets = (file: string) =>
  [...readFileSync(file, 'utf8').matchAll(/import\s+'[./]*(?:app\/)?([\w-]+\.css)'/g)]
    .map((m) => m[1])
    .sort();

void test('the installed app imports every stylesheet the workbench does', () => {
  const dev = sheets('app/layout.tsx');
  assert.ok(dev.includes('symbol-editor.css'));
  assert.deepEqual(sheets('desktop/web/main.tsx'), dev);
});
