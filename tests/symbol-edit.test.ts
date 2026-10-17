import test from 'node:test';
import assert from 'node:assert/strict';
import { library, type Block, type Definition } from '../lib/gradara/model';
import { glyphProblem } from '../lib/gradara/glyph';
import { circuitLayout } from '../lib/gradara/circuit-symbols';
import { blockShape, defaultBlockSize } from '../lib/gradara/block-design';
import { portSide } from '../lib/gradara/ports';
import {
  addShape,
  bodyOf,
  buildResult,
  deleteShapes,
  designOrigin,
  directionNotes,
  dragHandle,
  duplicateShapes,
  editProblem,
  fitDesignBox,
  history,
  moveShapes,
  parsePath,
  pathBounds,
  placePort,
  portAlong,
  portBodyPoint,
  reorderShapes,
  resetToStandard,
  setBodySize,
  setOutline,
  setPortSide,
  sheetSize,
  snapDesignPoint,
  snapTo,
  startEdit,
  toggleLead,
  translatePath,
  type SymbolEdit,
} from '../lib/gradara/symbol-edit';

const fet = (): Definition => ({
  kind: 'myFet',
  name: 'My FET',
  description: '',
  domain: 'electrical',
  symbol: 'FET',
  generated: true,
  parameters: [],
  equations: '',
  ports: [
    { id: 'g', name: 'g', direction: 'input', domain: 'signal', side: 'left' },
    {
      id: 'd',
      name: 'd',
      direction: 'physical',
      domain: 'electrical',
      side: 'top',
    },
    {
      id: 's',
      name: 's',
      direction: 'physical',
      domain: 'electrical',
      side: 'bottom',
    },
  ],
});
const blockOf = (
  definition: Definition,
  extra: Partial<Block> = {},
): Block => ({
  id: 'b1',
  definition,
  position: { x: 0, y: 0 },
  size: defaultBlockSize(definition),
  ...extra,
});
const builtin = (kind: string) => library.find((d) => d.kind === kind)!;
const port = (e: SymbolEdit, id: string) =>
  e.definition.ports.find((p) => p.id === id)!;

void test('snapping rounds to the step, on the body grid', () => {
  assert.equal(snapTo(5, 4), 4);
  assert.equal(snapTo(6, 4), 8);
  assert.equal(snapTo(3.3, 1), 3);
  assert.equal(snapTo(13, 8), 16);
  // A design box with an odd offset in the body: snapped points land on body grid lines.
  const e = startEdit(blockOf(fet()));
  const edit = { ...e, glyph: { ...e.glyph, width: 30, height: 30 } };
  const o = designOrigin(edit);
  for (const step of [1, 2, 4, 8]) {
    const [x, y] = snapDesignPoint(edit, { x: 7.3, y: 11.9 }, step);
    assert.equal((x + o.x) % step, 0);
    assert.equal((y + o.y) % step, 0);
  }
});

void test('a block starts from its own body, before rotation', () => {
  const d = fet();
  const turned = blockOf(d, { rotation: 90, size: { width: 96, height: 128 } });
  assert.deepEqual(bodyOf(turned), { width: 128, height: 96 });
  assert.deepEqual(sheetSize({ width: 128, height: 96 }, 90), {
    width: 96,
    height: 128,
  });
  assert.deepEqual(startEdit(turned).size, { width: 128, height: 96 });
});

void test('rearranging terminals keeps the standard look', () => {
  for (const def of [fet(), builtin('gain'), builtin('nmos')]) {
    const e = startEdit(blockOf(def));
    assert.equal(e.standard, true);
    const side = def.ports[0].side === 'top' ? 'left' : 'top';
    const r = buildResult(placePort(e, def.ports[0].id, side, 16));
    assert.equal(r.glyph, undefined);
    assert.equal(blockShape(r), blockShape(def));
    assert.equal(r.ports[0].side, side);
  }
  // A block with its own drawing keeps it.
  const drawn = buildResult(toggleLead(startEdit(blockOf(fet())), 'g'));
  const again = startEdit(blockOf(drawn));
  assert.equal(again.standard, undefined);
  assert.deepEqual(buildResult(again).glyph, drawn.glyph);
});

