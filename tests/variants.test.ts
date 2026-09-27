import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import type { Project } from '../lib/gradara/model';
import { normalizeProject } from '../lib/gradara/normalize-project';
import {
  findSubsystem,
  groupIntoSubsystem,
  promoteParameter,
  scopeView,
  syncInstances,
  writeScope,
} from '../lib/gradara/hierarchy';
import {
  addDiagramVariant,
  addParameterVariant,
  applyConfiguration,
  matchingConfiguration,
  removeVariant,
  saveConfiguration,
  setPortUnused,
  switchVariant,
  variantInstances,
  variantProblems,
} from '../lib/gradara/variants';

const example = (name: string): Project =>
  normalizeProject(
    JSON.parse(readFileSync(`models/examples/${name}.json`, 'utf8')) as Project,
  );

/** The DC example with its PI controller grouped and `kp` promoted. */
function grouped() {
  const g = groupIntoSubsystem(example('dc'), ['controller'], 'PI')!;
  const doc = syncInstances(
    promoteParameter(
      syncInstances(g.project),
      g.subsystemId,
      'controller',
      'kp',
    ),
  );
  return { doc, id: g.instanceId, sub: g.subsystemId };
}

const instance = (doc: Project, id: string) =>
  doc.blocks.find((b) => b.id === id)!;
const kp = (doc: Project, id: string) =>
  instance(doc, id).definition.parameters[0].value;

void test('parameter variants share an inside and remember their own values', () => {
  const { doc, id, sub } = grouped();
  const added = addParameterVariant(doc, id, 'Aggressive')!;
  let next = syncInstances(added.project);
  const sr = instance(next, id).definition.subsystem!;
  assert.equal(sr.variants?.length, 2);
  assert.equal(sr.active, added.variantId);
  assert.ok(sr.variants!.every((v) => v.ref === sub));
  // Tune the new variant, switch away and back: each keeps its value.
  next = syncInstances({
    ...next,
    blocks: next.blocks.map((b) =>
      b.id === id
        ? {
            ...b,
            definition: {
              ...b.definition,
              parameters: [{ ...b.definition.parameters[0], value: 2.4 }],
            },
          }
        : b,
    ),
  });
  const first = sr.variants![0].id;
  next = syncInstances(switchVariant(next, id, first));
  assert.equal(kp(next, id), 0.6);
  next = syncInstances(switchVariant(next, id, added.variantId));
  assert.equal(kp(next, id), 2.4);
});

void test('a diagram variant is its own inside behind the same ports', () => {
  const { doc, id, sub } = grouped();
  const added = addDiagramVariant(doc, id, 'Fast PI')!;
  let next = syncInstances(added.project);
  const ref = instance(next, id).definition.subsystem!.ref;
  assert.notEqual(ref, sub);
  assert.deepEqual(
    instance(next, id).definition.ports.map((p) => p.id),
    instance(doc, id).definition.ports.map((p) => p.id),
  );
  // Editing the new inside leaves the original alone, and both survive syncing.
  const view = scopeView(next, [id]);
  next = writeScope(next, [id], {
    ...view,
    blocks: view.blocks.map((b) =>
      b.id === 'controller'
        ? {
            ...b,
            definition: {
              ...b.definition,
              parameters: b.definition.parameters.map((p) =>
                p.id === 'ki' ? { ...p, value: 9 } : p,
              ),
            },
          }
        : b,
    ),
  });
  const ki = (s: string) =>
    findSubsystem(next, s)!
      .blocks.find((b) => b.id === 'controller')!
      .definition.parameters.find((p) => p.id === 'ki')!.value;
  assert.equal(ki(ref), 9);
  assert.equal(ki(sub), 2);
  const back = syncInstances(
    switchVariant(
      next,
      id,
      instance(next, id).definition.subsystem!.variants![0].id,
    ),
  );
  assert.equal(instance(back, id).definition.subsystem!.ref, sub);
  assert.ok(findSubsystem(back, ref), 'the inactive inside is kept');
  // Removing it drops its inside; one variant left means a plain subsystem.
  const removed = syncInstances(removeVariant(back, id, added.variantId));
  assert.equal(instance(removed, id).definition.subsystem!.variants, undefined);
  assert.equal(findSubsystem(removed, ref), undefined);
});

