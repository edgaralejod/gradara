import test from 'node:test';
import assert from 'node:assert/strict';
import {
  initialProject,
  library,
  type Block,
  type Project,
} from '../lib/gradara/model';
import {
  blockSize,
  CanvasGestures,
  reconcileNodes,
} from '../lib/gradara/canvas';
import { flattenWires, endpointPoint } from '../lib/gradara/net';
import { polylineOfWire } from '../lib/gradara/net-draw';
import { normalizeJunctions } from '../lib/gradara/net-layout';
import { duplicateBlocks, semanticSignature } from '../lib/gradara/project';
import {
  emptySelection,
  extractSelection,
  layoutSelection,
  pasteSelection,
  resolveSelection,
  translateSelection,
  wiresInRect,
  selectionInRect,
} from '../lib/gradara/selection';
import {
  browserCopyDragHost,
  installCopyDrag,
  type CopyPreview,
} from '../lib/gradara/copy-drag';
import { focProject } from '../lib/gradara/foc';

function block(kind: string, id: string, x: number, y: number): Block {
  return {
    id,
    definition: structuredClone(library.find((d) => d.kind === kind)!),
    position: { x, y },
  };
}
function branched(): Project {
  return {
    ...initialProject(),
    blocks: [
      block('step', 'source', 0, 0),
      block('gain', 'gain', 300, -4),
      block('scope', 'sink', 300, 172),
    ],
    junctions: [{ id: 'j1', domain: 'signal', position: { x: 140, y: 28 } }],
    wires: [
      {
        id: 'trunk',
        source: 'source',
        sourceHandle: 'y',
        target: 'j1',
        targetHandle: 'node',
      },
      {
        id: 'upper',
        source: 'j1',
        sourceHandle: 'node',
        target: 'gain',
        targetHandle: 'u',
      },
      {
        id: 'lower',
        source: 'j1',
        sourceHandle: 'node',
        target: 'sink',
        targetHandle: 'u',
        waypoints: [{ x: 140, y: 204 }],
      },
    ],
  };
}
const all = (p: Project) => ({
  ...emptySelection(),
  blockIds: p.blocks.map((b) => b.id),
});
const delta = { x: 40, y: 60 };
const shift = (p: { x: number; y: number }) => ({
  x: p.x + delta.x,
  y: p.y + delta.y,
});
function geometry(p: Project) {
  for (const w of p.wires) {
    const points = polylineOfWire(p, w.id);
    const a = endpointPoint(p, w.source, w.sourceHandle)!;
    const b = endpointPoint(p, w.target, w.targetHandle)!;
    assert.deepEqual(points[0], { x: a.x, y: a.y });
    assert.deepEqual(points.at(-1), { x: b.x, y: b.y });
    assert.ok(
      points.every(
        (point, i) =>
          !i || point.x === points[i - 1].x || point.y === points[i - 1].y,
      ),
      `orthogonal ${w.id}`,
    );
  }
}

void test('duplicate a branched controller with fresh junction IDs, internal connections, labels, and parameters', () => {
  const p = branched();
  p.blocks[1].labelOffset = { x: 24, y: -60 };
  const snapshot = structuredClone(p);
  const copy = duplicateBlocks(p, all(p).blockIds);
  assert.equal(copy.project.junctions!.length, 2);
  const cloned = new Set(copy.ids);
  const logical = flattenWires(copy.project).filter(
    (w) => cloned.has(w.source) && cloned.has(w.target),
  );
  assert.equal(logical.length, 2);
  assert.equal(flattenWires(copy.project).length, 4);
  const copiedGain = copy.project.blocks.find(
    (b) => cloned.has(b.id) && b.definition.kind === 'gain',
  )!;
  assert.deepEqual(copiedGain.labelOffset, p.blocks[1].labelOffset);
  copiedGain.definition.parameters[0].value = 90;
  assert.deepEqual(
    p,
    snapshot,
    'copy is independent, including nested definitions',
  );
  assert.equal(
    new Set(
      [
        ...copy.project.blocks,
        ...copy.project.junctions!,
        ...copy.project.wires,
      ].map((e) => e.id),
    ).size,
    14,
  );
  geometry(copy.project);
});

