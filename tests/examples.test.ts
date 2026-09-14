import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import type { Project } from '../lib/gradara/model';
import { defaultBlockSize } from '../lib/gradara/block-design';
import { polylineOfWire } from '../lib/gradara/net-draw';

for (const name of ['dc', 'foc', 'buck']) {
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
      assert.deepEqual(
        block.size,
        defaultBlockSize(block.definition),
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
