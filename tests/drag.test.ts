import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { Position } from '@xyflow/react';
import type { Project } from '../lib/gradara/model';
import { blockSize } from '../lib/gradara/canvas';
import { portPoint } from '../lib/gradara/ports';
import { polylineOfWire } from '../lib/gradara/net-draw';
import { routeBetween } from '../lib/gradara/routing';
import { emptySelection, layoutSelection } from '../lib/gradara/selection';
import { snapDraggedBlockPosition } from '../lib/gradara/placement';
import { normalizeProject } from '../lib/gradara/normalize-project';

const example = (name: string): Project =>
  normalizeProject(
    JSON.parse(readFileSync(`models/examples/${name}.json`, 'utf8')) as Project,
  );

/** The canvas drag: preview snap, then the single saved layout transaction. */
function drag(project: Project, id: string, to: { x: number; y: number }) {
  const block = project.blocks.find((b) => b.id === id)!;
  const preview = snapDraggedBlockPosition(project, id, to, [id]);
  const next = normalizeProject(
    layoutSelection(
      project,
      [{ id, position: preview, size: blockSize(block) }],
      {
        ...emptySelection(),
        blockIds: [id],
      },
    ),
    project,
  );
  return { preview, next, block: next.blocks.find((b) => b.id === id)! };
}

function reverses(points: { x: number; y: number }[]) {
  return points.some((b, i) => {
    if (i < 1 || i >= points.length - 1) return false;
    const a = points[i - 1],
      c = points[i + 1];
    const straight =
      (a.x === b.x && b.x === c.x) || (a.y === b.y && b.y === c.y);
    return (
      straight && (b.x - a.x) * (c.x - b.x) + (b.y - a.y) * (c.y - b.y) < 0
    );
  });
}

void test('a block snaps onto a horizontal and a vertical connection at the same time', () => {
  const p = example('dc');
  const motor = p.blocks.find((b) => b.id === 'motor')!;
  const { block, preview } = drag(p, 'motor', {
    x: motor.position.x + 7,
    y: motor.position.y - 11,
  });
  const drive = p.blocks.find((b) => b.id === 'drive')!;
  const load = p.blocks.find((b) => b.id === 'load')!;
  assert.equal(
    portPoint(block, 'p')!.y,
    portPoint(drive, 'p')!.y,
    'electrical run is straight',
  );
  assert.equal(
    portPoint(block, 'flange')!.x,
    portPoint(load, 'a')!.x,
    'shaft is straight',
  );
  assert.deepEqual(
    block.position,
    preview,
    'release lands exactly where the preview showed',
  );
});

void test('a pinned wire snaps to its adjacent bend, not to the far terminal', () => {
  const p = example('dc');
  const wire = p.wires.find(
    (w) => w.waypoints?.length && p.blocks.some((b) => b.id === w.source),
  )!;
  const source = p.blocks.find((b) => b.id === wire.source)!;
  const port = portPoint(source, wire.sourceHandle)!;
  const bend = wire.waypoints![0];
  if (port.side !== 'left' && port.side !== 'right') return;
  const off = {
    x: source.position.x,
    y: source.position.y + (bend.y - port.y) + 9,
  };
  const { block } = drag(p, source.id, off);
  assert.equal(portPoint(block, wire.sourceHandle)!.y, bend.y);
});

void test('dragging a block away and back leaves its junction and wires as they were', () => {
  const p = example('dc');
  const ground = p.blocks.find((b) => b.id === 'ground')!;
  const moved = drag(p, 'ground', {
    x: ground.position.x + 40,
    y: ground.position.y,
  }).next;
  const back = normalizeProject(
    layoutSelection(
      moved,
      [{ id: 'ground', position: ground.position, size: blockSize(ground) }],
      {
        ...emptySelection(),
        blockIds: ['ground'],
      },
      false,
    ),
    moved,
  );
  assert.deepEqual(back.junctions, p.junctions);
  for (const w of p.wires)
    assert.deepEqual(polylineOfWire(back, w.id), polylineOfWire(p, w.id), w.id);
});

void test('opposite terminals that point away from each other get an S route, never a doubled-back stub', () => {
  const points = routeBetween(
    { x: 200, y: 100 },
    { x: 100, y: 180 },
    Position.Right,
    Position.Left,
  );
  assert.equal(reverses(points), false);
  assert.ok(
    points.every(
      (p, i) => !i || p.x === points[i - 1].x || p.y === points[i - 1].y,
    ),
  );
});

void test('moving a block past its pinned bend releases the bend instead of routing back through the block', () => {
  const p = example('dc');
  const sensor = p.blocks.find((b) => b.id === 'sensor')!;
  const { next } = drag(p, 'sensor', {
    x: sensor.position.x - 200,
    y: sensor.position.y,
  });
  for (const w of next.wires.filter(
    (w) => w.source === 'sensor' || w.target === 'sensor',
  ))
    assert.equal(reverses(polylineOfWire(next, w.id)), false, w.id);
});

void test('ordinary drags across the curated examples keep every wire orthogonal and clean', () => {
  for (const name of ['dc', 'servo', 'foc', 'buck', 'flyback', 'datacenter']) {
    const p = example(name);
    for (const block of p.blocks)
      for (const [dx, dy] of [
        [40, 0],
        [0, 40],
        [-40, 0],
        [13, 7],
      ]) {
        const {
          next,
          preview,
          block: after,
        } = drag(p, block.id, {
          x: block.position.x + dx,
          y: block.position.y + dy,
        });
        assert.deepEqual(
          after.position,
          preview,
          `${name} ${block.id} jumps on release`,
        );
        for (const w of next.wires) {
          const points = polylineOfWire(next, w.id);
          assert.ok(
            points.every(
              (q, i) =>
                !i || q.x === points[i - 1].x || q.y === points[i - 1].y,
            ),
            `${name} ${w.id} diagonal`,
          );
        }
      }
  }
});
