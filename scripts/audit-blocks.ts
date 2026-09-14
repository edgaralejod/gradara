/** Regenerate the structural inventory; browser visual review remains a separate step. */
import { writeFileSync } from 'node:fs';
import { library } from '../lib/gradara/model';
import { blockSize } from '../lib/gradara/canvas';
import {
  blockShape,
  defaultBlockSize,
  showPortLabel,
} from '../lib/gradara/block-design';
import { categoryOf } from '../lib/gradara/catalog';

const notes: Record<string, string> = {
  dcSource: 'Ideal constant voltage; vertical leads meet electrical terminals.',
  idealSwitch: 'True zero-Ron / zero-Goff switch; signal gate on the left.',
  voltageSensor:
    'Zero-loading voltage measurement; signal output on the right.',
  currentSensor: 'Zero-drop current measurement; signal output below.',
  pwmPair: 'Two complementary outputs retain hi / lo captions; 128 × 96 body.',
  sum: 'One circle; signs at input terminals.',
  subtract: 'Minus sign identifies the subtracting input.',
  gain: 'Triangle, bounded gain value.',
  secondOrder: 'Complete denominator: s² + 2ζωₙs + ωₙ².',
  discreteIntegrator:
    'Ts·z / (z−1) matches the implemented current-sample accumulation; description corrected.',
  pmsm: 'Expanded width for four bottom signal terminals; mixed-domain colors.',
  mux: 'Caption-only tapered body. Existing scalar stand-in, not a vector bus.',
  demux:
    'Caption-only tapered body. Existing scalar stand-in, not a vector bus.',
  subsystem:
    'Nested-block glyph. Existing pass-through placeholder; no hierarchical execution.',
  display: '123 is a notation glyph, not a live numerical readout.',
  scope: 'Scope glyph; actual simulation traces remain in the results panel.',
  abs: 'Unambiguous |u| notation.',
  sign: 'Recognizable sgn notation.',
  resistor: 'Unboxed; leads touch both terminal coordinates.',
  capacitor: 'Unboxed; leads touch both terminal coordinates.',
  inductor: 'Coil baseline aligned with both terminals.',
  diode: 'Extended leads reach both terminals.',
};
const standard = library.filter((d) => {
  const s = defaultBlockSize(d);
  return s.width === 80 && s.height === 64;
}).length;
const dims = (s: { width: number; height: number }) =>
  `${s.width} × ${s.height}`;
const rows = library
  .map(
    (d) =>
      `| ${d.name} | \`${d.kind}\` | ${categoryOf(d)} | ${dims(blockSize({ id: d.kind, definition: d, position: { x: 0, y: 0 } }))} | ${dims(defaultBlockSize(d))} | ${blockShape(d)} | ${d.ports.length} / ${d.ports.filter((p) => showPortLabel(d, p)).length} | ${notes[d.kind] ?? 'Shared typography, symbol well, and caption rules.'} |`,
  )
  .join('\n');
writeFileSync(
  'BLOCK_AUDIT.md',
  `# Gradara block audit

Generated with \`npm run audit:blocks\`. This inventory comes from the live catalog; it is not an automated claim of visual or numerical correctness. Visual review uses [/block-catalog](http://localhost:4317/block-catalog).

## Scope and findings

All **${library.length} built-in definitions** now use the same face in the canvas and library. **${standard} of ${library.length}** use the 80 × 64 standard envelope, including gain. Remaining sizes are semantic exceptions or port-driven expansions. All normal diagram text uses the shared 14 px scale.

The previous catalog mixed ${new Set(library.map((d) => dims(blockSize({ id: d.kind, definition: d, position: { x: 0, y: 0 } })))).size} body dimensions, separate library/canvas outlines, and multiple symbol/label font scales. The refresh removes the library's duplicate sum/gain outlines, standardizes unary and binary math, reserves space for terminal captions, bounds numeric labels, and fixes circuit lead continuity. The full second-order transfer notation and discrete-integrator notation now match their existing equations. The original visual pass preserved numerical behavior. The power-electronics extension adds five executable definitions; the ideal-switch buck is checked separately in \`tests/test_buck.py\` and documented in [BUCK.md](models/BUCK.md).

Legacy dimensions below remain the fallback for old unsized v1 documents. Existing explicitly sized blocks also retain their sizes. Use the inspector's **Use standard size** action to opt a block into the new dimensions.

## Complete inventory

Ports / captions counts include all terminals and captions visible at canvas scale. Library thumbnails omit terminal captions except sum signs.

| Block | Kind | Category | Legacy fallback | New default | Shape | Ports / captions | Review notes |
| --- | --- | --- | --- | --- | --- | --- | --- |
${rows}

## Remaining boundaries

- This is a visual/catalog audit, not a proof of all component physics. Mux, Demux, Subsystem, Display, and Scope have the limitations noted above.
- No built-in thermal block currently exists; thermal coloring is supported by the shared domain system.
- Historical custom sizes may still be too small for complete notation. Resizing them to the standard is deliberate and undoable, not an automatic migration.
- Very long port captions ellipsize and retain their full tooltip/inspector value. Custom tightly clustered offsets need manual review.
- A future block should be added to the catalog automatically and reviewed using [the authoring guide](docs/blocks/AGENT_BLOCK_GUIDE.md). Preserve this renderer architecture instead of adding one-off library icons.
`,
);
console.log(
  `Audited ${library.length} definitions; ${standard} use the standard envelope. Wrote BLOCK_AUDIT.md.`,
);
