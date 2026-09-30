import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import {
  definitionFor,
  initialProject,
  library,
  type Block,
  type Project,
} from '../lib/gradara/model';
import {
  layoutFindings,
  layoutNewBlocks,
  layoutProject,
} from '../lib/gradara/auto-layout';
import { portPoint } from '../lib/gradara/ports';
import { GRID } from '../lib/gradara/grid';

const definition = (kind: string) => structuredClone(definitionFor(kind)!);
const far = { x: 5000, y: 5000 };

function add(project: Project, block: Block, wires: Project['wires']): Project {
  return {
    ...project,
    blocks: [...project.blocks, block],
    wires: [...project.wires, ...wires],
  };
}

function example(name: string): Project {
  return JSON.parse(
    readFileSync(`models/examples/${name}.json`, 'utf8'),
  ) as Project;
}

void test('a block fed by an output sits on that output line, to its right', () => {
  const full = initialProject();
  const base = {
    ...full,
    blocks: full.blocks.filter((b) => b.id === 'reference'),
    wires: [],
  };
  const gain = definition('gain');
  const project = add(base, { id: 'b_gain', definition: gain, position: far }, [
    {
      id: 'w_ai_1',
      source: 'reference',
      sourceHandle: 'y',
      target: 'b_gain',
      targetHandle: gain.ports.find((p) => p.direction === 'input')!.id,
    },
  ]);
  const laid = layoutNewBlocks(project, ['b_gain']);
  const block = laid.blocks.find((b) => b.id === 'b_gain')!;
  const from = portPoint(
    laid.blocks.find((b) => b.id === 'reference')!,
    'y',
  )!;
  const to = portPoint(
    block,
    gain.ports.find((p) => p.direction === 'input')!.id,
  )!;
  assert.ok(to.x > from.x, 'signal flows left to right');
  assert.equal(to.y, from.y, 'a straight wire');
  assert.equal(block.position.x % GRID, 0, 'on the sheet grid');
  assert.deepEqual(
    layoutFindings(laid).filter(
      (f) => f.ids.includes('b_gain') || f.ids.includes('w_ai_1'),
    ),
    [],
  );
});

void test('existing blocks never move', () => {
  const base = initialProject();
  const scope = definition('scope');
  const project = add(
    base,
    { id: 'b_scope', definition: scope, position: far },
    [
      {
        id: 'w_ai_1',
        source: 'sensor',
        sourceHandle: 'y',
        target: 'b_scope',
        targetHandle: scope.ports[0].id,
      },
    ],
  );
  const laid = layoutNewBlocks(project, ['b_scope']);
  for (const block of base.blocks)
    assert.deepEqual(
      laid.blocks.find((b) => b.id === block.id)!.position,
      block.position,
    );
});

void test('re-adding any block of a curated example keeps the drawing clean', () => {
  for (const name of ['dc', 'servo', 'buck', 'foc']) {
    const original = example(name);
    const before = layoutFindings(original).length;
    for (const block of original.blocks) {
      const moved = {
        ...original,
        blocks: original.blocks.map((b) =>
          b.id === block.id ? { ...b, position: far } : b,
        ),
      };
      const laid = layoutNewBlocks(moved, [block.id]);
      const overlaps = layoutFindings(laid).filter((f) => f.kind === 'overlap');
      assert.deepEqual(overlaps, [], `${name}: ${block.id} overlaps`);
      assert.ok(
        layoutFindings(laid).length <= before + 1,
        `${name}: ${block.id} adds several style problems`,
      );
    }
  }
});

void test('a block with no connections goes beside the drawing, not on top of it', () => {
  const base = initialProject();
  const laid = layoutNewBlocks(
    add(
      base,
      {
        id: 'b_note',
        definition: definition('gain'),
        position: { x: 225, y: 65 },
      },
      [],
    ),
    ['b_note'],
  );
  assert.deepEqual(
    layoutFindings(laid).filter((f) => f.kind === 'overlap'),
    [],
  );
});

void test('a generated model on a coarse agent grid comes out clean and on the page', () => {
  const dc = example('dc');
  // What the model generator returns: layout cells, no sizes, no routes, no junctions.
  const blocks = dc.blocks.map((b, i) => ({
    ...b,
    size: undefined,
    labelOffset: undefined,
    position: { x: (i % 4) * 320, y: Math.floor(i / 4) * 224 },
  }));
  const ids = new Set(blocks.map((b) => b.id));
  const wires = dc.wires
    .filter((w) => ids.has(w.source) && ids.has(w.target))
    .map(({ waypoints: _w, junctions: _j, ...w }) => w);
  const laid = layoutProject({ ...dc, blocks, wires, junctions: [] });
  assert.deepEqual(
    layoutFindings(laid).filter((f) => f.kind !== 'backward-signal'),
    [],
  );
  assert.ok(
    laid.blocks.every((b) => b.position.x >= 0 && b.position.y >= 0 && b.size),
  );
});
