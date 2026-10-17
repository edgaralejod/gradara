import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { library, type Block, type Project } from '../lib/gradara/model';
import {
  isOutputLogged,
  logAllOutputs,
  logPlotted,
  setOutputsLogged,
  settleLogged,
} from '../lib/gradara/logging';
import { semanticSignature } from '../lib/gradara/project';

const kind = (k: string) => structuredClone(library.find((d) => d.kind === k)!);
const at = (id: string, k: string): Block => ({
  id,
  definition: kind(k),
  position: { x: 0, y: 0 },
});

function doc(): Project {
  return {
    version: 1,
    name: 'Log',
    duration: 1,
    revision: 0,
    blocks: [at('c', 'constant'), at('g', 'gain'), at('vs', 'voltageSensor')],
    wires: [
      {
        id: 'w',
        source: 'c',
        sourceHandle: 'y',
        target: 'g',
        targetHandle: 'u',
      },
    ],
    nets: [{ id: 'n', anchor: 'c.y', wireIds: ['w'] }],
  };
}

void test('an output is logged on its port, wired or not, and only on request', () => {
  const p = doc();
  assert.equal(isOutputLogged(p, p.blocks[0], 'y'), false);
  // An unwired output (a sensor capped by a terminator) can be logged.
  const one = setOutputsLogged(p, [{ blockId: 'vs', portId: 'y' }], true);
  assert.deepEqual(one.blocks[2].logged, ['y']);
  assert.notEqual(semanticSignature(one), semanticSignature(p));
  // A logged wire counts as its driving output; stopping clears both.
  const wire = { ...p, nets: [{ ...p.nets![0], logged: true }] };
  assert.equal(isOutputLogged(wire, wire.blocks[0], 'y'), true);
  const off = setOutputsLogged(wire, [{ blockId: 'c' }], false);
  assert.equal(off.nets![0].logged, undefined);
  assert.equal(isOutputLogged(off, off.blocks[0], 'y'), false);
  // Inputs and missing ports are never logged.
  assert.equal(setOutputsLogged(p, [{ blockId: 'g', portId: 'u' }], true), p);
  const stale = {
    ...p,
    blocks: [{ ...p.blocks[0], logged: ['y', 'gone'] }, ...p.blocks.slice(1)],
  };
  assert.deepEqual(settleLogged(stale).blocks[0].logged, ['y']);
});

void test('Log all block outputs logs every block output on every sheet', () => {
  const all = logAllOutputs(doc());
  assert.deepEqual(
    all.blocks.map((b) => b.logged),
    [['y'], ['y'], ['y']],
  );
});

void test('a plot logs what it shows, under the name the run records', () => {
  const p = {
    ...doc(),
    plots: [{ id: 'p', label: 'V', series: ['vs.y', 'c.y'] }],
  };
  const out = logPlotted(p);
  // The voltage sensor's output y is recorded as its Modelica connector v.
  assert.deepEqual(out.plots![0].series, ['vs.v', 'c.y']);
  assert.deepEqual(
    out.blocks.map((b) => b.logged),
    [['y'], undefined, ['y']],
  );
});

void test('every example and template logs the signals its plots show', () => {
  const files = [
    ...['buck', 'datacenter', 'dc', 'ev', 'flyback', 'foc', 'servo'].map(
      (n) => `models/examples/${n}.json`,
    ),
    ...fs
      .readdirSync('models/examples/blocks')
      .filter((f) => f.endsWith('.json') && f !== 'index.json')
      .map((f) => `models/examples/blocks/${f}`),
  ];
  for (const file of files) {
    const p: Project = JSON.parse(fs.readFileSync(file, 'utf8'));
    for (const plot of p.plots ?? [])
      for (const key of plot.series) {
        const parts = key.split('.');
        let sheet: Pick<Project, 'blocks'> = p;
        for (const id of parts.slice(0, -2)) {
          const ref = sheet.blocks.find((b) => b.id === id)?.definition
            .subsystem?.ref;
          sheet = p.subsystems!.find((s) => s.id === ref)!;
        }
        const block = sheet.blocks.find((b) => b.id === parts.at(-2))!;
        const port = block?.definition.ports.find(
          (x) =>
            (block.definition.modelica?.ports?.[x.id] ?? x.id) === parts.at(-1),
        );
        assert.ok(
          port && block.logged?.includes(port.id),
          `${file}: ${key} is logged`,
        );
      }
  }
});

void test('a logged instance output that its inside no longer has is dropped when instances sync', async () => {
  const { syncInstances } = await import('../lib/gradara/hierarchy');
  const p = doc();
  const stale: Project = {
    ...p,
    blocks: [{ ...p.blocks[0], logged: ['y', 'gone'] }, ...p.blocks.slice(1)],
  };
  assert.deepEqual(syncInstances(stale).blocks[0].logged, ['y']);
});
