import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import type { Project } from '../lib/gradara/model';
import { arrangeBlocks } from '../lib/gradara/arrange';
import { normalizeProject } from '../lib/gradara/normalize-project';
import { polylineOfWire } from '../lib/gradara/net-draw';
import { blockSize } from '../lib/gradara/canvas';
import { segmentHitsRect, selfIntersects } from '../lib/gradara/routing';
import { semanticSignature } from '../lib/gradara/project';

const example = (name: string): Project =>
  normalizeProject(
    JSON.parse(readFileSync(`models/examples/${name}.json`, 'utf8')) as Project,
  );
const arranged = (p: Project, ids: string[] = []) =>
  normalizeProject(arrangeBlocks(p, ids), p);
const body = (b: Project['blocks'][number]) => ({
  ...b.position,
  ...blockSize(b),
});

function scrambled(p: Project, seed = 7): Project {
  let s = seed;
  const rnd = () => ((s = (s * 16807) % 2147483647), s / 2147483647);
  return normalizeProject(
    {
      ...p,
      blocks: p.blocks.map((b) => ({
        ...b,
        position: {
          x: Math.round((rnd() * 1200) / 20) * 20,
          y: Math.round((rnd() * 800) / 20) * 20,
        },
      })),
      wires: p.wires.map(({ waypoints: _w, ...w }) => w),
    },
    p,
  );
}

function clean(p: Project, label: string) {
  for (let i = 0; i < p.blocks.length; i++)
    for (let j = i + 1; j < p.blocks.length; j++) {
      const a = body(p.blocks[i]),
        b = body(p.blocks[j]);
      assert.ok(
        !(
          a.x < b.x + b.width &&
          b.x < a.x + a.width &&
          a.y < b.y + b.height &&
          b.y < a.y + a.height
        ),
        `${label}: ${p.blocks[i].id} overlaps ${p.blocks[j].id}`,
      );
    }
  for (const w of p.wires) {
    const points = polylineOfWire(p, w.id);
    assert.equal(selfIntersects(points), false, `${label}: ${w.id} loops`);
    for (const b of p.blocks)
      assert.ok(
        !points.slice(1).some((q, i) => segmentHitsRect(points[i], q, body(b))),
        `${label}: ${w.id} runs through ${b.id}`,
      );
  }
}

const names = ['dc', 'servo', 'foc', 'buck', 'datacenter', 'ev'];

void test('arranging keeps every connection and draws no overlaps, loops, or wires through blocks', () => {
  for (const name of names) {
    const p = example(name);
    const next = arranged(p);
    assert.equal(semanticSignature(next), semanticSignature(p), name);
    clean(next, name);
  }
});

void test('arranging twice changes nothing, and a scrambled drawing arranges cleanly', () => {
  for (const name of names) {
    const once = arranged(example(name));
    const twice = arranged(once);
    assert.deepEqual(
      twice.blocks.map((b) => b.position),
      once.blocks.map((b) => b.position),
      `${name} is not stable`,
    );
    const messy = arranged(scrambled(example(name)));
    assert.equal(semanticSignature(messy), semanticSignature(once), name);
    clean(messy, `${name} scrambled`);
  }
});

void test('signal flow reads left to right and a ground sits under its terminal', () => {
  const p = arranged(example('dc'));
  const at = (id: string) => p.blocks.find((b) => b.id === id)!.position;
  for (const [a, b] of [
    ['reference', 'controller'],
    ['controller', 'drive'],
    ['drive', 'motor'],
  ])
    assert.ok(at(a).x < at(b).x, `${a} before ${b}`);
  const ground = p.blocks.find((b) => b.id === 'ground')!;
  assert.ok(
    at('ground').y > at('drive').y + blockSize(ground).height,
    'ground below the drive',
  );
  // The motor's shaft drops straight to its load.
  const shaft = polylineOfWire(
    p,
    p.wires.find(
      (w) =>
        [w.source, w.target].includes('load') &&
        [w.source, w.target].includes('motor'),
    )!.id,
  );
  assert.equal(shaft.length, 2, JSON.stringify(shaft));
});

void test('arranging a selection leaves every other block where it was', () => {
  const p = example('foc');
  const ids = ['park', 'clarke', 'inverse'];
  const next = arranged(p, ids);
  for (const b of p.blocks)
    if (!ids.includes(b.id))
      assert.deepEqual(
        next.blocks.find((x) => x.id === b.id)!.position,
        b.position,
        b.id,
      );
  clean(next, 'foc selection');
  assert.equal(semanticSignature(next), semanticSignature(p));
});

void test('Arrange only rearranges when the drawing reads better, and says so otherwise', async () => {
  const { arrangeIfBetter, layoutCost } =
    await import('../lib/gradara/arrange');
  for (const name of names) {
    const messy = scrambled(example(name));
    const first = arrangeIfBetter(messy);
    assert.equal(first.improved, true, `${name}: a scrambled sheet improves`);
    assert.ok(layoutCost(first.project) < layoutCost(messy), name);
    // An arranged sheet cannot be improved further.
    assert.equal(arrangeIfBetter(first.project).improved, false, name);
  }
  // The hand-drawn FOC example is cleaner than what Arrange would make of it.
  const foc = example('foc');
  const kept = arrangeIfBetter(foc);
  assert.equal(kept.improved, false);
  assert.equal(kept.project, foc);
});