void test('partial duplication retains the selected source and sink path, with the external branch omitted', () => {
  const p = branched();
  const f = extractSelection(p, {
    ...emptySelection(),
    blockIds: ['source', 'sink'],
  });
  assert.equal(f.blocks.length, 2);
  assert.equal(f.junctions.length, 0);
  assert.equal(f.wires.length, 1);
  const next = { ...p, ...f };
  assert.deepEqual(
    flattenWires(next).map((w) => [w.source, w.target]),
    [['source', 'sink']],
  );
  assert.deepEqual(polylineOfWire(next, f.wires[0].id), [
    { x: 64, y: 28 },
    { x: 140, y: 28 },
    { x: 140, y: 204 },
    { x: 300, y: 204 },
  ]);
  geometry(next);
});

void test('copying only sinks does not invent a source or link back to an external driver', () => {
  const f = extractSelection(branched(), {
    ...emptySelection(),
    blockIds: ['gain', 'sink'],
  });
  assert.equal(f.blocks.length, 2);
  assert.deepEqual(f.wires, []);
  assert.deepEqual(f.junctions, []);
});

void test('undirected physical branches copy and move independently of wire record direction', () => {
  const p = branched();
  for (const b of p.blocks)
    b.definition.ports.forEach((port) => {
      port.direction = 'physical';
      port.domain = 'electrical';
    });
  p.junctions![0].domain = 'electrical';
  p.wires = p.wires.map((w) => ({
    ...w,
    source: w.target,
    sourceHandle: w.targetHandle,
    target: w.source,
    targetHandle: w.sourceHandle,
    waypoints: w.waypoints?.slice().reverse(),
  }));
  const copy = duplicateBlocks(p, ['gain', 'sink']);
  assert.equal(flattenWires(copy.project).length, flattenWires(p).length + 1);
  const next = normalizeJunctions(translateSelection(p, all(p), delta));
  for (const w of p.wires)
    assert.deepEqual(
      polylineOfWire(next, w.id),
      polylineOfWire(p, w.id).map(shift),
    );
  geometry(next);
});

void test('whole-selection movement preserves every internal bend and dot in preview, commit, and reload', () => {
  const p = branched();
  const layouts = p.blocks.map((b) => ({
    id: b.id,
    position: shift(b.position),
    size: blockSize(b),
  }));
  for (const snap of [false, true]) {
    const next = normalizeJunctions(layoutSelection(p, layouts, all(p), snap));
    assert.deepEqual(next.junctions![0].position, { x: 180, y: 88 });
    for (const w of p.wires)
      assert.deepEqual(
        polylineOfWire(next, w.id),
        polylineOfWire(p, w.id).map(shift),
      );
    assert.equal(semanticSignature(next), semanticSignature(p));
    assert.deepEqual(normalizeJunctions(structuredClone(next)), next);
    geometry(next);
  }
});

void test('group movement stretches the external boundary without moving the external block', () => {
  const p = branched();
  const s = { ...emptySelection(), blockIds: ['source', 'gain'] };
  const next = normalizeJunctions(translateSelection(p, s, delta));
  assert.equal(next.blocks[2], p.blocks[2]);
  assert.deepEqual(
    next.junctions![0].position,
    shift(p.junctions![0].position),
  );
  for (const id of ['trunk', 'upper'])
    assert.deepEqual(
      polylineOfWire(next, id),
      polylineOfWire(p, id).map(shift),
    );
  assert.equal(semanticSignature(next), semanticSignature(p));
  geometry(next);
});

void test('multiple junctions and feedback translate as a unit without accumulating bends', () => {
  const p = branched();
  p.blocks.push(block('scope', 'extra', 500, 300));
  p.junctions!.push({
    id: 'j2',
    domain: 'signal',
    position: { x: 220, y: 28 },
  });
  p.wires[1] = { ...p.wires[1], source: 'j2' };
  p.wires.push(
    {
      id: 'middle',
      source: 'j2',
      sourceHandle: 'node',
      target: 'j1',
      targetHandle: 'node',
    },
    {
      id: 'extra',
      source: 'j2',
      sourceHandle: 'node',
      target: 'extra',
      targetHandle: 'u',
      waypoints: [{ x: 220, y: 332 }],
    },
  );
  p.wires.push({
    id: 'feedback',
    source: 'gain',
    sourceHandle: 'y',
    target: 'source',
    targetHandle: 'feedback',
    waypoints: [
      { x: 400, y: 28 },
      { x: 400, y: -100 },
      { x: 90, y: -100 },
      { x: 90, y: 28 },
    ],
  });
  p.blocks[0].definition.ports.push({
    id: 'feedback',
    name: 'feedback',
    direction: 'input',
    domain: 'signal',
    side: 'left',
  });
  let next = p;
  for (let i = 0; i < 10; i++) {
    next = translateSelection(next, all(p), delta);
    next = translateSelection(next, all(p), { x: -delta.x, y: -delta.y });
  }
  for (const w of p.wires)
    assert.deepEqual(polylineOfWire(next, w.id), polylineOfWire(p, w.id));
  assert.deepEqual(next.junctions, p.junctions);
  assert.equal(semanticSignature(next), semanticSignature(p));
  geometry(next);
});

