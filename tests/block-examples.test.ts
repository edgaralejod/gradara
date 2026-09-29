import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { library, type Project } from '../lib/gradara/model';
import { defaultBlockSize } from '../lib/gradara/block-design';
import { layoutFindings } from '../lib/gradara/auto-layout';
import { overlapsDifferentNet, polylineOfWire } from '../lib/gradara/net-draw';
import { bodyOf, labelOf } from '../lib/gradara/router';
import { segmentHitsRect } from '../lib/gradara/routing';
import {
  blockExamples,
  exampleForKind,
  UNEXAMPLED,
} from '../lib/gradara/block-examples';

const folder = new URL('../models/examples/blocks/', import.meta.url);
const load = (id: string): Project =>
  JSON.parse(readFileSync(new URL(`${id}.json`, folder), 'utf8')) as Project;

type Rect = { x: number; y: number; width: number; height: number };
const overlaps = (a: Rect, b: Rect) =>
  a.x < b.x + b.width &&
  b.x < a.x + a.width &&
  a.y < b.y + b.height &&
  b.y < a.y + a.height;
const inset = (r: Rect, d: number): Rect => ({
  x: r.x + d,
  y: r.y + d,
  width: r.width - 2 * d,
  height: r.height - 2 * d,
});

void test('every library block has an example, except the documented exceptions', () => {
  const missing = library
    .map((d) => d.kind)
    .filter((kind) => !(kind in UNEXAMPLED) && !exampleForKind(kind));
  assert.deepEqual(missing, []);
  for (const kind of Object.keys(UNEXAMPLED))
    assert.ok(
      library.some((d) => d.kind === kind),
      `${kind} is listed as having no example but is not in the library`,
    );
});

void test('the manifest lists every example file', () => {
  const files = readdirSync(folder)
    .filter((f) => f.endsWith('.json') && f !== 'index.json')
    .map((f) => f.replace(/\.json$/, ''))
    .sort();
  assert.deepEqual(files, blockExamples.map((e) => e.id).sort());
});

// The examples are the first diagrams many people see: hold each to the house style.
for (const entry of blockExamples) {
  void test(`${entry.id} example is drawn in house style`, () => {
    const p = load(entry.id);
    const issues: string[] = [];
    for (const f of layoutFindings(p))
      issues.push(`${f.kind}: ${f.ids.join(', ')}`);
    const routes = p.wires.map((w) => ({ w, pts: polylineOfWire(p, w.id) }));
    for (const { w, pts } of routes) {
      for (let i = 1; i < pts.length; i++)
        if (
          Math.abs(pts[i].x - pts[i - 1].x) > 1e-6 &&
          Math.abs(pts[i].y - pts[i - 1].y) > 1e-6
        )
          issues.push(`${w.id} has a diagonal segment`);
      if (overlapsDifferentNet(p, w.id))
        issues.push(`${w.id} runs along a wire of another net`);
    }
    const names = new Set<string>();
    for (const b of p.blocks) {
      const name = b.definition.name;
      if (names.has(name)) issues.push(`two blocks are named ${name}`);
      names.add(name);
      const standard = defaultBlockSize(b.definition);
      const size =
        b.rotation && b.rotation % 180
          ? { width: standard.height, height: standard.width }
          : standard;
      if (b.size?.width !== size.width || b.size?.height !== size.height)
        issues.push(`${name} is not at its standard size`);
      if (b.position.x % 8 || b.position.y % 8)
        issues.push(`${name} is off the sheet grid`);
      const label = labelOf(b);
      for (const o of p.blocks) {
        if (overlaps(label, bodyOf(o)))
          issues.push(`the name of ${name} overlaps ${o.definition.name}`);
        if (o !== b && overlaps(label, labelOf(o)))
          issues.push(`the names of ${name} and ${o.definition.name} overlap`);
      }
      for (const { w, pts } of routes)
        if (
          pts.some(
            (q, i) => i > 0 && segmentHitsRect(pts[i - 1], q, inset(label, 2)),
          )
        )
          issues.push(`wire ${w.id} crosses the name of ${name}`);
    }
    const right = Math.max(
      ...p.blocks.map((b) => bodyOf(b).x + bodyOf(b).width),
    );
    const bottom = Math.max(
      ...p.blocks.map((b) => labelOf(b).y + labelOf(b).height),
    );
    if (right > 2000 || bottom > 1200)
      issues.push(
        `the sheet is ${right} × ${bottom}; keep it within 2000 × 1200`,
      );
    assert.deepEqual([...new Set(issues)], []);
  });
}