void test('placing a port snaps it to a free grid step and keeps its neighbours put', () => {
  let e = startEdit(blockOf(fet()));
  const len = e.size.width;
  e = placePort(e, 'g', 'top', 37);
  const g = port(e, 'g');
  assert.equal(portSide(g), 'top');
  const along = portAlong(e, g);
  assert.equal(along % 8, 0);
  // d was at the middle of the top; g goes to the nearest free step, not onto it.
  assert.notEqual(along, portAlong(e, port(e, 'd')));
  assert.equal(portAlong(e, port(e, 'd')), len / 2);
  assert.ok(Math.abs(along - 37) <= 8);
  // Dropping onto the occupied middle picks the next free step.
  e = placePort(e, 's', 'top', len / 2);
  const taken = ['g', 'd', 's'].map((id) => portAlong(e, port(e, id)));
  assert.equal(new Set(taken).size, 3);
  assert.ok(taken.every((u) => u % 8 === 0 && u >= 8 && u <= len - 8));
});

void test('port places survive body resizes on the grid', () => {
  let e = startEdit(blockOf(fet()));
  e = placePort(e, 'g', 'left', 24);
  const before = portAlong(e, port(e, 'g')) / e.size.height;
  e = setBodySize(e, { width: e.size.width + 32, height: e.size.height + 48 });
  assert.equal(e.size.width % 16, 0);
  assert.equal(e.size.height % 16, 0);
  const after = portAlong(e, port(e, 'g'));
  assert.equal(after % 8, 0);
  assert.ok(Math.abs(after / e.size.height - before) < 0.1);
  // Limits: never below one size step or above the drawing limit.
  assert.deepEqual(setBodySize(e, { width: 3, height: 999 }).size, {
    width: 16,
    height: 320,
  });
});

void test('the side select joins an automatic spread, or takes the free middle step', () => {
  let e = startEdit(blockOf(fet()));
  e = setPortSide(e, 'g', 'top');
  assert.equal(port(e, 'g').offset, undefined);
  assert.equal(portSide(port(e, 'g')), 'top');
  const a = portAlong(e, port(e, 'g')),
    b = portAlong(e, port(e, 'd'));
  assert.notEqual(a, b);
  assert.equal(a % 8, 0);
});

void test('a straight lead follows its terminal along the side', () => {
  let e = startEdit(blockOf(fet()));
  e = toggleLead(e, 'g');
  const o = designOrigin(e);
  const a0 = e.glyph.anchors.g;
  assert.equal(a0.x, 0);
  assert.equal(a0.y + o.y, portBodyPoint(e, port(e, 'g')).y);
  e = placePort(e, 'g', 'left', 24);
  const p = portBodyPoint(e, port(e, 'g'));
  assert.equal(e.glyph.anchors.g.y + designOrigin(e).y, p.y);
  // The lead is straight in the rendered layout.
  const layout = circuitLayout(buildResult(e), e.size)!;
  const lead = layout.leads.find((l) => l.port === 'g')!;
  assert.match(lead.d, /^M0 \d+(\.\d+)?H[\d.]+$/);
  // Toggled off, it is gone.
  assert.equal(toggleLead(e, 'g').glyph.anchors.g, undefined);
});

void test('an anchor inside the drawing stays when its terminal changes side', () => {
  const nmos = builtin('nmos');
  let e = startEdit(blockOf(nmos));
  const before = { ...e.glyph.anchors.D };
  e = placePort(e, 'D', 'right', 16);
  assert.deepEqual(e.glyph.anchors.D, before);
});

