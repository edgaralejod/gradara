import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { library, type Block, type Project } from '../lib/gradara/model';
import {
  orientationOf,
  portPlacement,
  portPoint,
  portSide,
} from '../lib/gradara/ports';
import { flipBlocks, rotateBlocks } from '../lib/gradara/rotation';
import { defaultBlockSize } from '../lib/gradara/block-design';

const def = (kind: string) =>
  structuredClone(library.find((d) => d.kind === kind)!);
const block = (kind: string, extra: Partial<Block> = {}): Block => ({
  id: kind,
  definition: def(kind),
  position: { x: 0, y: 0 },
  ...extra,
});
const sides = (b: Block) =>
  Object.fromEntries(
    b.definition.ports.map((p) => [p.id, portPoint(b, p.id)!.side]),
  );
const backward = (p: { direction: string; side?: string }) =>
  (p.direction === 'input' && p.side === 'right') ||
  (p.direction === 'output' && p.side === 'left');

test('every library block reads left to right: no input on the right, no output on the left', () => {
  const found = library.flatMap((d) =>
    d.ports.filter(backward).map((p) => `${d.kind}.${p.id}`),
  );
  assert.deepEqual(found, []);
});

function documents(dir: string): string[] {
  return readdirSync(dir).flatMap((f) => {
    const path = join(dir, f);
    return statSync(path).isDirectory()
      ? documents(path)
      : path.endsWith('.json')
        ? [path]
        : [];
  });
}

test('templates and examples turn a block round by flipping it, never by moving its ports backward', () => {
  const found: string[] = [];
  for (const file of [
    ...documents('models/examples'),
    ...documents('tests/fixtures'),
  ]) {
    const doc = JSON.parse(readFileSync(file, 'utf8')) as Project & {
      subsystems?: Record<string, Project>;
    };
    const sheets = [doc, ...Object.values(doc.subsystems ?? {})];
    for (const sheet of sheets)
      for (const b of sheet.blocks ?? [])
        for (const p of b.definition.ports)
          if (backward(p)) found.push(`${file}: ${b.id}.${p.id}`);
  }
  assert.deepEqual(found, []);
});

test('a flipped signal block takes inputs on the right and keeps them in reading order', () => {
  const sum = block('sum', { flip: true });
  assert.deepEqual(sides(sum), { a: 'right', b: 'bottom', y: 'left' });
  const park = block('park');
  const flipped = block('park', { flip: true });
  for (const id of ['alpha', 'beta']) {
    assert.equal(portPoint(park, id)!.side, 'left');
    assert.equal(portPoint(flipped, id)!.side, 'right');
    // α stays above β: the first input is still at the top.
    assert.equal(portPoint(flipped, id)!.y, portPoint(park, id)!.y);
  }
  assert.equal(portPoint(flipped, 'theta')!.side, 'bottom');
});

test('a signal block turned half round is its mirror image, never upside down', () => {
  const half = block('park', { rotation: 180 });
  const flipped = block('park', { flip: true });
  assert.deepEqual(orientationOf(half.definition, 180), {
    rotation: 0,
    flip: true,
  });
  for (const p of half.definition.ports)
    assert.deepEqual(portPoint(half, p.id), portPoint(flipped, p.id));
});

test('a quarter turn keeps signal ports in reading order: inputs on top, numbered left to right', () => {
  const size = defaultBlockSize(def('park'));
  const b = block('park', {
    rotation: 90,
    size: { width: size.height, height: size.width },
  });
  const [alpha, beta] = ['alpha', 'beta'].map((id) => portPoint(b, id)!);
  assert.equal(alpha.side, 'top');
  assert.equal(beta.side, 'top');
  assert.ok(alpha.x < beta.x);
  assert.equal(portPoint(b, 'id')!.side, 'bottom');
  assert.equal(portPoint(b, 'theta')!.side, 'left');
});

test('a physical block turns geometrically: a half turn swaps its terminals end to end', () => {
  const r = block('resistor');
  const turned = block('resistor', { rotation: 180 });
  assert.equal(portPoint(r, 'p')!.side, 'left');
  assert.equal(portPoint(turned, 'p')!.side, 'right');
  assert.deepEqual(orientationOf(turned.definition, 180), {
    rotation: 180,
    flip: false,
  });
  // A flipped sensor reads its flange on the right and its output on the left.
  const sensor = block('rotSpeedSensor', { flip: true });
  for (const p of sensor.definition.ports)
    assert.notEqual(portPoint(sensor, p.id)!.side, portSide(p));
});

test('flip mirrors in place and toggles; rotate and flip redraw the touched wires', () => {
  const project: Project = {
    version: 1,
    name: 'Flip',
    duration: 1,
    revision: 0,
    blocks: [block('gain'), block('constant', { id: 'c' })],
    wires: [
      {
        id: 'w',
        source: 'c',
        sourceHandle: 'y',
        target: 'gain',
        targetHandle: 'u',
        waypoints: [{ x: 8, y: 8 }],
      },
    ],
  };
  const once = flipBlocks(project, ['gain']);
  const g = once.blocks.find((b) => b.id === 'gain')!;
  assert.equal(g.flip, true);
  assert.deepEqual(g.position, { x: 0, y: 0 });
  assert.equal(once.wires[0].waypoints, undefined);
  const twice = flipBlocks(once, ['gain']);
  assert.equal(twice.blocks.find((b) => b.id === 'gain')!.flip, undefined);
  assert.equal(rotateBlocks(project, ['gain']).wires[0].waypoints, undefined);
});

test('port placement offsets stay on the side for every orientation', () => {
  for (const kind of ['park', 'inverseClarke', 'resistor', 'dcPmMachine']) {
    const d = def(kind);
    for (const rotation of [0, 90, 180, 270])
      for (const flip of [false, true])
        for (const p of d.ports) {
          const { offset } = portPlacement(d, p, rotation, undefined, flip);
          assert.ok(offset > 0 && offset < 100, `${kind}.${p.id}`);
        }
  }
});
