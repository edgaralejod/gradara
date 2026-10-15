import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import type { Block, Project, Wire } from '../lib/gradara/model';
import { normalizeProject } from '../lib/gradara/normalize-project';
import { pruneJunctions, removeSelection } from '../lib/gradara/project';
import { extractSelection, pasteSelection } from '../lib/gradara/selection';
import {
  groupIntoSubsystem,
  subsystemsOf,
  syncInstances,
  ungroupSubsystem,
} from '../lib/gradara/hierarchy';

const terminal = (id: string, x: number, y: number): Block => ({
  id,
  position: { x, y },
  size: { width: 32, height: 32 },
  definition: {
    kind: 'test',
    name: id,
    domain: 'electrical',
    symbol: 'T',
    description: '',
    parameters: [],
    equations: '',
    ports: [
      {
        id: 'p',
        name: 'p',
        domain: 'electrical',
        direction: 'physical',
        side: 'left',
      },
    ],
  },
});
const dot = (id: string, x: number, y: number) => ({
  id,
  domain: 'electrical' as const,
  position: { x, y },
});
const wire = (
  id: string,
  source: string,
  target: string,
  waypoints?: Wire['waypoints'],
): Wire => ({
  id,
  source,
  sourceHandle: source.startsWith('J') ? 'node' : 'p',
  target,
  targetHandle: target.startsWith('J') ? 'node' : 'p',
  ...(waypoints ? { waypoints } : {}),
});
const sheet = (
  blocks: Block[],
  junctions: ReturnType<typeof dot>[],
  wires: Wire[],
): Project => ({
  version: 1,
  name: 'Junctions',
  duration: 1,
  revision: 0,
  blocks,
  junctions,
  wires,
});

/** What the service refuses on save, and what the workbench draws as a stray dot. */
function damage(p: Pick<Project, 'blocks' | 'wires' | 'junctions'>) {
  const ends = new Set([
    ...p.blocks.map((b) => b.id),
    ...(p.junctions ?? []).map((j) => j.id),
  ]);
  return [
    ...p.wires
      .filter((w) => !ends.has(w.source) || !ends.has(w.target))
      .map((w) => `wire ${w.id} ends on nothing`),
    ...(p.junctions ?? [])
      .map((j) => ({
        j,
        n: p.wires.filter((w) => w.source === j.id || w.target === j.id).length,
      }))
      .filter(({ n }) => n < 3)
      .map(({ j, n }) => `dot ${j.id} has ${n} wire(s)`),
  ];
}

void test('removing a wire next to two dots joined by two wires leaves no wire to a deleted dot', () => {
  // Found by fuzzing: A and B are joined twice; deleting a's wire leaves A with two
  // wires that both go to B. Joining them made a loop on B, and then B was removed
  // while the wire built from that loop still pointed at it.
  const p = sheet(
    [terminal('a', 0, 0), terminal('load', 400, 200)],
    [dot('J_A', 200, 16), dot('J_B', 300, 16)],
    [
      wire('wa', 'a', 'J_A'),
      wire('wab', 'J_A', 'J_B'),
      wire('wba', 'J_B', 'J_A', [{ x: 250, y: 64 }]),
      wire('wload', 'load', 'J_B'),
    ],
  );
  const next = removeSelection(p, [], ['wa']);
  assert.deepEqual(damage(next), []);
  // Nothing is left joining load to anything: the dots and the loop go, and so does
  // load's stub to where the dots were.
  assert.deepEqual(next.junctions, []);
  assert.deepEqual(next.wires, []);
});

void test('a wire from a terminal to itself is dropped, and pruning always finishes', () => {
  const p = sheet(
    [terminal('a', 0, 0), terminal('b', 200, 0), terminal('c', 200, 100)],
    [dot('J_A', 100, 16)],
    [
      wire('loop', 'J_A', 'J_A'),
      wire('wa', 'a', 'J_A'),
      wire('wb', 'J_A', 'b'),
      wire('wc', 'J_A', 'c'),
    ],
  );
  const next = pruneJunctions(p);
  assert.deepEqual(damage(next), []);
  assert.ok(!next.wires.some((w) => w.id === 'loop'));
  assert.equal(next.junctions?.length, 1);
});