void test('the result carries ports, the drawing and the body, and passes glyphProblem', () => {
  let e = startEdit(blockOf(fet()));
  e = addShape(e, {
    type: 'line',
    points: [
      [0, 0],
      [16, 16],
    ],
  });
  e = toggleLead(e, 'd');
  e = placePort(e, 'g', 'left', 16);
  const d = buildResult(e);
  assert.equal(d.kind, 'myFet');
  assert.deepEqual(d.glyph!.body, e.size);
  assert.equal(d.ports.find((p) => p.id === 'g')!.side, 'left');
  assert.equal(glyphProblem(d.glyph!, d.ports), null);
  assert.equal(editProblem(e), null);
  assert.equal(blockShape(d), 'box');
  assert.deepEqual(defaultBlockSize(d), e.size);
  // Built-ins too, once their drawing is edited.
  for (const kind of ['nmos', 'gain', 'resistor', 'pid']) {
    const def = builtin(kind);
    if (!def) continue;
    const start = startEdit(blockOf(def));
    const r = buildResult(setOutline(start, !!start.glyph.outline));
    assert.ok(r.glyph, kind);
    assert.equal(glyphProblem(r.glyph!, r.ports), null, kind);
  }
  // A shape outside the drawing is a problem the editor shows.
  const bad = addShape(e, { type: 'rect', x: -100, y: 0, width: 4, height: 4 });
  assert.match(editProblem(bad)!, /outside/);
});

void test('reset to standard removes the drawing and restores the library ports', () => {
  const gain = builtin('gain');
  let e = startEdit(blockOf(gain));
  e = placePort(e, 'u', 'top', 40);
  e = addShape(e, { type: 'ellipse', cx: 10, cy: 10, rx: 4, ry: 4 });
  e = setBodySize(e, { width: 128, height: 96 });
  const r = resetToStandard(e, gain);
  const d = buildResult(r);
  assert.equal(d.glyph, undefined);
  assert.equal(d.ports.find((p) => p.id === 'u')!.side, gain.ports[0].side);
  assert.equal(d.ports.find((p) => p.id === 'u')!.offset, undefined);
  assert.deepEqual(r.size, defaultBlockSize(gain));
  assert.equal(blockShape(d), 'gain');
  assert.equal(editProblem(r), null);
  // Drawing again starts a custom drawing.
  const again = addShape(r, {
    type: 'line',
    points: [
      [0, 0],
      [8, 8],
    ],
  });
  assert.ok(buildResult(again).glyph);
  // Port moves keep the standard look.
  assert.equal(buildResult(placePort(r, 'u', 'left', 16)).glyph, undefined);
});

void test('direction notes: signal inputs on the right, outputs on the left; physical anywhere', () => {
  const d = fet();
  assert.deepEqual(directionNotes(d), []);
  const turned = {
    ...d,
    ports: [
      { ...d.ports[0], side: 'right' as const },
      { ...d.ports[1], side: 'left' as const },
      {
        id: 'y',
        name: 'y',
        direction: 'output' as const,
        domain: 'signal' as const,
        side: 'left' as const,
      },
    ],
  };
  const notes = directionNotes(turned);
  assert.deepEqual(
    notes.map((n) => n.port),
    ['g', 'y'],
  );
  assert.match(notes[0].note, /Flip/);
  assert.match(notes[0].note, /⌘\/Ctrl\+I/);
});

void test('shapes move, duplicate, reorder and delete', () => {
  let e = startEdit(blockOf(fet()));
  const n0 = e.glyph.shapes.length;
  e = addShape(e, { type: 'rect', x: 0, y: 0, width: 8, height: 8 });
  e = addShape(e, { type: 'path', d: 'M0 0L8 8H16V4Z' });
  e = moveShapes(e, [n0, n0 + 1], 4, 2);
  assert.deepEqual(e.glyph.shapes[n0], {
    type: 'rect',
    x: 4,
    y: 2,
    width: 8,
    height: 8,
  });
  assert.equal((e.glyph.shapes[n0 + 1] as { d: string }).d, 'M4 2L12 10H20V6Z');
  const dup = duplicateShapes(e, [n0], 8);
  assert.equal(dup.edit.glyph.shapes.length, n0 + 3);
  assert.deepEqual(dup.indices, [n0 + 2]);
  const back = reorderShapes(dup.edit, dup.indices, 'back');
  assert.deepEqual(back.indices, [0]);
  assert.equal(back.edit.glyph.shapes[0].type, 'rect');
  const fwd = reorderShapes(back.edit, [0], 1);
  assert.deepEqual(fwd.indices, [1]);
  assert.equal(deleteShapes(e, [n0]).glyph.shapes.length, n0 + 1);
});

