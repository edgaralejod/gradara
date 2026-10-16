import test from 'node:test';
import assert from 'node:assert/strict';
import { library, type Block, type Project } from '../lib/gradara/model';
import {
  elementsOf,
  physicalBusDefinition,
  physicalBusIssues,
  setElements,
} from '../lib/gradara/physical-bus';
import { linkEnds } from '../lib/gradara/project';
import { busWireIds } from '../lib/gradara/buses';

const kind = (k: string) => structuredClone(library.find((d) => d.kind === k)!);
const at = (id: string, definition: Block['definition']): Block => ({
  id,
  definition,
  position: { x: 0, y: 0 },
});
const bus = (...e: [string, Block['definition']['domain']][]) =>
  physicalBusDefinition(e.map(([name, domain]) => ({ name, domain })));

function doc(): Project {
  return {
    version: 1,
    name: 'Bus',
    duration: 1,
    revision: 0,
    blocks: [
      at('src', kind('dcSource')),
      at('b1', bus(['pos', 'electrical'], ['neg', 'electrical'])),
      at('b2', bus(['neg', 'electrical'], ['pos', 'electrical'])),
      at('r', kind('resistor')),
    ],
    wires: [
      {
        id: 'a',
        source: 'src',
        sourceHandle: 'p',
        target: 'b1',
        targetHandle: 'e1',
      },
      {
        id: 'b',
        source: 'src',
        sourceHandle: 'n',
        target: 'b1',
        targetHandle: 'e2',
      },
      {
        id: 'c',
        source: 'b1',
        sourceHandle: 'bus',
        target: 'b2',
        targetHandle: 'bus',
      },
      {
        id: 'd',
        source: 'b2',
        sourceHandle: 'e2',
        target: 'r',
        targetHandle: 'p',
      },
    ],
  };
}

void test('the library offers a Physical bus with named elements and one bus terminal', () => {
  const d = kind('physicalBus');
  assert.equal(d.category, 'routing');
  assert.deepEqual(
    d.ports.map((p) => [p.id, p.domain]),
    [
      ['e1', 'electrical'],
      ['e2', 'electrical'],
      ['bus', 'physicalBus'],
    ],
  );
});

void test('elements keep their wires when others are added, removed, or reordered', () => {
  const p = doc();
  const [pos, neg] = elementsOf(p.blocks[1]);
  // Remove pos: its wire goes, neg keeps e2 and its wire.
  const removed = setElements(p, 'b1', [neg]);
  assert.deepEqual(
    removed.blocks[1].definition.ports.map((x) => x.id),
    ['e2', 'bus'],
  );
  assert.deepEqual(
    removed.wires.map((w) => w.id),
    ['b', 'c', 'd'],
  );
  // Reorder and add: IDs follow the elements; the new one gets a fresh ID.
  const more = setElements(p, 'b1', [
    neg,
    pos,
    { name: 'heat', domain: 'thermal' },
  ]);
  assert.deepEqual(
    more.blocks[1].definition.ports.map((x) => `${x.id}:${x.name}`),
    ['e2:neg', 'e1:pos', 'e3:heat', 'bus:bus'],
  );
  assert.equal(more.wires.length, 4);
  // A wired element keeps its wire's type; an invalid list changes nothing.
  const retyped = setElements(p, 'b1', [{ ...pos, domain: 'thermal' }, neg]);
  assert.equal(retyped.blocks[1].definition.ports[0].domain, 'electrical');
  assert.equal(setElements(p, 'b1', [pos, { ...neg, name: 'pos' }]), p);
  assert.equal(setElements(p, 'b1', [{ ...pos, name: '1x' }]), p);
});

void test('an unwired element takes the type of the first terminal wired to it', () => {
  const p = doc();
  p.blocks.push(at('hot', kind('fixedTemperature')));
  const fresh = setElements(p, 'b1', [
    ...elementsOf(p.blocks[1]),
    { name: 'heat', domain: 'electrical' },
  ]);
  const linked = linkEnds(
    fresh,
    { id: 'hot', handle: 'port' },
    { id: 'b1', handle: 'e3' },
  );
  const b1 = linked.blocks.find((b) => b.id === 'b1')!;
  assert.equal(
    b1.definition.ports.find((x) => x.id === 'e3')!.domain,
    'thermal',
  );
  assert.ok(
    linked.wires.some((w) => w.target === 'b1' && w.targetHandle === 'e3'),
  );
});

void test('one name carried as two types on a bus line is a problem, read through subsystems', () => {
  const p = doc();
  assert.deepEqual(
    physicalBusIssues(p, () => undefined),
    [],
  );
  p.blocks[2] = at('b2', bus(['neg', 'thermal'], ['pos', 'electrical']));
  p.wires = p.wires.filter((w) => w.id !== 'd');
  assert.deepEqual(
    physicalBusIssues(p, () => undefined).map((i) => i.message),
    [
      'The physical bus carries neg as electrical on one end and thermal on the other.',
    ],
  );
  // Through a subsystem's bus port: the inside's elements count.
  const inside = {
    blocks: [
      at('port', {
        ...kind('inport'),
        kind: 'connport',
        ports: [
          {
            id: 'p',
            name: 'bus',
            direction: 'physical' as const,
            domain: 'physicalBus' as const,
          },
        ],
        boundary: { order: 0 },
      }),
      at('split', bus(['pos', 'thermal'])),
    ],
    wires: [
      {
        id: 'w',
        source: 'port',
        sourceHandle: 'p',
        target: 'split',
        targetHandle: 'bus',
      },
    ],
  };
  const outer: Project = {
    ...doc(),
    blocks: [
      doc().blocks[1],
      at('sub', {
        ...kind('subsystem'),
        ports: [
          {
            id: 'port',
            name: 'bus',
            direction: 'physical',
            domain: 'physicalBus',
          },
        ],
        subsystem: { ref: 'inner' },
      }),
    ],
    wires: [
      {
        id: 'x',
        source: 'b1',
        sourceHandle: 'bus',
        target: 'sub',
        targetHandle: 'port',
      },
    ],
  };
  assert.deepEqual(
    physicalBusIssues(outer, (b) => (b.id === 'sub' ? inside : undefined)).map(
      (i) => i.blockIds,
    ),
    [['b1', 'sub']],
  );
});

void test('a physical bus line is drawn heavy', () => {
  assert.deepEqual([...busWireIds(doc())], ['c']);
});
