import test from 'node:test';
import assert from 'node:assert/strict';
import { initialProject, library } from '../lib/gradara/model';
import { fuzzyScore } from '../lib/gradara/fuzzy';
import { searchLibrary } from '../lib/gradara/catalog';
import {
  ALIGN_SNAP,
  placeDownstream,
  snapMovedBlocks,
  snapPoint,
} from '../lib/gradara/placement';
import { portPoint } from '../lib/gradara/ports';
import {
  pinRubberBand,
  rubberBandPoints,
  routeBetween,
} from '../lib/gradara/routing';
import { Position } from '@xyflow/react';
import {
  addWire,
  removeSelection,
  replaceDefinition,
  duplicateBlocks,
  semanticSignature,
} from '../lib/gradara/project';

void test('removing a block removes its incident wires and preserves unrelated wiring', () => {
  const p = initialProject();
  const next = removeSelection(p, ['controller']);
  assert.equal(next.blocks.length, 6);
  assert.equal(next.wires.length, 5);
  assert.ok(
    next.wires.every(
      (w) => w.source !== 'controller' && w.target !== 'controller',
    ),
  );
  assert.equal(p.blocks.length, 7);
});
void test('revising a controller preserves its compatible ports and current position', () => {
  const p = initialProject();
  const d = structuredClone(p.blocks[1].definition);
  d.equations += '\n';
  const next = replaceDefinition(p, 'controller', d);
  assert.deepEqual(next.wires, p.wires);
  assert.deepEqual(next.blocks[1].position, p.blocks[1].position);
  const removed = { ...d, ports: d.ports.filter((p) => p.id !== 'measured') };
  assert.equal(
    replaceDefinition(p, 'controller', removed).wires.length,
    p.wires.length - 1,
  );
});
void test('duplicates remap internal wires without connecting copies to the original graph', () => {
  const p = initialProject();
  const { project: next, ids } = duplicateBlocks(p, [
    'reference',
    'controller',
  ]);
  assert.equal(next.blocks.length, 9);
  assert.equal(next.wires.length, 9);
  const wire = next.wires.at(-1)!;
  assert.ok(ids.includes(wire.source));
  assert.ok(ids.includes(wire.target));
  assert.equal(new Set(next.blocks.map((b) => b.id)).size, 9);
});
void test('reject a second source on a signal input', () => {
  assert.throws(
    () =>
      addWire(initialProject(), {
        id: 'new',
        source: 'sensor',
        sourceHandle: 'y',
        target: 'controller',
        targetHandle: 'reference',
      }),
    /already has a source/,
  );
});
void test('layout and display name edits leave result validity unchanged', () => {
  const p = initialProject();
  const signature = semanticSignature(p);
  p.blocks[0].position.x += 100;
  p.name = 'My project';
  p.blocks[0].definition.name = 'Setpoint';
  assert.equal(semanticSignature(p), signature);
  p.blocks[0].definition.parameters[0].value = 75;
  assert.notEqual(semanticSignature(p), signature);
});

// Reproduce the interaction regressions through the same change stream used by React Flow.
import {
  applyLayout,
  blockSize,
  CanvasGestures,
  reconcileNodes,
  type CanvasNode,
} from '../lib/gradara/canvas';