void test('group grid snapping uses one delta and preserves off-grid spacing through release', () => {
  const p = branched();
  const g = new CanvasGestures();
  const nodes = reconcileNodes([], [], p.blocks, all(p).blockIds);
  const changes = p.blocks.map((b) => ({
    id: b.id,
    type: 'position' as const,
    position: {
      x: b.position.x + 40,
      y: Math.round((b.position.y + 60) / 20) * 20,
    },
    dragging: true,
  }));
  const preview = g.apply(changes, nodes);
  assert.equal(preview.layouts.length, 0);
  assert.deepEqual(
    preview.nodes.map((n) => n.position),
    p.blocks.map((b) => shift(b.position)),
  );
  const done = g.apply(
    changes.map((c) => ({ ...c, dragging: false })),
    preview.nodes,
  );
  assert.deepEqual(
    done.layouts.map((l) => l.position),
    p.blocks.map((b) => shift(b.position)),
  );
  assert.equal(g.apply([], done.nodes).layouts.length, 0, 'commit only once');
});

void test('wire-only region movement keeps ports fixed and topology unchanged', () => {
  const p = branched();
  const region = wiresInRect(p, { x: 130, y: 90, width: 20, height: 30 });
  assert.deepEqual(region.wireIds, ['lower']);
  const next = normalizeJunctions(
    translateSelection(p, { ...emptySelection(), ...region }, delta),
  );
  assert.deepEqual(next.blocks, p.blocks);
  assert.equal(semanticSignature(next), semanticSignature(p));
  geometry(next);
});

void test('marquee selection resolves blocks and wires from one rectangle without waiting for renderer selection', () => {
  const p = branched();
  assert.deepEqual(
    selectionInRect(p, { x: -10, y: -10, width: 430, height: 260 }),
    {
      blockIds: p.blocks.map((b) => b.id),
      wireIds: p.wires.map((w) => w.id),
      junctionIds: ['j1'],
    },
  );
  assert.deepEqual(
    selectionInRect(p, { x: 130, y: 90, width: 20, height: 30 }),
    { blockIds: [], wireIds: ['lower'], junctionIds: [] },
  );
});

void test('empty or stale selections are no-ops, and pasted snapshots get independent IDs', () => {
  const p = branched();
  assert.deepEqual(
    resolveSelection(p, { ...emptySelection(), blockIds: ['missing'] }),
    emptySelection(),
  );
  assert.equal(translateSelection(p, emptySelection(), delta), p);
  assert.equal(translateSelection(p, all(p), { x: NaN, y: 0 }), p);
  const f = extractSelection(p, all(p));
  p.blocks[0].definition.name = 'Changed since copy';
  const a = pasteSelection(p, f),
    b = pasteSelection(a.project, f);
  assert.notEqual(
    b.project.blocks.at(-3)!.definition.name,
    p.blocks[0].definition.name,
  );
  assert.equal(new Set(b.project.blocks.map((block) => block.id)).size, 9);
  assert.equal(flattenWires(b.project).length, 6);
});

function nativeFrameWindow() {
  const bus = new EventTarget();
  const frames = new Map<number, FrameRequestCallback>();
  let counter = 0;
  const target = Object.assign(bus, {
    requestAnimationFrame(this: EventTarget, callback: FrameRequestCallback) {
      if (this !== bus) throw new TypeError('Illegal invocation');
      frames.set(++counter, callback);
      return counter;
    },
    cancelAnimationFrame(this: EventTarget, id: number) {
      if (this !== bus) throw new TypeError('Illegal invocation');
      frames.delete(id);
    },
  }) as unknown as Window;
  return { bus, frames, target };
}