void test('a port one variant lacks is reported until marked not used here', () => {
  const { doc, id } = grouped();
  const added = addDiagramVariant(doc, id, 'No feedback')!;
  let next = syncInstances(added.project);
  const view = scopeView(next, [id]);
  const inports = view.blocks.filter((b) => b.definition.kind === 'inport');
  const dropped = inports[1];
  next = writeScope(next, [id], {
    ...view,
    blocks: view.blocks.filter((b) => b.id !== dropped.id),
    wires: view.wires.filter(
      (w) => w.source !== dropped.id && w.target !== dropped.id,
    ),
    nets: view.nets?.filter((n) =>
      n.wireIds.every((wid) =>
        view.wires.some(
          (w) =>
            w.id === wid && w.source !== dropped.id && w.target !== dropped.id,
        ),
      ),
    ),
  });
  // The instance keeps the union of ports, so the outside wiring survives.
  assert.ok(
    instance(next, id).definition.ports.some((p) => p.id === dropped.id),
  );
  const problems = variantProblems(next).filter((d) =>
    d.id.startsWith('v-variant-port'),
  );
  assert.equal(problems.length, 1);
  assert.equal(problems[0].severity, 'error');
  next = setPortUnused(next, id, added.variantId, dropped.id, true);
  assert.equal(
    variantProblems(next).filter((d) => d.id.startsWith('v-variant-port'))
      .length,
    0,
  );
  // Switched back to the original, the other variant's inside is still checked (as a warning).
  const first = instance(next, id).definition.subsystem!.variants![0].id;
  const other = syncInstances(
    switchVariant(
      setPortUnused(next, id, added.variantId, dropped.id, false),
      id,
      first,
    ),
  );
  assert.deepEqual(
    variantProblems(other)
      .filter((d) => d.id.startsWith('v-variant-port'))
      .map((d) => d.severity),
    ['warning'],
  );
});

void test('configurations choose every variant at once', () => {
  const { doc, id } = grouped();
  const added = addParameterVariant(doc, id, 'Fast')!;
  let next = syncInstances(added.project);
  const saved = saveConfiguration(next, 'Production');
  next = saved.project;
  const first = instance(next, id).definition.subsystem!.variants![0].id;
  next = syncInstances(switchVariant(next, id, first));
  const proto = saveConfiguration(next, 'Prototype');
  next = proto.project;
  assert.equal(matchingConfiguration(next)?.name, 'Prototype');
  next = applyConfiguration(next, saved.configuration);
  assert.equal(matchingConfiguration(next)?.name, 'Production');
  assert.equal(variantInstances(next)[0].active, added.variantId);
});

void test('variants inside a subsystem are switched by configurations too', () => {
  const { doc, id } = grouped();
  // Group the PI instance again, so the variant instance sits one level down.
  const outer = groupIntoSubsystem(doc, [id], 'Control')!;
  let next = syncInstances(outer.project);
  const view = scopeView(next, [outer.instanceId]);
  const added = addParameterVariant(view, id, 'Fast')!;
  next = writeScope(next, [outer.instanceId], added.project);
  const inst = variantInstances(next);
  assert.equal(inst.length, 1);
  assert.equal(inst[0].sheetId, outer.subsystemId);
  const saved = saveConfiguration(next, 'Fast').project;
  const first = inst[0].variants[0].id;
  const slow = applyConfiguration(saved, {
    id: 'c',
    name: 'Slow',
    choices: { [inst[0].key]: first },
  });
  assert.equal(variantInstances(slow)[0].active, first);
  assert.equal(
    matchingConfiguration(applyConfiguration(slow, saved.configurations![0]))
      ?.name,
    'Fast',
  );
});
