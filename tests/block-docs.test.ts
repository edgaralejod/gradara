import test from 'node:test';
import assert from 'node:assert/strict';
import { library } from '../lib/gradara/model';
import { blockDocs } from '../lib/gradara/block-docs';
import { readFileSync } from 'node:fs';
import {
  HAND_WRITTEN_KINDS,
  blockReference,
  mslDocsUrl,
} from '../lib/gradara/block-reference';

void test('every library block has a reference page covering all of its ports and parameters', () => {
  const kinds = new Set(library.map((d) => d.kind));
  for (const definition of library) {
    const doc = blockDocs[definition.kind];
    assert.ok(doc, `${definition.kind} has no documentation`);
    assert.ok(doc.description.length, `${definition.kind} description`);
    for (const port of definition.ports)
      assert.ok(
        doc.ports[port.id],
        `${definition.kind}.${port.id} undocumented`,
      );
    for (const parameter of definition.parameters)
      assert.ok(
        doc.parameters?.[parameter.id],
        `${definition.kind} parameter ${parameter.id} undocumented`,
      );
    for (const id of Object.keys(doc.ports))
      assert.ok(
        definition.ports.some((p) => p.id === id),
        `${definition.kind} documents a port ${id} it does not have`,
      );
    for (const id of Object.keys(doc.parameters ?? {}))
      assert.ok(
        definition.parameters.some((p) => p.id === id),
        `${definition.kind} documents a parameter ${id} it does not have`,
      );
    for (const kind of doc.seeAlso ?? [])
      assert.ok(kinds.has(kind), `${definition.kind} links to missing ${kind}`);
  }
  for (const kind of Object.keys(blockDocs))
    assert.ok(
      kinds.has(kind),
      `documentation for a block that is not in the library: ${kind}`,
    );
});

void test('a reference page takes its structure from the definition', () => {
  const resistor = library.find((d) => d.kind === 'resistor')!;
  const page = blockReference(resistor, blockDocs.resistor, library, ['Buck']);
  assert.equal(page.terminals.length, 2);
  assert.equal(page.inputs.length, 0);
  assert.equal(page.parameters[0].value, resistor.parameters[0].value);
  // The engine writes the resistor's Modelica by hand; its equations are a summary.
  assert.equal(page.source, undefined);
  const gain = library.find((d) => d.kind === 'gain')!;
  assert.ok(
    blockReference(gain, blockDocs.gain, library).source?.includes('y'),
  );
  assert.deepEqual(page.examples, ['Buck']);
  assert.equal(page.url, 'https://gradara.app/docs/blocks/resistor');
  const nmos = library.find((d) => d.kind === 'nmos')!;
  const msl = blockReference(nmos, blockDocs.nmos, library);
  assert.equal(msl.source, undefined);
  assert.equal(
    msl.msl?.url,
    mslDocsUrl('Modelica.Electrical.Analog.Semiconductors.NMOS'),
  );
  assert.match(
    msl.msl!.url,
    /helpDymola\/Modelica_Electrical_Analog_Semiconductors\.html#Modelica\.Electrical\.Analog\.Semiconductors\.NMOS$/,
  );
});

void test('the hand-written list matches the engine', () => {
  const engine = new Set(
    [
      ...readFileSync('server/modelica.py', 'utf8').matchAll(
        /PHYSICAL\['(\w+)'\]/g,
      ),
    ].map((m) => m[1]),
  );
  assert.deepEqual([...engine].sort(), [...HAND_WRITTEN_KINDS].sort());
});