void test('the browser copy-drag adapter preserves the native Window receiver for scheduling and cancellation', () => {
  const { target, frames } = nativeFrameWindow();
  const oldHost = {
    // oxlint-disable-next-line typescript/unbound-method -- Reproduce the reported browser failure.
    requestFrame: target.requestAnimationFrame,
    // oxlint-disable-next-line typescript/unbound-method -- Verify the same failure during cancellation.
    cancelFrame: target.cancelAnimationFrame,
  };
  assert.throws(() => oldHost.requestFrame(() => {}), /Illegal invocation/);
  const host = browserCopyDragHost(target);
  const id = host.requestFrame(() => {});
  assert.equal(frames.size, 1);
  assert.throws(() => oldHost.cancelFrame(id), /Illegal invocation/);
  host.cancelFrame(id);
  assert.equal(frames.size, 0);
});

function copyDragHarness(p: Project, selected = all(p)) {
  const { bus, frames, target: browserWindow } = nativeFrameWindow();
  const captured = new Set<number>();
  const root = {
    dataset: { wiring: 'idle' } as Record<string, string>,
    tabIndex: 0,
    focus() {},
    setPointerCapture(id: number) {
      captured.add(id);
    },
    hasPointerCapture(id: number) {
      return captured.has(id);
    },
    releasePointerCapture(id: number) {
      captured.delete(id);
    },
    removeAttribute(name: string) {
      if (name === 'data-copying') delete this.dataset.copying;
    },
  };
  const node = { dataset: { id: p.blocks[0].id }, closest: () => root };
  const target = {
    closest: (selector: string) =>
      selector === '.react-flow__node[data-id]'
        ? node
        : selector === '.react-flow'
          ? root
          : null,
  };
  const previews: (CopyPreview | null)[] = [],
    commits: CopyPreview[] = [];
  let current = p;
  const cleanup = installCopyDrag(
    () => ({
      project: current,
      selection: selected,
      onPreview: (p) => previews.push(p),
      onCommit: (p) => commits.push(p),
    }),
    { screenToFlowPosition: (p) => ({ x: p.x / 2, y: p.y / 2 }) },
    browserCopyDragHost(browserWindow),
  );
  const send = (type: string, fields: Record<string, unknown> = {}) => {
    const e = new Event(type, { cancelable: true });
    for (const [key, value] of Object.entries({
      target,
      pointerId: 1,
      ctrlKey: false,
      button: 0,
      clientX: 100,
      clientY: 100,
      ...fields,
    }))
      Object.defineProperty(e, key, { value });
    bus.dispatchEvent(e);
    return e;
  };
  const paint = () => {
    const pending = [...frames.values()];
    frames.clear();
    pending.forEach((f) => f(0));
  };
  return {
    previews,
    commits,
    captured,
    frames,
    send,
    paint,
    cleanup,
    replaceProject: () => {
      current = structuredClone(p);
    },
  };
}

void test('Ctrl-drag preserves originals, previews stable copy IDs at zoom, and commits once at release', () => {
  const p = branched(),
    before = structuredClone(p),
    h = copyDragHarness(p);
  assert.ok(h.send('pointerdown', { ctrlKey: true }).defaultPrevented);
  h.send('pointermove', { clientX: 180, clientY: 220 });
  h.paint();
  const preview = h.previews.at(-1)!;
  assert.equal(preview.project.blocks.length, 6);
  assert.deepEqual(preview.project.blocks.slice(0, 3), before.blocks);
  assert.deepEqual(
    preview.project.blocks.slice(3).map((b) => b.position),
    p.blocks.map((b) => shift(b.position)),
  );
  assert.equal(flattenWires(preview.project).length, 4);
  assert.equal(h.commits.length, 0, 'preview does not save or create history');
  for (let i = 0; i < p.wires.length; i++)
    assert.deepEqual(
      polylineOfWire(preview.project, preview.selection.wireIds[i]),
      polylineOfWire(p, p.wires[i].id).map(shift),
    );
  h.send('pointermove', { clientX: 260, clientY: 220 });
  h.send('pointerup', { clientX: 260, clientY: 220 });
  assert.equal(h.commits.length, 1);
  assert.deepEqual(
    h.commits[0].selection,
    preview.selection,
    'IDs do not change during movement',
  );
  assert.deepEqual(h.commits[0].project.blocks[3].position, { x: 80, y: 60 });
  assert.equal(h.previews.at(-1), null);
  assert.equal(h.frames.size, 0);
  assert.equal(h.captured.size, 0);
  assert.deepEqual(p, before);
  h.cleanup();
});

