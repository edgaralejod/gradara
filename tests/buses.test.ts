import test from 'node:test';
import assert from 'node:assert/strict';
import { definitionFor, type Block, type Project } from '../lib/gradara/model';
import {
  busEquations,
  busPortsWithCount,
  busProblems,
  propagateBuses,
  selectorPorts,
  withBusPorts,
} from '../lib/gradara/buses';
import { groupIntoSubsystem, syncInstances } from '../lib/gradara/hierarchy';
import { validateProject } from '../lib/gradara/validate-project';
import { defaultBlockSize } from '../lib/gradara/block-design';

const block = (id: string, kind: string, x = 0, y = 0): Block => ({
  id,
  definition: structuredClone(definitionFor(kind)!),
  position: { x, y },
});
const wire = (source: string, sh: string, target: string, th: string) => ({
  id: `${source}.${sh}-${target}.${th}`,
  source,
  sourceHandle: sh,
  target,
  targetHandle: th,
});
const doc = (blocks: Block[], wires: Project['wires']): Project => ({
  version: 1,
  name: 't',
  duration: 1,
  revision: 0,
  blocks,
  wires,
});
const portOf = (p: Project, b: string, port: string) =>
  p.blocks
    .find((x) => x.id === b)!
    .definition.ports.find((q) => q.id === port)!;

/** Speed and current into a Bus Creator, then a Bus Selector picking current. */
function named() {
  const creator = block('bc', 'busCreator');
  creator.definition.ports = creator.definition.ports.map((p) =>
    p.id === 'u1'
      ? { ...p, name: 'speed' }
      : p.id === 'u2'
        ? { ...p, name: 'current' }
        : p,
  );
  const selector = block('bs', 'busSelector');
  selector.definition.ports = selectorPorts(selector.definition, ['current']);
  return doc(
    [
      block('a', 'constant'),
      block('b', 'sine'),
      creator,
      selector,
      block('g', 'gain'),
    ],
    [
      wire('a', 'y', 'bc', 'u1'),
      wire('b', 'y', 'bc', 'u2'),
      wire('bc', 'y', 'bs', 'u'),
      wire('bs', 'y2', 'g', 'u'),
    ],
  );
}

void test('a Mux output is as wide as its inputs together', () => {
  const p = propagateBuses(
    doc(
      [
        block('a', 'constant'),
        block('b', 'sine'),
        block('m', 'mux'),
        block('d', 'demux'),
      ],
      [
        wire('a', 'y', 'm', 'u1'),
        wire('b', 'y', 'm', 'u2'),
        wire('a', 'y', 'm', 'u3'),
        wire('m', 'y', 'd', 'u'),
      ],
    ),
  );
  assert.equal(portOf(p, 'm', 'y').width, 3);
  assert.equal(portOf(p, 'd', 'u').width, 3);
  assert.equal(portOf(p, 'd', 'y1').width, undefined);
  assert.equal(
    p.blocks.find((b) => b.id === 'd')!.definition.equations,
    'y1 = u[1];\ny2 = u[2];\ny3 = u[3];',
  );
  assert.deepEqual(busProblems(p), []);
});

void test('a Bus Creator names its signals and a Bus Selector picks by name', () => {
  const p = propagateBuses(named());
  assert.deepEqual(portOf(p, 'bc', 'y').elements, ['speed', 'current']);
  assert.deepEqual(portOf(p, 'bs', 'u').elements, ['speed', 'current']);
  assert.equal(
    p.blocks.find((b) => b.id === 'bs')!.definition.equations,
    'y2 = u[2];',
  );
  assert.deepEqual(busProblems(p), []);
  // Already settled: the same object comes back.
  assert.equal(propagateBuses(p), p);
});

void test('a bus inside a bus gets dotted names, and a sub-bus selects as a vector', () => {
  const inner = block('inner', 'busCreator');
  const outer = block('outer', 'busCreator');
  outer.definition.ports = outer.definition.ports.map((q) =>
    q.id === 'u1'
      ? { ...q, name: 'motor' }
      : q.id === 'u2'
        ? { ...q, name: 'load' }
        : q,
  );
  const sel = block('sel', 'busSelector');
  sel.definition.ports = selectorPorts(sel.definition, ['motor', 'load']);
  const p = propagateBuses(
    doc(
      [
        block('a', 'constant'),
        block('b', 'sine'),
        inner,
        outer,
        sel,
        block('d', 'demux'),
      ],
      [
        wire('a', 'y', 'inner', 'u1'),
        wire('b', 'y', 'inner', 'u2'),
        wire('inner', 'y', 'outer', 'u1'),
        wire('a', 'y', 'outer', 'u2'),
        wire('outer', 'y', 'sel', 'u'),
      ],
    ),
  );
  assert.deepEqual(portOf(p, 'outer', 'y').elements, [
    'motor.signal1',
    'motor.signal2',
    'load',
  ]);
  assert.equal(portOf(p, 'sel', 'y2').width, 2);
  assert.deepEqual(portOf(p, 'sel', 'y2').elements, ['signal1', 'signal2']);
  assert.equal(
    p.blocks.find((b) => b.id === 'outer')!.definition.equations,
    'y = cat(1, u1, {u2});',
  );
  assert.equal(
    p.blocks.find((b) => b.id === 'sel')!.definition.equations,
    'y2 = u[{1, 2}];\ny3 = u[3];',
  );
});