void test('handles edit points, corners, radii and arc ends', () => {
  assert.deepEqual(
    dragHandle(
      {
        type: 'line',
        points: [
          [0, 0],
          [4, 4],
        ],
      },
      'p1',
      [8, 0],
    ),
    {
      type: 'line',
      points: [
        [0, 0],
        [8, 0],
      ],
    },
  );
  assert.deepEqual(
    dragHandle(
      { type: 'rect', x: 0, y: 0, width: 8, height: 8 },
      'nw',
      [12, 4],
    ),
    {
      type: 'rect',
      x: 8,
      y: 4,
      width: 4,
      height: 4,
    },
  );
  const arc = dragHandle(
    { type: 'arc', cx: 0, cy: 0, r: 4, start: 0, end: 90 },
    'end',
    [0, -8],
  );
  assert.equal((arc as { end: number }).end, 270);
  assert.equal((arc as { r: number }).r, 8);
});

void test('path data parses, moves and bounds', () => {
  assert.equal(parsePath('M0 0L1 1 2 2Z').length, 4);
  assert.equal(translatePath('M0 22H5M5 12V32', 2, 3), 'M2 25H7M7 15V35');
  assert.equal(translatePath('m0 0l4 4', 1, 1), 'm1 1l4 4');
  assert.deepEqual(pathBounds('M0 22H5M5 12V32'), {
    x: 0,
    y: 12,
    width: 5,
    height: 20,
  });
});

void test('fitting the design box keeps the block unchanged', () => {
  let e = startEdit(blockOf(fet()));
  e = addShape(e, { type: 'rect', x: 20, y: 20, width: 8, height: 8 });
  e = toggleLead(e, 'g');
  const before = circuitLayout(buildResult(e), e.size)!;
  const fitted = fitDesignBox(e);
  assert.ok(fitted.glyph.width <= e.glyph.width);
  const after = circuitLayout(buildResult(fitted), fitted.size)!;
  assert.deepEqual(after.leads, before.leads);
  const abs = (l: typeof before) =>
    l.glyph.texts!.map((t) => [t.x + l.x, t.y + l.y]);
  assert.deepEqual(abs(after), abs(before));
  assert.equal(editProblem(fitted), null);
});

void test('history: push, preview and settle make one undo step; undo and redo', () => {
  const e0 = startEdit(blockOf(fet()));
  let h = history.start(e0);
  const e1 = addShape(e0, {
    type: 'line',
    points: [
      [0, 0],
      [8, 0],
    ],
  });
  h = history.push(h, e1);
  // A drag previews several states and settles as one step.
  const base = h.present;
  h = history.preview(
    h,
    moveShapes(base, [base.glyph.shapes.length - 1], 1, 0),
  );
  h = history.preview(
    h,
    moveShapes(base, [base.glyph.shapes.length - 1], 2, 0),
  );
  h = history.settle(h, base);
  assert.equal(h.past.length, 2);
  h = history.undo(h);
  assert.equal(h.present, e1);
  h = history.undo(h);
  assert.equal(h.present, e0);
  assert.equal(history.undo(h), h);
  h = history.redo(h);
  assert.equal(h.present, e1);
  // A new change drops the redo branch; an unchanged push is not a step.
  h = history.push(h, e0);
  assert.equal(h.future.length, 0);
  assert.equal(history.push(h, h.present), h);
  assert.equal(history.settle(h, h.present), h);
});
