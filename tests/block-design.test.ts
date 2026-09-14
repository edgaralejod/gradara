import test from 'node:test';
import assert from 'node:assert/strict';
import { library } from '../lib/gradara/model';
import { blockSize } from '../lib/gradara/canvas';
import {
  defaultBlockSize,
  formatBlockValue,
} from '../lib/gradara/block-design';
import { portPoint, positionForPortAt } from '../lib/gradara/ports';
import { semanticSignature } from '../lib/gradara/project';
import { initialProject } from '../lib/gradara/model';

void test('every catalog insertion aligns its actual port with the requested wire endpoint', () => {
  for (const definition of library)
    for (const port of definition.ports) {
      const target = { x: 403, y: -127 };
      const block = {
        id: definition.kind,
        definition,
        position: positionForPortAt(definition, port, target),
        size: defaultBlockSize(definition),
      };
      const point = portPoint(block, port.id)!;
      assert.ok(
        Math.abs(point.x - target.x) < 1e-9 &&
          Math.abs(point.y - target.y) < 1e-9,
        `${definition.kind}.${port.id} misses insertion target`,
      );
    }
});
void test('new standards preserve legacy wiring geometry and never change numerical identity', () => {
  const project = initialProject();
  const legacy = project.blocks.find((b) => b.definition.kind === 'step')!;
  assert.deepEqual(blockSize(legacy), { width: 64, height: 56 });
  assert.deepEqual(blockSize({ ...legacy, size: { width: 101, height: 73 } }), {
    width: 101,
    height: 73,
  });
  assert.equal(
    semanticSignature(project),
    semanticSignature({
      ...project,
      blocks: project.blocks.map((b) => ({
        ...b,
        size: defaultBlockSize(b.definition),
      })),
    }),
  );
});
void test('unregistered agent blocks grow with terminal count and keep labels separate', () => {
  const definition = {
    ...library.find((d) => d.kind === 'step')!,
    kind: 'customPlant',
    ports: Array.from({ length: 8 }, (_, i) => ({
      id: `u${i}`,
      name: `u${i}`,
      domain: 'signal' as const,
      direction: 'input' as const,
    })),
  };
  const block = {
    id: 'test',
    definition,
    position: { x: 0, y: 0 },
    size: defaultBlockSize(definition),
  };
  const points = definition.ports.map((p) => portPoint(block, p.id)!);
  assert.ok(points.slice(1).every((p, i) => p.y - points[i].y >= 24 - 1e-9));
});
void test('notation bounds extreme values without replacing parameter precision', () => {
  for (const value of [123456789, -0.00000000001, Math.PI, 0, -999999999])
    assert.ok(formatBlockValue(value).length <= 9);
  assert.equal(formatBlockValue(1e10), '1e10');
  assert.equal(formatBlockValue(Math.PI), '3.142');
});

void test('standard, sum, and custom-height blocks snap to the same signal centerline', async () => {
  const { snapBlockPosition } = await import('../lib/gradara/block-design');
  for (const height of [40, 64, 73, 96, 170]) {
    const snapped = snapBlockPosition(
      { x: 133, y: 203 - height / 2 },
      { width: 80, height },
    );
    assert.equal(snapped.x, 140);
    assert.equal(snapped.y + height / 2, 200);
  }
});
void test('a mixed-height drag snaps one anchor and preserves group spacing', async () => {
  const { CanvasGestures, reconcileNodes } =
    await import('../lib/gradara/canvas');
  const project = initialProject();
  project.blocks = project.blocks.slice(0, 2).map((b, i) => ({
    ...b,
    position: { x: 100 + i * 140, y: i ? 80 : 68 },
    size: { width: 80, height: i ? 40 : 64 },
  }));
  const nodes = reconcileNodes([], [], project.blocks, []);
  const changes = nodes.map((n) => ({
    id: n.id,
    type: 'position' as const,
    dragging: false,
    position: { x: n.position.x + 33, y: n.position.y + 19 },
  }));
  const moved = new CanvasGestures().apply(changes, nodes, true);
  assert.equal(moved.nodes[0].position.y + 32, 120);
  assert.equal(moved.nodes[1].position.y + 20, 120);
  assert.equal(moved.nodes[1].position.x - moved.nodes[0].position.x, 140);
  assert.equal(moved.layouts.length, 2);
});

void test('nearby off-grid ports take priority over rounding and group members do not attract each other', async () => {
  const { snapDraggedBlockPosition } = await import('../lib/gradara/placement');
  const step = library.find((d) => d.kind === 'step')!;
  const sum = library.find((d) => d.kind === 'sum')!;
  const project = {
    ...initialProject(),
    blocks: [
      {
        id: 'step',
        definition: step,
        position: { x: 0, y: 71 },
        size: { width: 80, height: 64 },
      },
      {
        id: 'sum',
        definition: sum,
        position: { x: 180, y: 83 },
        size: { width: 40, height: 40 },
      },
    ],
    wires: [
      {
        id: 'wire',
        source: 'step',
        sourceHandle: 'y',
        target: 'sum',
        targetHandle: 'a',
      },
    ],
  };
  // Raw port is 11 units away; rounding first would push it to 17 and miss the magnet.
  const snapped = snapDraggedBlockPosition(project, 'sum', { x: 202, y: 94 });
  assert.equal(
    portPoint({ ...project.blocks[1], position: snapped }, 'a')!.y,
    103,
  );
  const grouped = snapDraggedBlockPosition(project, 'sum', { x: 202, y: 94 }, [
    'step',
    'sum',
  ]);
  assert.equal(grouped.y + 20, 120);
});

void test('null offsets from older API payloads use the same default port center as omitted offsets', () => {
  const definition = structuredClone(library.find((d) => d.kind === 'sum')!);
  definition.ports.forEach((p) => Object.assign(p, { offset: null }));
  const block = {
    id: 'sum',
    definition,
    position: { x: 180, y: 80 },
    size: { width: 40, height: 40 },
  };
  assert.equal(portPoint(block, 'a')!.y, 100);
  assert.equal(portPoint(block, 'y')!.y, 100);
});