void test('measurements survive selection and unrelated document updates', () => {
  const p = initialProject();
  const initial = reconcileNodes([], [], p.blocks, []);
  const gestures = new CanvasGestures();
  const measured = gestures.apply(
    [
      {
        id: 'reference',
        type: 'dimensions',
        dimensions: { width: 168, height: 130 },
      },
    ],
    initial,
  );
  assert.deepEqual(measured.layouts, []);
  const selected = reconcileNodes(measured.nodes, p.blocks, p.blocks, [
    'reference',
  ]);
  assert.deepEqual(selected[0].measured, { width: 168, height: 130 });
  assert.equal(selected[1], measured.nodes[1]);
  assert.equal(
    reconcileNodes(selected, p.blocks, p.blocks, ['reference']),
    selected,
  );
});
void test('dragging preserves transient geometry and produces only one saved transaction', () => {
  const p = initialProject();
  const g = new CanvasGestures();
  const initial = reconcileNodes([], [], p.blocks, []);
  const moving = g.apply(
    [
      {
        id: 'reference',
        type: 'position',
        position: { x: 100, y: 150 },
        dragging: true,
      },
    ],
    initial,
  );
  assert.deepEqual(moving.layouts, []);
  const selected = reconcileNodes(moving.nodes, p.blocks, p.blocks, [
    'reference',
  ]);
  assert.deepEqual(selected[0].position, { x: 100, y: 150 });
  const finished = g.apply(
    [
      {
        id: 'reference',
        type: 'position',
        position: { x: 120, y: 150 },
        dragging: false,
      },
    ],
    selected,
  );
  assert.equal(finished.layouts.length, 1);
  const next = applyLayout(p, finished.layouts);
  assert.deepEqual(next.blocks[0].position, { x: 120, y: 150 });
  assert.equal(next.blocks[0].size, undefined);
  assert.equal(semanticSignature(next), semanticSignature(p));
  assert.equal(applyLayout(next, finished.layouts), next);
});
void test('corner resize commits size and origin together, can undo, and keeps wires', () => {
  const p = initialProject();
  const g = new CanvasGestures();
  const initial = reconcileNodes([], [], p.blocks, ['reference']);
  const resizing = g.apply(
    [
      { id: 'reference', type: 'position', position: { x: -40, y: 65 } },
      {
        id: 'reference',
        type: 'dimensions',
        dimensions: { width: 208, height: 150 },
        setAttributes: true,
        resizing: true,
      },
    ],
    initial,
  );
  assert.deepEqual(resizing.layouts, []);
  assert.equal(resizing.nodes[0].width, 208);
  const reconciled = reconcileNodes(resizing.nodes, p.blocks, p.blocks, [
    'reference',
  ]);
  assert.equal(reconciled[0].width, 208);
  const finished = g.apply(
    [
      {
        id: 'reference',
        type: 'dimensions',
        dimensions: { width: 208, height: 150 },
        resizing: false,
      },
    ],
    reconciled,
  );
  assert.equal(finished.layouts.length, 1);
  const next = applyLayout(p, finished.layouts);
  assert.deepEqual(blockSize(next.blocks[0]), { width: 208, height: 150 });
  assert.deepEqual(next.blocks[0].position, { x: -40, y: 65 });
  assert.equal(next.wires, p.wires);
  assert.equal(semanticSignature(next), semanticSignature(p));
  const afterCommit = reconcileNodes(finished.nodes, p.blocks, next.blocks, [
    'reference',
  ]);
  const undone = reconcileNodes(afterCommit, next.blocks, p.blocks, [
    'reference',
  ]);
  assert.equal(undone[0].width, blockSize(p.blocks[0]).width);
  assert.deepEqual(undone[0].position, p.blocks[0].position);
});
void test('multi-selection drag saves all moved blocks as one edit', () => {
  const p = initialProject();
  const g = new CanvasGestures();
  let nodes: CanvasNode[] = reconcileNodes([], [], p.blocks, [
    'reference',
    'controller',
  ]);
  nodes = g.apply(
    ['reference', 'controller'].map((id) => ({
      id,
      type: 'position' as const,
      position: { x: 200, y: 200 },
      dragging: true,
    })),
    nodes,
  ).nodes;
  assert.equal(
    g.apply(
      [
        {
          id: 'reference',
          type: 'position',
          position: { x: 200, y: 200 },
          dragging: false,
        },
      ],
      nodes,
    ).layouts.length,
    0,
  );
  const end = g.apply(
    [
      {
        id: 'controller',
        type: 'position',
        position: { x: 200, y: 200 },
        dragging: false,
      },
    ],
    nodes,
  );
  assert.equal(end.layouts.length, 2);
});

void test('library kinds are unique and cover the drawing catalog', () => {
  const kinds = library.map((d) => d.kind);
  assert.equal(new Set(kinds).size, kinds.length);
  assert.ok(kinds.length >= 50);
  for (const needed of [
    'sine',
    'pid',
    'mux',
    'scope',
    'resistor',
    'subsystem',
    'gain',
    'pmsm',
  ])
    assert.ok(kinds.includes(needed), needed);
});

void test('fuzzy search ranks pid above unrelated blocks', () => {
  assert.ok((fuzzyScore('pid', 'PID') ?? 0) > (fuzzyScore('pid', 'Ramp') ?? 0));
  const hits = searchLibrary('int');
  assert.ok(hits.length > 0);
  assert.ok(
    hits.some((h) => /integrat/i.test(h.definition.name + h.definition.kind)),
  );
});

