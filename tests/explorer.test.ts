import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import type { Block, Project } from '../lib/gradara/model';
import { normalizeProject } from '../lib/gradara/normalize-project';
import { groupIntoSubsystem, syncInstances } from '../lib/gradara/hierarchy';
import {
  explorerIndex,
  filterParameters,
  replaceValues,
  searchModel,
  setNetLogged,
  setParameterAt,
} from '../lib/gradara/explorer';

const example = (name: string): Project =>
  normalizeProject(
    JSON.parse(readFileSync(`models/examples/${name}.json`, 'utf8')) as Project,
  );

function nested() {
  const g = groupIntoSubsystem(example('dc'), ['controller'], 'Control')!;
  return { doc: normalizeProject(syncInstances(g.project)), ...g };
}

void test('the index lists every sheet, block, and parameter once', () => {
  const { doc, subsystemId, instanceId } = nested();
  const index = explorerIndex(doc);
  assert.deepEqual(
    index.sheets.map((s) => [s.id, s.path]),
    [
      ['', []],
      [subsystemId, [instanceId]],
    ],
  );
  const pi = index.parameters.filter((p) => p.blockId === 'controller');
  assert.deepEqual(
    pi.map((p) => p.parameter.id),
    ['kp', 'ki', 'limit', 'samplePeriod'],
  );
  assert.ok(
    pi.every((p) => p.sheetId === subsystemId && p.sheet.endsWith('› Control')),
  );
  assert.ok(index.nets.some((n) => n.name === 'ω measured'));
  // Boundary pills are ports, not blocks.
  assert.ok(
    index.blocks.every(
      (b) => !['inport', 'outport'].includes(b.block.definition.kind),
    ),
  );
});

void test('parameters filter by block, name, and unit', () => {
  const index = explorerIndex(example('dc'));
  assert.deepEqual(
    filterParameters(index.parameters, 'pi limit').map((p) => p.key),
    ['/controller/limit'],
  );
  assert.ok(filterParameters(index.parameters, 'ohm').length >= 0);
  assert.equal(
    filterParameters(index.parameters, '').length,
    index.parameters.length,
  );
});

void test('editing a value inside a subsystem reaches its definition', () => {
  const { doc, subsystemId } = nested();
  const next = setParameterAt(doc, subsystemId, 'controller', 'kp', 1.25);
  const kp = next
    .subsystems![0].blocks.find((b) => b.id === 'controller')!
    .definition.parameters.find((p) => p.id === 'kp')!;
  assert.equal(kp.value, 1.25);
  const top = setParameterAt(doc, '', 'reference', 'height', 50);
  assert.equal(
    top.blocks.find((b) => b.id === 'reference')!.definition.parameters[0]
      .value,
    50,
  );
});

void test('find and replace changes only matching values in the listed rows', () => {
  const doc = example('dc');
  const rows = explorerIndex(doc).parameters;
  const limit = rows.find((r) => r.key === '/controller/limit')!.parameter
    .value;
  const { project, count } = replaceValues(doc, rows, limit, limit * 2);
  assert.ok(count >= 1);
  assert.equal(
    explorerIndex(project).parameters.find(
      (r) => r.key === '/controller/limit',
    )!.parameter.value,
    limit * 2,
  );
});

void test('logging a signal net from the explorer', () => {
  const { doc } = nested();
  const net = explorerIndex(doc).nets.find((n) => n.name === 'ω measured')!;
  const next = setNetLogged(doc, net.sheetId, net.net.id, true);
  assert.equal(
    explorerIndex(next).nets.find((n) => n.key === net.key)!.net.logged,
    true,
  );
  const off = setNetLogged(next, net.sheetId, net.net.id, false);
  assert.equal(
    explorerIndex(off).nets.find((n) => n.key === net.key)!.net.logged,
    undefined,
  );
});

void test('search finds blocks, parameters, and subsystems across the hierarchy', () => {
  const { doc, subsystemId } = nested();
  const index = explorerIndex(doc);
  const hits = searchModel(index, 'control');
  assert.equal(hits[0].kind, 'subsystem');
  assert.ok(hits.some((h) => h.kind === 'block' && h.sheetId === subsystemId));
  assert.ok(searchModel(index, 'kp').some((h) => h.kind === 'parameter'));
});

void test('filtering 1,000 blocks stays under 100 ms', () => {
  const base = example('dc');
  const gain = base.blocks.find((b) => b.id === 'controller')!;
  const blocks: Block[] = Array.from({ length: 1000 }, (_, i) => ({
    ...gain,
    id: `b${i}`,
    definition: { ...gain.definition, name: `Controller ${i}` },
    position: { x: (i % 40) * 150, y: Math.floor(i / 40) * 120 },
  }));
  const big: Project = { ...base, blocks, wires: [], junctions: [], nets: [] };
  const index = explorerIndex(big);
  assert.equal(index.parameters.length, 4000);
  const started = performance.now();
  for (const q of ['controller 99', 'limit', 'kp', 'sample period s'])
    filterParameters(index.parameters, q);
  searchModel(index, 'controller 5');
  assert.ok(
    performance.now() - started < 100,
    `${performance.now() - started} ms`,
  );
});
