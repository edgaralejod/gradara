import test from 'node:test';
import assert from 'node:assert/strict';
import { library, type Block, type Project } from '../lib/gradara/model';
import {
  normalizeBlockNames,
  automaticNetName,
  netDisplayName,
  nextAvailableName,
} from '../lib/gradara/names';
import { normalizeProject } from '../lib/gradara/normalize-project';
import {
  describeNets,
  netForWire,
  reconcileNets,
  renameNet,
} from '../lib/gradara/net-registry';
import {
  emptySelection,
  extractSelection,
  pasteSelection,
} from '../lib/gradara/selection';
import { duplicateBlocks, semanticSignature } from '../lib/gradara/project';

const step = (id: string, name = 'Step'): Block => ({
  id,
  definition: {
    ...structuredClone(library.find((d) => d.kind === 'step')!),
    name,
  },
  position: { x: 0, y: 0 },
});
const model = (...blocks: Block[]): Project => ({
  version: 1,
  name: 'Names',
  duration: 1,
  revision: 0,
  blocks,
  wires: [],
});
const names = (p: Project) => p.blocks.map((b) => b.definition.name);

void test('adding the same library type allocates Step, Step1, Step2 without mutating the library', () => {
  let p = normalizeProject(model(step('a')));
  for (const id of ['b', 'c'])
    p = normalizeProject({ ...p, blocks: [...p.blocks, step(id)] }, p);
  assert.deepEqual(names(p), ['Step', 'Step1', 'Step2']);
  assert.equal(library.find((d) => d.kind === 'step')!.name, 'Step');
  assert.equal(normalizeProject(p), p);
});

void test('legacy and imported duplicate names are repaired without stealing reserved suffixes', () => {
  const p = model(
    step('a'),
    step('b'),
    step('c', 'Step1'),
    step('d', 'Target'),
    step('e', 'Target'),
  );
  const fixed = normalizeProject(p);
  assert.deepEqual(names(fixed), [
    'Step',
    'Step2',
    'Step1',
    'Target',
    'Target1',
  ]);
  assert.deepEqual(names(p), ['Step', 'Step', 'Step1', 'Target', 'Target']);
  const loaded: Project = JSON.parse(JSON.stringify(fixed));
  assert.equal(normalizeProject(loaded), loaded);
});

void test('manual collision renames the edited block, even when it precedes the existing owner', () => {
  const p = model(step('first', 'Reference'), step('second', 'Step'));
  const next = normalizeBlockNames(
    { ...p, blocks: [step('first', 'Step'), p.blocks[1]] },
    p,
  );
  assert.deepEqual(names(next), ['Step1', 'Step']);
  assert.equal(next.blocks[1], p.blocks[1]);
});

void test('numbered duplicate names increment, including long and custom names', () => {
  assert.equal(
    nextAvailableName('Step1', new Set(['Step', 'Step1', 'Step2'])),
    'Step3',
  );
  assert.equal(
    nextAvailableName('Reference', new Set(['Reference'])),
    'Reference1',
  );
  const long = 'λ'.repeat(100),
    candidate = nextAvailableName(long, new Set([long]));
  assert.equal(candidate.length, 100);
  assert.equal(candidate, 'λ'.repeat(99) + '1');
  const digits = '9'.repeat(100);
  assert.equal(nextAvailableName(digits, new Set([digits])).length, 100);
});

void test('deletion never renumbers existing blocks and adding a block can reuse a free name', () => {
  const p = normalizeProject(model(step('a'), step('b'), step('c')));
  const removed = normalizeProject(
    { ...p, blocks: p.blocks.filter((b) => b.id !== 'b') },
    p,
  );
  assert.deepEqual(names(removed), ['Step', 'Step2']);
  assert.deepEqual(
    names(
      normalizeProject(
        { ...removed, blocks: [...removed.blocks, step('d')] },
        removed,
      ),
    ),
    ['Step', 'Step2', 'Step1'],
  );
});

function connected() {
  const gain = {
    ...step('gain', 'Gain'),
    definition: structuredClone(library.find((d) => d.kind === 'gain')!),
    position: { x: 200, y: 0 },
  };
  return normalizeProject({
    ...model(step('source'), gain),
    wires: [
      {
        id: 'w',
        source: 'source',
        sourceHandle: 'y',
        target: 'gain',
        targetHandle: 'u',
      },
    ],
  });
}

