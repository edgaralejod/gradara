// SPDX-License-Identifier: Apache-2.0
/**
 * Writes docs/SOLVER.md from the simulation settings text the app shows
 * (lib/gradara/solver-docs.ts). `npm run docs:solver`; `--check` fails instead
 * of writing when the checked-in guide is out of date (tests/solver.test.ts
 * runs the same comparison).
 */
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { solverGuideMarkdown } from '../lib/gradara/solver-docs';

const OUT = 'docs/SOLVER.md';
const text = solverGuideMarkdown();
if (process.argv.includes('--check')) {
  if (!existsSync(OUT) || readFileSync(OUT, 'utf8') !== text) {
    console.error(`${OUT} is out of date. Run: npm run docs:solver`);
    process.exit(1);
  }
  console.log(`${OUT} is current.`);
} else {
  writeFileSync(OUT, text);
  console.log(`Wrote ${OUT}.`);
}
