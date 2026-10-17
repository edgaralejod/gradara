import test from 'node:test';
import assert from 'node:assert/strict';
import { definitionFor } from '../lib/gradara/model';
import {
  compileGlyph,
  glyphProblem,
  shapePath,
  withLiveAnchors,
  type SymbolGlyph,
} from '../lib/gradara/glyph';
import { blockShape, defaultBlockSize, showPortLabel } from '../lib/gradara/block-design';
import { circuitLayout } from '../lib/gradara/circuit-symbols';
import { startingGlyph } from '../lib/gradara/symbol-start';
import { semanticSignature } from '../lib/gradara/project';

const fet: SymbolGlyph = {
  width: 36,
  height: 44,
  shapes: [
    { type: 'line', points: [[0, 22], [5, 22]] },
    { type: 'rect', x: 5, y: 12, width: 13, height: 20 },
    { type: 'polygon', points: [[11, 22], [17, 18.5], [17, 25.5]], fill: true },
    { type: 'arc', cx: 18, cy: 22, r: 4, start: 0, end: 90 },
    { type: 'text', x: 26, y: 4, text: 'D', size: 'small' },
  ],
  anchors: { g: { x: 0, y: 22 }, d: { x: 18, y: 0 }, s: { x: 18, y: 44 } },
};

const generatedFet = () => ({
  kind: 'myFet',
  name: 'My FET',
  description: '',
  domain: 'electrical' as const,
  symbol: 'FET',
  generated: true,
  parameters: [],
  equations: '',
  ports: [
    { id: 'g', name: 'g', direction: 'input' as const, domain: 'signal' as const, side: 'left' as const },
    { id: 'd', name: 'd', direction: 'physical' as const, domain: 'electrical' as const, side: 'top' as const },
    { id: 's', name: 's', direction: 'physical' as const, domain: 'electrical' as const, side: 'bottom' as const },
  ],
});

void test('shapes compile to stroke and fill paths and upright labels', () => {
  const c = compileGlyph(fet);
  assert.match(c.path, /^M0 22L5 22M5 12H18V32H5Z/);
  assert.equal(c.fill, 'M11 22L17 18.5L17 25.5Z');
  assert.deepEqual(c.texts, [{ x: 26, y: 4, text: 'D', size: 'small', anchor: 'middle' }]);
  // An arc of a quarter turn, clockwise from +x (y down): (22, 22) to (18, 26).
  assert.equal(shapePath(fet.shapes[3]), 'M22 22A4 4 0 0 1 18 26');
  assert.match(shapePath({ type: 'ellipse', cx: 10, cy: 10, rx: 4, ry: 2 }), /A4 2 0 1 0 14 10/);
});

void test('a drawing is checked against its limits and the block’s ports', () => {
  const ports = generatedFet().ports;
  assert.equal(glyphProblem(fet, ports), null);
  assert.match(glyphProblem({ ...fet, anchors: { x: { x: 0, y: 0 } } }, ports)!, /port the block does not have/);
  assert.match(glyphProblem({ ...fet, width: 400 }, ports)!, /8 to 320/);
  assert.match(glyphProblem({ ...fet, shapes: [{ type: 'line', points: [[0, 0], [99, 0]] }] }, ports)!, /outside/);
  assert.match(glyphProblem({ ...fet, shapes: [{ type: 'path', d: 'M0 0 url(x)' }] }, ports)!, /drawing commands/);
  assert.match(glyphProblem({ ...fet, body: { width: 50, height: 64 } }, ports)!, /16-unit/);
});

void test('a drawn block is unboxed or boxed as drawn, sized for its leads, and drawn with leads to its anchors', () => {
  const d = { ...generatedFet(), glyph: fet };
  assert.equal(blockShape(d), 'physical');
  assert.equal(showPortLabel(d, d.ports[0]), false);
  // 36 + a lead on the left = 52 → 64; 44 + leads top and bottom = 76 → 80.
  assert.deepEqual(defaultBlockSize(d), { width: 64, height: 80 });
  const layout = circuitLayout(d, { width: 64, height: 80 })!;
  assert.equal(layout.leads.length, 3);
  const gate = layout.leads.find((l) => l.port === 'g')!;
  assert.ok(gate.d.startsWith('M0 '), 'the gate lead starts on the left edge');
  const boxed = { ...d, glyph: { ...fet, outline: true, body: { width: 96, height: 96 } } };
  assert.equal(blockShape(boxed), 'box');
  assert.equal(showPortLabel(boxed, boxed.ports[0]), true);
  assert.deepEqual(defaultBlockSize(boxed), { width: 96, height: 96 });
});

void test('a drawing never changes what is simulated', () => {
  const base = { ...generatedFet() };
  const project = (definition: object) => ({
    version: 1 as const, name: 't', duration: 1, revision: 0, wires: [],
    blocks: [{ id: 'q', definition: definition as never, position: { x: 0, y: 0 } }],
  });
  assert.equal(semanticSignature(project(base)), semanticSignature(project({ ...base, glyph: fet })));
});

void test('anchors follow the ports', () => {
  const d = { ...generatedFet(), glyph: fet };
  const fewer = withLiveAnchors({ ...d, ports: d.ports.slice(0, 2) });
  assert.deepEqual(Object.keys(fewer.glyph!.anchors).sort(), ['d', 'g']);
  assert.equal(withLiveAnchors(d), d);
});

void test('editing starts from the block’s current look', () => {
  const nmos = definitionFor('nmos')!;
  const fromBuiltin = startingGlyph(nmos);
  assert.equal(fromBuiltin.outline, false);
  assert.equal(fromBuiltin.shapes[0].type, 'path');
  assert.deepEqual(Object.keys(fromBuiltin.anchors).sort(), nmos.ports.map((p) => p.id).sort());
  assert.equal(glyphProblem(fromBuiltin, nmos.ports), null);
  // Drawn exactly as before: the same size and the same leads.
  const redrawn = { ...nmos, glyph: fromBuiltin };
  assert.deepEqual(defaultBlockSize(redrawn), defaultBlockSize(nmos));
  const size = defaultBlockSize(nmos);
  assert.deepEqual(circuitLayout(redrawn, size)!.leads, circuitLayout(nmos, size)!.leads);
  const gain = definitionFor('gain')!;
  const boxed = startingGlyph(gain);
  assert.equal(boxed.outline, true);
  assert.deepEqual(boxed.body, defaultBlockSize(gain));
  assert.equal(glyphProblem(boxed, gain.ports), null);
});