void test('auto net names identify the source port, update after block rename, and preserve net IDs', () => {
  const p = connected(),
    net = p.nets![0];
  assert.equal(automaticNetName(p, net), 'Step.y');
  assert.equal(netDisplayName(p, net), 'Step.y');
  const changed = normalizeProject(
    {
      ...p,
      blocks: p.blocks.map((b) =>
        b.id === 'source'
          ? { ...b, definition: { ...b.definition, name: 'Reference' } }
          : b,
      ),
    },
    p,
  );
  assert.equal(netDisplayName(changed, changed.nets![0]), 'Reference.y');
  assert.equal(changed.nets![0].id, net.id);
  assert.equal(semanticSignature(changed), semanticSignature(p));
  assert.equal(describeNets(changed)[0].name, 'Reference.y');
});

void test('custom net names stay fixed; clearing or using the auto name restores automatic mode', () => {
  const p = connected(),
    id = p.nets![0].id;
  const named = renameNet(p, id, 'command');
  const changed = normalizeProject(
    {
      ...named,
      blocks: named.blocks.map((b) =>
        b.id === 'source'
          ? { ...b, definition: { ...b.definition, name: 'Reference' } }
          : b,
      ),
    },
    named,
  );
  assert.equal(netDisplayName(changed, changed.nets![0]), 'command');
  const cleared = renameNet(changed, id, '');
  assert.equal(netDisplayName(cleared, cleared.nets![0]), 'Reference.y');
  assert.equal(renameNet(changed, id, 'Reference.y').nets![0].name, undefined);
  const auto = p.nets![0];
  assert.equal(renameNet(p, auto.id, automaticNetName(p, auto)), p);
});

void test('Ctrl-drag, duplication, and clipboard previews have unique instance and automatic net names', () => {
  const p = connected();
  const copied = duplicateBlocks(p, ['source', 'gain']).project;
  assert.deepEqual(names(copied), ['Step', 'Gain', 'Step1', 'Gain1']);
  assert.deepEqual(
    describeNets(copied).map((n) => n.name),
    ['Step.y', 'Step1.y'],
  );
  assert.notEqual(copied.nets![0].id, copied.nets![1].id);
  const fragment = extractSelection(p, {
    ...emptySelection(),
    blockIds: ['source', 'gain'],
  });
  const pasted = pasteSelection(copied, fragment).project;
  assert.deepEqual(names(pasted), [
    'Step',
    'Gain',
    'Step1',
    'Gain1',
    'Step2',
    'Gain2',
  ]);
  assert.deepEqual(
    describeNets(pasted).map((n) => n.name),
    ['Step.y', 'Step1.y', 'Step2.y'],
  );
  assert.deepEqual(names(p), ['Step', 'Gain']);
});

void test('branch changes do not change a signal auto name or ID', () => {
  const p = connected(),
    id = p.nets![0].id;
  const extra = { ...structuredClone(p.blocks[1]), id: 'gain2' };
  const next = normalizeProject(
    {
      ...p,
      blocks: [...p.blocks, extra],
      wires: [
        ...p.wires,
        {
          id: 'branch',
          source: 'source',
          sourceHandle: 'y',
          target: 'gain2',
          targetHandle: 'u',
        },
      ],
    },
    p,
  );
  assert.equal(netForWire(next, 'branch')!.id, id);
  assert.equal(netDisplayName(next, netForWire(next, 'branch')!), 'Step.y');
  assert.deepEqual(names(next), ['Step', 'Gain', 'Gain1']);
});

void test('physical auto names use a real anchor terminal and do not invent a signal direction', () => {
  const terminal = (
    id: string,
    name: string,
    domain: 'electrical' | 'mechanical',
  ): Block => ({
    ...step(id, name),
    definition: {
      ...step(id, name).definition,
      ports: [{ id: 'p', name: 'terminal', domain, direction: 'physical' }],
    },
  });
  const p = normalizeProject({
    ...model(
      terminal('a', 'Resistor', 'electrical'),
      terminal('b', 'Capacitor', 'electrical'),
      terminal('c', 'Inertia', 'mechanical'),
      terminal('d', 'Load', 'mechanical'),
    ),
    wires: [
      {
        id: 'ab',
        source: 'b',
        sourceHandle: 'p',
        target: 'a',
        targetHandle: 'p',
      },
      {
        id: 'cd',
        source: 'd',
        sourceHandle: 'p',
        target: 'c',
        targetHandle: 'p',
      },
    ],
  });
  assert.deepEqual(
    describeNets(p).map((n) => [n.name, n.domain]),
    [
      ['Resistor.p', 'electrical'],
      ['Inertia.p', 'mechanical'],
    ],
  );
  const reversed = reconcileNets(
    {
      ...p,
      wires: p.wires.map((w) => ({ ...w, source: w.target, target: w.source })),
    },
    p,
  );
  assert.deepEqual(
    describeNets(reversed).map((n) => n.name),
    describeNets(p).map((n) => n.name),
  );
});
