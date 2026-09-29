import test from 'node:test';
import assert from 'node:assert/strict';
import { library, type Block, type Project } from '../lib/gradara/model';
import { defaultBlockSize } from '../lib/gradara/block-design';
import { blockSize, minimumBlockSize } from '../lib/gradara/canvas';
import {
  GRID,
  SIZE_STEP,
  gridPortOffsets,
  gridSheet,
  snapLength,
} from '../lib/gradara/grid';
import { straightenNearRuns } from '../lib/gradara/grid-migrate';
import { portPoint } from '../lib/gradara/ports';
import { rotateBlocks } from '../lib/gradara/rotation';
import { normalizeProject } from '../lib/gradara/normalize-project';

const onGrid = (v: number) => Math.abs(v / GRID - Math.round(v / GRID)) < 1e-9;
const place = (kind: string, id: string, x: number, y: number): Block => ({
  id,
  definition: structuredClone(library.find((d) => d.kind === kind)!),
  position: { x, y },
});
const sheet = (blocks: Block[], wires: Project['wires'] = []): Project => ({
  version: 1,
  name: 'Grid',
  duration: 1,
  revision: 0,
  blocks,
  wires,
});

void test('every catalog block, at every quarter turn and grid size, has every port on the grid', () => {
  for (const definition of library) {
    const standard = defaultBlockSize(definition);
    assert.equal(standard.width % SIZE_STEP, 0, `${definition.kind} width`);
    assert.equal(standard.height % SIZE_STEP, 0, `${definition.kind} height`);
    for (const grow of [0, SIZE_STEP, 5 * SIZE_STEP]) {
      let project = sheet([
        {
          id: 'b',
          definition,
          position: { x: 8 * GRID, y: -3 * GRID },
          size: { width: standard.width + grow, height: standard.height },
        },
      ]);
      for (let turn = 0; turn < 4; turn++) {
        const [block] = project.blocks;
        assert.ok(onGrid(block.position.x) && onGrid(block.position.y));
        for (const port of definition.ports) {
          const p = portPoint(block, port.id)!;
          assert.ok(
            onGrid(p.x) && onGrid(p.y),
            `${definition.kind}.${port.id} at ${turn * 90}°: ${p.x}, ${p.y}`,
          );
        }
        project = rotateBlocks(project, ['b']);
      }
      // Four quarter turns bring the block back where it started.
      assert.deepEqual(project.blocks[0].position, {
        x: 8 * GRID,
        y: -3 * GRID,
      });
    }
  }
});

void test('ports are spread evenly, stay inside the corners, and center on the side', () => {
  for (let length = SIZE_STEP * 3; length <= 320; length += SIZE_STEP)
    for (let count = 1; count <= 8; count++) {
      const offsets = gridPortOffsets(length, count);
      assert.ok(offsets.every(onGrid), `${count} on ${length}`);
      const gaps = offsets.slice(1).map((o, i) => o - offsets[i]);
      assert.ok(gaps.every((g) => g === gaps[0] && g >= GRID));
      if (count > 1 && (count - 1) * GRID <= length - 2 * GRID)
        assert.ok(offsets[0] >= GRID && offsets.at(-1)! <= length - GRID);
      // Centered, or at most half a step toward the side's start.
      const middle = (offsets[0] + offsets.at(-1)!) / 2;
      assert.ok(length / 2 - middle >= 0 && length / 2 - middle <= GRID / 2);
    }
});

void test('sizes snap to whole size steps above the minimum, and a gridded sheet is left alone', () => {
  assert.equal(snapLength(71), 64);
  assert.equal(snapLength(73), 80);
  assert.equal(snapLength(10, 44), 48);
  const block = place('gain', 'g', 101, 37);
  block.size = { width: 101, height: 70 };
  const project = sheet([block]);
  const size = (b: Block) => blockSize(b);
  const min = (b: Block) => minimumBlockSize(b.definition, b.rotation);
  const gridded = gridSheet(project, size, min);
  const [g] = gridded.blocks;
  assert.deepEqual(g.size, { width: 96, height: 64 });
  // Resized about its center, then onto the grid.
  assert.deepEqual(g.position, { x: 104, y: 40 });
  assert.equal(gridSheet(gridded, size, min), gridded);
});

void test('an older document opens on the grid with its nearly straight wires straight', () => {
  // Rows one grid step apart once each block lands on the grid.
  const older = sheet(
    [place('step', 'a', 0, 3), place('gain', 'b', 150, 5)],
    [
      {
        id: 'w',
        source: 'a',
        sourceHandle: 'y',
        target: 'b',
        targetHandle: 'u',
      },
    ],
  );
  const opened = normalizeProject(older);
  const [a, b] = opened.blocks;
  for (const block of opened.blocks)
    assert.ok(onGrid(block.position.x) && onGrid(block.position.y));
  assert.equal(portPoint(a, 'y')!.y, portPoint(b, 'u')!.y);
  assert.equal(normalizeProject(opened), opened);
});

void test('straightening moves a free block, never one already holding a straight wire', () => {
  const blocks = [
    place('step', 'a', 0, 0),
    place('gain', 'b', 160, 8),
    place('step', 'c', 0, 200),
  ];
  const wire = (id: string, source: string, target: string) => ({
    id,
    source,
    sourceHandle: 'y',
    target,
    targetHandle: 'u',
  });
  const moved = straightenNearRuns(sheet(blocks, [wire('w', 'a', 'b')]));
  assert.deepEqual(moved.blocks[1].position, { x: 160, y: 0 });
  assert.deepEqual(moved.blocks[0], blocks[0]);
  // b already lines up with a, so the second wire moves c instead.
  const both = sheet(
    [
      blocks[0],
      { ...blocks[1], position: { x: 160, y: 0 } },
      place('step', 'c', 0, 8),
    ],
    [wire('w', 'a', 'b'), wire('v', 'c', 'b')],
  );
  const fixed = straightenNearRuns(both);
  assert.deepEqual(fixed.blocks[1].position, { x: 160, y: 0 });
  // c's only wire goes to b, and b is anchored: c moves.
  assert.deepEqual(fixed.blocks[2].position, { x: 0, y: 0 });
  // A gap wider than a step is deliberate and stays.
  const far = sheet(
    [blocks[0], { ...blocks[1], position: { x: 160, y: 24 } }],
    [wire('w', 'a', 'b')],
  );
  assert.equal(straightenNearRuns(far), far);
});

void test('resizing keeps the block where the pointer left it; moving still pulls it onto a wire row', async () => {
  const { layoutSelection } = await import('../lib/gradara/selection');
  const project = sheet(
    [
      { ...place('step', 'a', 0, 0), size: { width: 64, height: 64 } },
      { ...place('gain', 'b', 160, 0), size: { width: 80, height: 64 } },
    ],
    [
      {
        id: 'w',
        source: 'a',
        sourceHandle: 'y',
        target: 'b',
        targetHandle: 'u',
      },
    ],
  );
  // Taller, from the bottom edge: the input moves down a step, and the block stays.
  const resized = layoutSelection(project, [
    { id: 'b', position: { x: 160, y: 0 }, size: { width: 80, height: 80 } },
  ]);
  assert.deepEqual(resized.blocks[1].position, { x: 160, y: 0 });
  assert.equal(portPoint(resized.blocks[1], 'u')!.y, 40);
  // Moved a step off the row: pulled back onto it.
  const moved = layoutSelection(project, [
    { id: 'b', position: { x: 160, y: 8 }, size: { width: 80, height: 64 } },
  ]);
  assert.deepEqual(moved.blocks[1].position, { x: 160, y: 0 });
});
