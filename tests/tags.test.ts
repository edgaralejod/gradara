import test from 'node:test';
import assert from 'node:assert/strict';
import { library, type Block, type Project } from '../lib/gradara/model';
import { tagDefinition } from '../lib/gradara/tag-blocks';
import { tagLinks, tagProblems, tagsInScope } from '../lib/gradara/tags';
import { linkEnds } from '../lib/gradara/project';
import { defaultBlockSize } from '../lib/gradara/block-design';
import { semanticSignature } from '../lib/gradara/project';

const at = (id: string, definition: Block['definition']): Block => ({
  id,
  definition,
  position: { x: 0, y: 0 },
});
const kind = (k: string) => structuredClone(library.find((d) => d.kind === k)!);
const instance = (id: string, ref: string, name: string): Block =>
  at(id, {
    ...kind('subsystem'),
    name,
    ports: [],
    subsystem: { ref },
  });

/** Top: Goto [A], From [A]. Inside Mid: From [A], and an inner Goto [B]; inside Deep: From [A]. */
function document(): Project {
  return {
    version: 2,
    name: 'Top',
    duration: 1,
    revision: 0,
    blocks: [
      at('c', kind('constant')),
      at('to', tagDefinition('goto', 'A', 'signal')),
      at('back', tagDefinition('from', 'A', 'signal')),
      at('fb', tagDefinition('from', 'B', 'signal')),
      instance('mid', 'midDef', 'Mid'),
      at('lab', tagDefinition('connectionLabel', 'P', 'electrical')),
    ],
    wires: [
      {
        id: 'w',
        source: 'c',
        sourceHandle: 'y',
        target: 'to',
        targetHandle: 'u',
      },
    ],
    subsystems: [
      {
        id: 'midDef',
        name: 'Mid',
        blocks: [
          at('f', tagDefinition('from', 'A', 'signal')),
          at('toB', tagDefinition('goto', 'B', 'signal')),
          instance('deep', 'deepDef', 'Deep'),
          at('lab2', tagDefinition('connectionLabel', 'P', 'electrical')),
        ],
        wires: [],
      },
      {
        id: 'deepDef',
        name: 'Deep',
        blocks: [at('f2', tagDefinition('from', 'A', 'signal'))],
        wires: [],
      },
    ],
  } as unknown as Project;
}

void test('a From reads the Goto on its sheet, or on the nearest sheet above', () => {
  const doc = document();
  const top = tagLinks(
    doc,
    [],
    doc.blocks.find((b) => b.id === 'back')!,
  );
  assert.deepEqual(top.source, { path: [], blockId: 'to', sheetName: 'Top' });
  const deep = tagLinks(doc, ['mid', 'deep'], doc.subsystems![1].blocks[0]);
  assert.deepEqual(deep.source, { path: [], blockId: 'to', sheetName: 'Top' });
});

void test('a Goto inside a subsystem is not seen outside it', () => {
  const doc = document();
  const outside = doc.blocks.find((b) => b.id === 'fb')!;
  assert.equal(tagLinks(doc, [], outside).source, undefined);
  assert.deepEqual(tagsInScope(doc, [], 'goto'), ['A']);
  assert.deepEqual(tagsInScope(doc, ['mid'], 'goto'), ['A', 'B']);
  const problems = tagProblems(doc, []);
  assert.deepEqual(
    problems.map((p) => p.message),
    ['No Goto [B] on this sheet or above it for the From [B].'],
  );
  assert.deepEqual(problems[0].blockIds, ['fb']);
  assert.deepEqual(tagProblems(doc, ['mid', 'deep']), []);
});

void test('a Goto lists its From blocks, a label the labels it joins here and above', () => {
  const doc = document();
  const goto = tagLinks(
    doc,
    [],
    doc.blocks.find((b) => b.id === 'to')!,
  );
  assert.deepEqual(
    goto.peers.map((l) => l.blockId),
    ['back'],
  );
  const label = tagLinks(doc, ['mid'], doc.subsystems![0].blocks[3]);
  assert.deepEqual(
    label.peers.map((l) => `${l.sheetName}:${l.blockId}`),
    ['Top:lab'],
  );
});

void test('two Gotos with one tag, a missing tag, and mixed kinds are problems', () => {
  const doc: Project = {
    version: 1,
    name: 'Twice',
    duration: 1,
    revision: 0,
    blocks: [
      at('t1', tagDefinition('goto', 'A', 'signal')),
      at('t2', tagDefinition('goto', 'A', 'signal')),
      at('t3', tagDefinition('from', 'A', 'boolean')),
      at('t4', { ...tagDefinition('from', 'Z', 'signal'), tag: '' }),
    ],
    wires: [],
  };
  const messages = tagProblems(doc, []).map((p) => p.message);
  assert.ok(
    messages.includes('Two Goto blocks on this sheet use the tag [A].'),
  );
  assert.ok(
    messages.includes(
      'The Goto and From blocks tagged [A] carry different kinds of signal.',
    ),
  );
  assert.ok(messages.includes('From has no valid tag.'));
});

void test('a tag block takes the kind of the first wire, and grows with its tag', () => {
  const doc: Project = {
    version: 1,
    name: 'Adopt',
    duration: 1,
    revision: 0,
    blocks: [
      at('shaft', kind('rotSpeedSensor')),
      at('lab', tagDefinition('connectionLabel', 'S', 'electrical')),
      at('bool', kind('booleanConstant')),
      at('to', tagDefinition('goto', 'B', 'signal')),
    ],
    wires: [],
  };
  let next = linkEnds(
    doc,
    { id: 'shaft', handle: 'flange' },
    { id: 'lab', handle: 'p' },
  );
  next = linkEnds(next, { id: 'bool', handle: 'y' }, { id: 'to', handle: 'u' });
  const lab = next.blocks.find((b) => b.id === 'lab')!.definition;
  assert.equal(lab.ports[0].domain, 'mechanical');
  assert.equal(lab.tag, 'S');
  assert.equal(
    next.blocks.find((b) => b.id === 'to')!.definition.ports[0].domain,
    'boolean',
  );
  const short = defaultBlockSize(tagDefinition('goto', 'A', 'signal'));
  const long = defaultBlockSize(
    tagDefinition('goto', 'MotorSpeedCommand', 'signal'),
  );
  assert.equal(short.height, 32);
  assert.ok(long.width > short.width);
});

void test('changing a tag changes what the model computes', () => {
  const doc = document();
  const renamed = {
    ...doc,
    blocks: doc.blocks.map((b) =>
      b.id === 'back'
        ? { ...b, definition: { ...b.definition, tag: 'Z', symbol: 'Z' } }
        : b,
    ),
  };
  assert.notEqual(semanticSignature(renamed), semanticSignature(doc));
});