void test('downstream placement is on the grid and to the right', () => {
  const p = initialProject();
  const gain = library.find((d) => d.kind === 'gain')!;
  const at = placeDownstream(p.blocks[0], gain);
  assert.equal(at.x % 20, 0);
  assert.ok(at.x > p.blocks[0].position.x);
  assert.deepEqual(snapPoint({ x: 13, y: 27 }), { x: 20, y: 20 });
});

void test('a new block is placed so the connecting ports share a straight line', () => {
  const p = initialProject();
  const gain = library.find((d) => d.kind === 'gain')!;
  const at = placeDownstream(p.blocks[0], gain);
  const placed = { id: 'g', definition: gain, position: at };
  const from = portPoint(p.blocks[0], 'y')!;
  const to = portPoint(placed, 'u')!;
  assert.ok(Math.abs(from.y - to.y) < 0.001);
  assert.ok(to.x > from.x);
});

void test('a pin forces the first segment out of the block, click freezes that run', () => {
  const pts = rubberBandPoints(
    { x: 0, y: 40 },
    { x: 80, y: 10 },
    Position.Right,
  );
  assert.equal(pts[0].y, 40);
  assert.equal(pts[1].y, 40);
  assert.ok(pts[1].x >= 20);
  const pin = pinRubberBand({ x: 0, y: 40 }, { x: 80, y: 10 }, Position.Right);
  assert.equal(pin.exit, Position.Top);
  assert.equal(pin.origin.x, 80);
});

void test('aligned ports draw a single straight segment', () => {
  assert.deepEqual(
    routeBetween(
      { x: 10, y: 40 },
      { x: 200, y: 40 },
      Position.Right,
      Position.Left,
    ),
    [
      { x: 10, y: 40 },
      { x: 200, y: 40 },
    ],
  );
  const jog = routeBetween(
    { x: 10, y: 40 },
    { x: 200, y: 90 },
    Position.Right,
    Position.Left,
  );
  assert.ok(jog.some((p, i) => i > 0 && p.y === 40 && jog[i - 1]!.y === 40));
  assert.ok(jog.some((p, i) => i > 0 && p.y === 90 && jog[i - 1]!.y === 90));
});

void test('moving a block near a connected port snaps onto the straight line', () => {
  const step = library.find((d) => d.kind === 'step')!;
  const gain = library.find((d) => d.kind === 'gain')!;
  const a = { id: 'a', definition: step, position: { x: 0, y: 0 } };
  const b = { id: 'b', definition: gain, position: { x: 200, y: 10 } };
  const project = {
    ...initialProject(),
    blocks: [a, b],
    wires: [
      {
        id: 'w',
        source: 'a',
        sourceHandle: 'y',
        target: 'b',
        targetHandle: 'u',
      },
    ],
  };
  const from = portPoint(a, 'y')!;
  const before = portPoint(b, 'u')!;
  assert.ok(Math.abs(from.y - before.y) <= ALIGN_SNAP);
  assert.ok(Math.abs(from.y - before.y) > 0);
  const snapped = snapMovedBlocks(project, ['b']);
  const next = snapped.blocks.find((block) => block.id === 'b')!;
  const to = portPoint(next, 'u')!;
  assert.ok(Math.abs(from.y - to.y) < 0.001);
});

void test('resizing a block pulls its port back onto the connected line', () => {
  const step = library.find((d) => d.kind === 'step')!;
  const gain = library.find((d) => d.kind === 'gain')!;
  const a = { id: 'a', definition: step, position: { x: 0, y: 40 } };
  const at = placeDownstream(a, gain);
  const b = {
    id: 'b',
    definition: gain,
    position: at,
    size: { width: 72, height: 96 },
  };
  const project = {
    ...initialProject(),
    blocks: [a, b],
    wires: [
      {
        id: 'w',
        source: 'a',
        sourceHandle: 'y',
        target: 'b',
        targetHandle: 'u',
      },
    ],
  };
  const from = portPoint(a, 'y')!;
  assert.ok(Math.abs(from.y - portPoint(b, 'u')!.y) > 1);
  const snapped = snapMovedBlocks(project, ['b']);
  const to = portPoint(
    snapped.blocks.find((block) => block.id === 'b')!,
    'u',
  )!;
  assert.ok(Math.abs(from.y - to.y) < 0.001);
});

