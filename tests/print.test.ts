import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import type { Project } from '../lib/gradara/model';
import { normalizeProject } from '../lib/gradara/normalize-project';
import { groupIntoSubsystem, hierarchyTree } from '../lib/gradara/hierarchy';
import { sheetBounds } from '../lib/gradara/sheet-bounds';
import {
  fitSheet,
  formatValue,
  pageBox,
  parameterRows,
  printPages,
  sheetDomains,
  sheetFit,
  unprinted,
} from '../lib/gradara/print';

const example = (name: string): Project =>
  normalizeProject(JSON.parse(readFileSync(`models/examples/${name}.json`, 'utf8')) as Project);

void test('pages follow the Model Explorer: the top level, then each subsystem depth first', () => {
  const ev = example('ev');
  const pages = printPages(ev);
  assert.equal(pages[0].key, 'top');
  assert.equal(pages[0].title, ev.name);
  assert.equal(pages[0].where, '');
  const order: string[] = [];
  const walk = (n: ReturnType<typeof hierarchyTree>) => {
    order.push(n.path.join('/'));
    n.children.forEach(walk);
  };
  walk(hierarchyTree(ev));
  assert.deepEqual(
    pages.map((p) => p.path.join('/')),
    order,
  );
  // Each page draws the inside of its subsystem.
  for (const page of pages.slice(1)) {
    assert.ok(page.sheet.blocks.length > 0, page.title);
    assert.ok(page.where.endsWith(page.title) || page.variant, page.where);
  }
  // Every subsystem in use has a page; only inactive variants' insides are left out.
  const variants = (ev.subsystems ?? []).length - (pages.length - 1);
  assert.equal(unprinted(ev, pages).length, variants);
});

void test('a subsystem used twice prints once, listing both places', () => {
  const dc = example('dc');
  const grouped = groupIntoSubsystem(dc, ['controller'], 'Speed control')!;
  const doc = grouped.project;
  const instance = doc.blocks.find((b) => b.id === grouped.instanceId)!;
  const twin = {
    ...instance,
    id: 'twin',
    position: { x: instance.position.x, y: instance.position.y + 400 },
    definition: { ...instance.definition, name: 'Speed control 2' },
  };
  const pages = printPages({ ...doc, blocks: [...doc.blocks, twin] });
  assert.equal(pages.length, 2);
  assert.equal(pages[1].title, 'Speed control');
  assert.deepEqual(pages[1].also, ['Speed control 2']);
});

void test('a sheet is centred and shrunk to fit its page, never enlarged', () => {
  const box = { width: 1000, height: 600 };
  const small = fitSheet({ x: 100, y: 50, width: 200, height: 100 }, box);
  assert.equal(small.zoom, 1);
  assert.equal(small.x + 100 * small.zoom + (200 * small.zoom) / 2, 500);
  const wide = fitSheet({ x: 0, y: 0, width: 4000, height: 500 }, box, 10);
  assert.equal(wide.zoom, (1000 - 20) / 4000);
  assert.equal(wide.x, 10);
  assert.deepEqual(fitSheet(undefined, box), { x: 12, y: 12, zoom: 1 });
  // Letter and A4 landscape both leave a diagram box wider than tall, under the paper.
  for (const paper of ['letter', 'a4'] as const) {
    const p = pageBox(paper);
    assert.ok(p.diagram.width > p.diagram.height && p.width < 1130 && p.height < 820, paper);
  }
  const ev = example('ev');
  for (const page of printPages(ev)) {
    const fit = sheetFit(page, 'letter');
    const b = sheetBounds(page.sheet)!;
    const box = pageBox('letter').diagram;
    assert.ok(fit.zoom > 0 && fit.zoom <= 1);
    assert.ok(fit.x + b.x * fit.zoom >= -0.5 && fit.x + (b.x + b.width) * fit.zoom <= box.width + 0.5, page.title);
    assert.ok(fit.y + b.y * fit.zoom >= -0.5 && fit.y + (b.y + b.height) * fit.zoom <= box.height + 0.5, page.title);
  }
});

void test('parameter tables list every block parameter with its unit, in reading order', () => {
  const dc = example('dc');
  const rows = parameterRows(dc);
  assert.ok(rows.length > 0);
  const pi = rows.filter((r) => r.block === dc.blocks.find((b) => b.id === 'controller')!.definition.name);
  assert.ok(pi.some((r) => r.parameter && r.value));
  const sample = pi.find((r) => r.value === '0.001');
  assert.ok(sample, 'the PI sample period');
  assert.equal(sample.unit, 's');
  // Subsystem ports and tags have nothing to list.
  const ev = example('ev');
  for (const page of printPages(ev))
    for (const row of parameterRows(page.sheet)) assert.ok(row.block && row.parameter, page.title);
});

void test('values read as people write them', () => {
  assert.equal(formatValue(0.001), '0.001');
  assert.equal(formatValue(1e-6), '1e-6');
  assert.equal(formatValue(24), '24');
  assert.equal(formatValue(2.5e7), '2.5e+7');
  assert.equal(formatValue(0.1 + 0.2), '0.3');
  assert.equal(formatValue(0), '0');
  assert.equal(formatValue(-1500), '-1500');
});

void test('the legend lists the domains a sheet uses, in a fixed order', () => {
  const dc = example('dc');
  const domains = sheetDomains(dc);
  assert.ok(domains.includes('signal'));
  assert.ok(domains.includes('electrical'));
  assert.equal(domains.indexOf('signal'), 0);
});