void test('a bus into a one-signal input is an error that names the fix', () => {
  const p = named();
  p.wires.push(wire('bc', 'y', 'g', 'u'));
  p.wires = p.wires.filter((w) => w.source !== 'bs');
  const problems = validateProject(propagateBuses(p));
  const found = problems.find((d) => d.id === 'v-bus-width-g-u');
  assert.ok(found);
  assert.match(
    found.message,
    /takes one signal, but Bus Creator sends a bus of 2/,
  );
  assert.match(found.hint!, /Demux|Bus Selector/);
});

void test('Demux and Bus Selector mistakes are reported', () => {
  const p = named();
  const sel = p.blocks.find((b) => b.id === 'bs')!;
  sel.definition.ports = selectorPorts(sel.definition, ['torque']);
  const d = block('d', 'demux');
  p.blocks.push(d);
  p.wires.push(wire('bc', 'y', 'd', 'u'));
  p.wires = p.wires.filter((w) => w.source !== 'bs');
  const ids = busProblems(propagateBuses(p)).map((x) => x.id);
  assert.ok(
    ids.some((i) => i.startsWith('bus-selector-bs-')),
    ids.join(),
  );
  assert.ok(ids.includes('bus-demux-d'), ids.join());
});

void test('changing a Mux input count keeps wires on surviving ports and resizes the bar', () => {
  const p = propagateBuses(
    doc(
      [block('a', 'constant'), block('m', 'mux', 96, 96)],
      [wire('a', 'y', 'm', 'u1'), wire('a', 'y', 'm', 'u3')],
    ),
  );
  const m = p.blocks.find((b) => b.id === 'm')!;
  const five = withBusPorts(p, 'm', busPortsWithCount(m.definition, 5));
  const five_m = five.blocks.find((b) => b.id === 'm')!;
  assert.equal(
    five_m.definition.ports.filter((q) => q.direction === 'input').length,
    5,
  );
  assert.deepEqual(five_m.size, defaultBlockSize(five_m.definition));
  assert.equal(five.wires.length, 2);
  const two = withBusPorts(five, 'm', busPortsWithCount(five_m.definition, 2));
  assert.deepEqual(
    two.wires.map((w) => w.targetHandle),
    ['u1'],
  );
  assert.equal(portOf(propagateBuses(two), 'm', 'y').width, 2);
});

void test('a Bus Selector keeps port IDs for signals that stay selected', () => {
  const d = definitionFor('busSelector')!;
  const first = selectorPorts({ ...d }, ['a', 'b', 'c']);
  const again = selectorPorts({ ...d, ports: first }, ['c', 'a']);
  assert.deepEqual(
    again.filter((q) => q.direction === 'output').map((q) => [q.id, q.name]),
    [
      ['y4', 'c'],
      ['y2', 'a'],
    ],
  );
});

void test('a bus passes through subsystem ports', () => {
  const p = named();
  // Group the selector and gain: the subsystem's input carries the bus.
  const grouped = groupIntoSubsystem(p, ['bs', 'g'], 'Pick')!;
  const synced = syncInstances(grouped.project);
  const instance = synced.blocks.find((b) => b.id === grouped.instanceId)!;
  const input = instance.definition.ports.find((q) => q.direction === 'input')!;
  assert.equal(input.width, 2);
  assert.deepEqual(input.elements, ['speed', 'current']);
  const inside = synced.subsystems!.find((s) => s.id === grouped.subsystemId)!;
  const inport = inside.blocks.find((b) => b.definition.kind === 'inport')!;
  assert.equal(inport.definition.ports[0].width, 2);
  assert.deepEqual(busProblems({ ...synced, ...inside } as Project), []);
  assert.deepEqual(busProblems(synced), []);
});

void test('bus block equations follow their ports', () => {
  const mux = definitionFor('mux')!;
  assert.equal(busEquations(mux), 'y = {u1, u2, u3};');
});