void test('saving removes stray dots and wires that end on nothing', () => {
  const p = sheet(
    [terminal('a', 0, 0), terminal('b', 304, 0)],
    [dot('J_bend', 160, 16), dot('J_alone', 400, 200)],
    [
      wire('w1', 'a', 'J_bend'),
      wire('w2', 'J_bend', 'b'),
      wire('ghost', 'a', 'J_deleted'),
    ],
  );
  const saved = normalizeProject(p);
  assert.deepEqual(damage(saved), []);
  assert.deepEqual(saved.junctions ?? [], []);
  // The two-wire dot became a bend: a and b are still joined, by one wire.
  assert.equal(saved.wires.length, 1);
  assert.deepEqual([saved.wires[0].source, saved.wires[0].target].sort(), [
    'a',
    'b',
  ]);
  assert.equal(saved.nets?.length, 1);
  assert.deepEqual(saved.nets![0].wireIds, [saved.wires[0].id]);
});

void test('saving tidies the inside of a subsystem too, nets included', () => {
  const dc = normalizeProject(
    JSON.parse(readFileSync('models/examples/dc.json', 'utf8')) as Project,
  );
  const grouped = groupIntoSubsystem(dc, ['controller', 'drive'], 'Drive')!;
  const doc = syncInstances(normalizeProject(grouped.project, dc));
  const sub = subsystemsOf(doc)[0];
  const stray = {
    ...doc,
    subsystems: [
      {
        ...sub,
        junctions: [
          ...(sub.junctions ?? []),
          {
            id: 'J_stray',
            domain: 'signal' as const,
            position: { x: 0, y: 0 },
          },
        ],
      },
    ],
  };
  const saved = normalizeProject(stray, doc);
  const inside = subsystemsOf(saved)[0];
  assert.deepEqual(damage(inside), []);
  const owned = (inside.nets ?? []).flatMap((n) => n.wireIds).sort();
  assert.deepEqual(owned, inside.wires.map((w) => w.id).sort());
});

void test('copying blocks with dots joined twice pastes no wire to a missing dot', () => {
  const p = sheet(
    [terminal('a', 0, 0), terminal('load', 400, 200), terminal('c', 400, 0)],
    [dot('J_A', 200, 16), dot('J_B', 300, 16)],
    [
      wire('wa', 'a', 'J_A'),
      wire('wab', 'J_A', 'J_B'),
      wire('wba', 'J_B', 'J_A', [{ x: 250, y: 64 }]),
      wire('wload', 'load', 'J_B'),
      wire('wc', 'J_A', 'c'),
    ],
  );
  const fragment = extractSelection(p, {
    blockIds: ['a'],
    wireIds: [],
    junctionIds: ['J_A', 'J_B'],
  });
  assert.deepEqual(damage(fragment), []);
  const pasted = pasteSelection(p, fragment).project;
  assert.deepEqual(damage(normalizeProject(pasted, p)), []);
});

void test('ungrouping a subsystem whose ports are wired to each other outside leaves no wire to it', () => {
  const dc = normalizeProject(
    JSON.parse(readFileSync('models/examples/dc.json', 'utf8')) as Project,
  );
  const grouped = groupIntoSubsystem(dc, ['controller'], 'Control')!;
  let doc = syncInstances(normalizeProject(grouped.project, dc));
  const instance = doc.blocks.find((b) => b.id === grouped.instanceId)!;
  const inputs = instance.definition.ports.filter(
    (port) => port.direction === 'input',
  );
  assert.equal(inputs.length, 2);
  // Found by fuzzing: the two inputs end up wired to each other outside the block.
  doc = {
    ...doc,
    wires: [
      ...doc.wires.filter(
        (w) => w.source !== instance.id && w.target !== instance.id,
      ),
      {
        id: 'loopback',
        source: instance.id,
        sourceHandle: inputs[0].id,
        target: instance.id,
        targetHandle: inputs[1].id,
      },
    ],
  };
  const back = ungroupSubsystem(doc, instance.id)!;
  assert.deepEqual(damage(back.project), []);
  assert.ok(
    !back.project.wires.some(
      (w) => w.source === instance.id || w.target === instance.id,
    ),
  );
  assert.deepEqual(damage(normalizeProject(back.project, doc)), []);
});
