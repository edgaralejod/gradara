import test from 'node:test';
import assert from 'node:assert/strict';
import { library } from '../lib/gradara/model';
import { circuitGlyphs, circuitLayout } from '../lib/gradara/circuit-symbols';
import { pictorialSizes } from '../lib/gradara/pictorial';
import { defaultBlockSize } from '../lib/gradara/block-design';
import { portPoint } from '../lib/gradara/ports';

const ends = (d: string) => {
  const nums = d.match(/-?\d+(\.\d+)?/g)!.map(Number);
  return { start: { x: nums[0], y: nums[1] } };
};

void test('every pictorial block has a glyph with an anchor for each port, and a grid-sized body', () => {
  assert.deepEqual(
    Object.keys(circuitGlyphs).sort(),
    Object.keys(pictorialSizes).sort(),
  );
  for (const kind of Object.keys(pictorialSizes)) {
    const definition = library.find((d) => d.kind === kind);
    assert.ok(definition, `${kind} is not in the library`);
    for (const port of definition.ports)
      assert.ok(
        circuitGlyphs[kind].anchors[port.id],
        `${kind}.${port.id} has no anchor`,
      );
    const size = defaultBlockSize(definition);
    assert.equal(size.width % 16, 0);
    assert.equal(size.height % 16, 0);
    assert.ok(
      size.width >= circuitGlyphs[kind].width &&
        size.height >= circuitGlyphs[kind].height,
    );
  }
});

void test('leads start on the ports and are straight at the standard size', () => {
  for (const kind of Object.keys(pictorialSizes)) {
    const definition = library.find((d) => d.kind === kind)!;
    for (const grow of [0, 32]) {
      const size = defaultBlockSize(definition);
      const body = { width: size.width + grow, height: size.height + grow };
      const layout = circuitLayout(definition, body)!;
      const block = {
        id: 'b',
        definition,
        position: { x: 0, y: 0 },
        size: body,
      };
      for (const lead of layout.leads) {
        const port = portPoint(block, lead.port)!;
        assert.deepEqual(
          ends(lead.d).start,
          { x: port.x, y: port.y },
          `${kind}.${lead.port}`,
        );
        if (!grow)
          assert.ok(
            !/[HV].*[HV]/.test(lead.d.slice(1).replace(/^[\d. -]+/, '')),
            `${kind}.${lead.port} bends: ${lead.d}`,
          );
      }
      assert.equal(layout.leads.length, definition.ports.length);
    }
  }
});