void test('right-to-left connections snap onto a nearby port row', () => {
  const gain = library.find((d) => d.kind === 'gain')!;
  const a = { id: 'src', definition: gain, position: { x: 400, y: 0 } };
  const b = { id: 'dst', definition: gain, position: { x: 0, y: 8 } };
  const project = {
    ...initialProject(),
    blocks: [a, b],
    wires: [
      {
        id: 'rtl',
        source: 'src',
        sourceHandle: 'y',
        target: 'dst',
        targetHandle: 'u',
      },
    ],
  };
  const from = portPoint(a, 'y')!;
  const before = portPoint(b, 'u')!;
  assert.ok(Math.abs(from.y - before.y) <= ALIGN_SNAP);
  assert.ok(Math.abs(from.y - before.y) > 0);
  const snapped = snapMovedBlocks(project, ['dst']);
  const to = portPoint(
    snapped.blocks.find((block) => block.id === 'dst')!,
    'u',
  )!;
  assert.ok(Math.abs(from.y - to.y) < 0.001);
});

// Branch gestures and rejection of driven-net drops are exercised through NetSession
// in wiring.test.ts, the same interaction owner used by the canvas.

void test('a second wire from the same output does not invent a mid-wire node', () => {
  const step = library.find((d) => d.kind === 'step')!;
  const gain = library.find((d) => d.kind === 'gain')!;
  const sat = library.find((d) => d.kind === 'saturation')!;
  const project = {
    ...initialProject(),
    blocks: [
      { id: 'a', definition: step, position: { x: 0, y: 0 } },
      { id: 'b', definition: gain, position: { x: 160, y: 0 } },
      { id: 'c', definition: sat, position: { x: 160, y: 120 } },
    ],
    wires: [
      {
        id: 'w0',
        source: 'a',
        sourceHandle: 'y',
        target: 'b',
        targetHandle: 'u',
      },
    ],
  };
  const next = addWire(project, {
    id: 'w1',
    source: 'a',
    sourceHandle: 'y',
    target: 'c',
    targetHandle: 'u',
  });
  assert.equal(next.junctions?.length ?? 0, 0);
  assert.equal(
    next.wires.filter((w) => w.source === 'a' && w.sourceHandle === 'y').length,
    2,
  );
});

void test('moving a label preserves block geometry, wiring, and simulation identity', async () => {
  const { setLabelOffset } = await import('../lib/gradara/project');
  const p = initialProject(),
    id = p.blocks[0].id;
  const next = setLabelOffset(p, id, { x: 45, y: -90 });
  assert.equal(next.blocks[0].position, p.blocks[0].position);
  assert.equal(next.wires, p.wires);
  assert.equal(next.blocks[0].definition, p.blocks[0].definition);
  assert.equal(semanticSignature(next), semanticSignature(p));
  assert.deepEqual(next.blocks[0].labelOffset, { x: 45, y: -90 });
  assert.equal(setLabelOffset(next, id, { x: 45, y: -90 }), next);
  assert.equal(setLabelOffset(next, id, { x: NaN, y: 0 }), next);
  assert.equal(
    setLabelOffset(next, id, undefined).blocks[0].labelOffset,
    undefined,
  );
});
void test('label positions follow block moves, survive duplication, and reconcile through undo', async () => {
  const { setLabelOffset, duplicateBlocks } =
    await import('../lib/gradara/project');
  const p = initialProject(),
    id = p.blocks[0].id;
  const nodes = reconcileNodes([], [], p.blocks, []);
  const labeled = setLabelOffset(p, id, { x: 30, y: -80 });
  const rendered = reconcileNodes(nodes, p.blocks, labeled.blocks, []);
  assert.deepEqual(rendered[0].data.labelOffset, { x: 30, y: -80 });
  assert.equal(rendered[0].position, nodes[0].position);
  const restored = reconcileNodes(rendered, labeled.blocks, p.blocks, []);
  assert.equal(restored[0].data.labelOffset, undefined);
  const moved = applyLayout(labeled, [
    { id, position: { x: 400, y: 500 }, size: blockSize(labeled.blocks[0]) },
  ]);
  assert.equal(moved.blocks[0].labelOffset, labeled.blocks[0].labelOffset);
  const copies = duplicateBlocks(labeled, [id]);
  assert.deepEqual(copies.project.blocks.at(-1)!.labelOffset, {
    x: 30,
    y: -80,
  });
});
