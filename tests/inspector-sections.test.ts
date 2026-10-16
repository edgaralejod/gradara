import test from 'node:test';
import assert from 'node:assert/strict';
import { library, type Block } from '../lib/gradara/model';
import {
  breakAtDots,
  hasEquations,
  modelicaClassOnly,
  portKindLabel,
} from '../lib/gradara/inspector-sections';

const block = (kind: string): Block => ({
  id: 'b',
  definition: structuredClone(library.find((d) => d.kind === kind)!),
  position: { x: 0, y: 0 },
});

void test('every library block’s properties have something real in each section', () => {
  for (const d of library) {
    const b = { id: 'b', definition: d, position: { x: 0, y: 0 } };
    // A Modelica library block shows its class, never an Equations box holding only a comment.
    if (d.modelica) assert.ok(modelicaClassOnly(d) || hasEquations(b), d.kind);
    if (modelicaClassOnly(d)) assert.equal(hasEquations(b), false, d.kind);
    // Parameters are named, and a limit range is never empty.
    for (const p of d.parameters) {
      assert.ok(p.name.trim(), `${d.kind}.${p.id} has a name`);
      assert.doesNotMatch(
        p.name,
        /\b(T_ref|fsNominal|Lzer|Linf|uHigh|uLow)\b/,
        `${d.kind}.${p.id}`,
      );
      if (p.min !== undefined && p.max !== undefined)
        assert.ok(p.min <= p.max, `${d.kind}.${p.id}`);
      if (p.min !== undefined)
        assert.ok(p.value >= p.min, `${d.kind}.${p.id} default ≥ min`);
      if (p.max !== undefined)
        assert.ok(p.value <= p.max, `${d.kind}.${p.id} default ≤ max`);
    }
  }
});

void test('subsystems, tags, and buses have no Equations section; equation blocks do', () => {
  assert.equal(hasEquations(block('goto')), false);
  assert.equal(hasEquations(block('connectionLabel')), false);
  assert.equal(hasEquations(block('busCreator')), false);
  assert.equal(hasEquations(block('relay')), true);
  assert.equal(modelicaClassOnly(block('resistor').definition), true);
  assert.equal(
    breakAtDots('Modelica.Electrical.Analog').replaceAll('​', ''),
    'Modelica.Electrical.Analog',
  );
});

void test('the Interface list names what each port carries in words', () => {
  const inverter = block('threePhaseInverter').definition.ports;
  const labels = new Set(inverter.map(portKindLabel));
  assert.ok(labels.has('3-phase'));
  assert.ok(labels.has('Boolean input'));
  assert.ok(labels.has('electrical'));
  // A translational flange is a flange, not a shaft.
  for (const kind of ['transFixed', 'forceStep', 'positionSource'])
    assert.equal(
      block(kind).definition.ports.find((p) => p.id === 'flange')?.name,
      'flange',
      kind,
    );
});