void test('Ctrl-drag cancellation, focus loss, and a changed document never commit a stale draft', () => {
  for (const action of ['escape', 'blur', 'pointercancel', 'changed']) {
    const h = copyDragHarness(branched());
    h.send('pointerdown', { ctrlKey: true });
    h.send('pointermove', { clientX: 180, clientY: 220 });
    h.paint();
    if (action === 'escape') h.send('keydown', { key: 'Escape' });
    else if (action === 'changed') h.replaceProject();
    else h.send(action);
    h.send('pointerup', { clientX: 180, clientY: 220 });
    assert.equal(h.commits.length, 0, action);
    assert.equal(h.previews.at(-1), null);
    assert.equal(h.captured.size, 0);
    h.cleanup();
  }
});

void test('Ctrl-click without dragging creates nothing; Ctrl-dragging an unselected block copies only that block', () => {
  const p = branched(),
    h = copyDragHarness(p, { ...emptySelection(), blockIds: ['gain', 'sink'] });
  h.send('pointerdown', { ctrlKey: true });
  h.send('pointerup');
  assert.equal(h.commits.length, 0);
  assert.equal(h.previews.filter(Boolean).length, 0);
  h.send('pointerdown', { ctrlKey: true });
  h.send('pointerup', { clientX: 180, clientY: 220 });
  assert.equal(h.commits[0].project.blocks.length, 4);
  assert.equal(
    h.commits[0].project.wires.length,
    3,
    'external wires are not copied',
  );
  h.cleanup();
});

void test('the full FOC example preserves signal and physical connectivity through group movement and duplication', () => {
  const p = focProject();
  const selection = all(p);
  const moved = translateSelection(p, selection, delta);
  assert.equal(semanticSignature(moved), semanticSignature(p));
  for (const w of p.wires)
    assert.deepEqual(
      polylineOfWire(moved, w.id),
      polylineOfWire(p, w.id).map(shift),
    );
  const copy = duplicateBlocks(p, selection.blockIds);
  assert.equal(copy.ids.length, p.blocks.length);
  assert.equal(flattenWires(copy.project).length, 2 * flattenWires(p).length);
  geometry(copy.project);
});

void test('fine and coarse nudges preserve branched geometry and numerical identity', () => {
  const p = branched();
  let next = p;
  for (const step of [1, 1, 1, 10])
    next = normalizeJunctions(
      translateSelection(next, all(next), { x: step, y: -step }),
    );
  for (const b of p.blocks) {
    const moved = next.blocks.find((n) => n.id === b.id)!;
    assert.deepEqual(moved.position, {
      x: b.position.x + 13,
      y: b.position.y - 13,
    });
  }
  assert.equal(semanticSignature(next), semanticSignature(p));
  for (const w of p.wires)
    assert.deepEqual(
      polylineOfWire(next, w.id),
      polylineOfWire(p, w.id).map((point) => ({
        x: point.x + 13,
        y: point.y - 13,
      })),
    );
  geometry(next);
});

void test('nudging a branch moves its junction without moving unselected blocks', () => {
  const p = branched();
  const next = normalizeJunctions(
    translateSelection(
      p,
      { ...emptySelection(), wireIds: ['upper'] },
      { x: 0, y: 10 },
    ),
  );
  assert.deepEqual(next.blocks, p.blocks);
  assert.equal(semanticSignature(next), semanticSignature(p));
  assert.notDeepEqual(
    polylineOfWire(next, 'upper'),
    polylineOfWire(p, 'upper'),
  );
  geometry(next);
});

void test('repeated fine wire nudges keep fixed ports and do not accumulate retraced spurs', () => {
  let project = initialProject();
  const id = project.wires[0].id;
  const original = polylineOfWire(project, id);
  const selection = { ...emptySelection(), wireIds: [id] };
  for (let i = 0; i < 12; i++) {
    project = translateSelection(project, selection, { x: 0, y: 1 });
    const points = polylineOfWire(project, id);
    assert.deepEqual(points[0], original[0]);
    assert.deepEqual(points.at(-1), original.at(-1));
    assert.ok(points.length <= original.length + 4);
    for (let j = 1; j < points.length; j++) {
      assert.ok(
        points[j].x >= points[j - 1].x,
        'left-to-right route must not double back',
      );
    }
  }
});
