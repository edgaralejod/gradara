import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import type { Project } from '../lib/gradara/model';
import { defaultBlockSize } from '../lib/gradara/block-design';
import { polylineOfWire } from '../lib/gradara/net-draw';
import { normalizeProject } from '../lib/gradara/normalize-project';
import { bodyOf, labelOf, routeSheet } from '../lib/gradara/router';
import { segmentHitsRect } from '../lib/gradara/routing';
import { noteRect } from '../lib/gradara/sheet-bounds';

for (const name of [
  'dc',
  'foc',
  'buck',
  'flyback',
  'datacenter',
  'servo',
  'ev',
]) {
  void test(`${name} example uses standard bodies and clear orthogonal routes`, () => {
    const p: Project = JSON.parse(
      readFileSync(
        new URL(`../models/examples/${name}.json`, import.meta.url),
        'utf8',
      ),
    );
    assert.ok(
      p.plots?.length,
      `${name} needs a useful default simulation plot`,
    );
    for (const plot of p.plots ?? [])
      for (const key of plot.series)
        assert.ok(
          p.blocks.some((b) => b.id === key.split('.')[0]),
          `${name}: missing plot block ${key}`,
        );
    for (const block of p.blocks) {
      const standard = defaultBlockSize(block.definition);
      assert.deepEqual(
        block.size,
        block.rotation && block.rotation % 180
          ? { width: standard.height, height: standard.width }
          : standard,
        block.id,
      );
      const r = {
        x: block.position.x + 2,
        y: block.position.y + 2,
        w: block.size!.width - 4,
        h: block.size!.height - 4,
      };
      for (const wire of p.wires) {
        if (wire.source === block.id || wire.target === block.id) continue;
        const points = polylineOfWire(p, wire.id);
        for (let i = 1; i < points.length; i++) {
          const a = points[i - 1],
            b = points[i];
          assert.ok(
            Math.abs(a.x - b.x) < 0.001 || Math.abs(a.y - b.y) < 0.001,
            `${wire.id} is diagonal`,
          );
          const crosses =
            Math.abs(a.y - b.y) < 0.001
              ? a.y > r.y &&
                a.y < r.y + r.h &&
                Math.max(a.x, b.x) > r.x &&
                Math.min(a.x, b.x) < r.x + r.w
              : a.x > r.x &&
                a.x < r.x + r.w &&
                Math.max(a.y, b.y) > r.y &&
                Math.min(a.y, b.y) < r.y + r.h;
          assert.ok(!crosses, `${name}: ${wire.id} crosses ${block.id}`);
        }
      }
    }
  });
}

const overlaps = (
  a: { x: number; y: number; width: number; height: number },
  b: { x: number; y: number; width: number; height: number },
) =>
  a.x < b.x + b.width &&
  b.x < a.x + a.width &&
  a.y < b.y + b.height &&
  b.y < a.y + a.height;

for (const name of [
  'dc',
  'foc',
  'buck',
  'flyback',
  'datacenter',
  'servo',
  'ev',
]) {
  void test(`${name} example keeps names and notes clear of wires, blocks, and each other`, () => {
    const p = normalizeProject(
      JSON.parse(
        readFileSync(
          new URL(`../models/examples/${name}.json`, import.meta.url),
          'utf8',
        ),
      ) as Project,
    );
    const routes = [...routeSheet(p).routes.entries()];
    const notes = (p.annotations ?? []).map((a) => ({ a, r: noteRect(a) }));
    const crosses = (id: string, rect: Parameters<typeof overlaps>[0]) => {
      const pts = routes.find(([w]) => w === id)![1];
      return pts.some((q, i) => i > 0 && segmentHitsRect(pts[i - 1], q, rect));
    };
    const issues: string[] = [];
    for (const b of p.blocks) {
      const label = labelOf(b);
      for (const [id] of routes) {
        const w = p.wires.find((x) => x.id === id);
        if (w && w.source !== b.id && w.target !== b.id && crosses(id, label))
          issues.push(`a wire crosses the name of ${b.definition.name}`);
      }
      for (const o of p.blocks)
        if (o !== b && overlaps(label, bodyOf(o)))
          issues.push(
            `the name of ${b.definition.name} overlaps ${o.definition.name}`,
          );
      for (const n of notes)
        if (overlaps(label, n.r))
          issues.push(
            `the name of ${b.definition.name} overlaps the note ${n.a.text}`,
          );
    }
    for (const n of notes) {
      for (const b of p.blocks)
        if (overlaps(n.r, bodyOf(b)))
          issues.push(`the note ${n.a.text} overlaps ${b.definition.name}`);
      for (const [id] of routes)
        if (crosses(id, n.r))
          issues.push(`a wire crosses the note ${n.a.text}`);
    }
    assert.deepEqual([...new Set(issues)], []);
  });
}
