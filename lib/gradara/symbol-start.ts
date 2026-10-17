/**
 * Where the symbol editor starts: the block's own drawing when it has one; a built-in
 * schematic symbol as a path to edit around; otherwise its box with the symbol text.
 */
import { defaultBlockSize, showPortLabel } from './block-design';
import { circuitGlyphs } from './circuit-symbols';
import type { SymbolGlyph } from './glyph';
import type { Definition } from './model';

export function startingGlyph(d: Definition): SymbolGlyph {
  if (d.glyph) return structuredClone(d.glyph);
  const body = defaultBlockSize(d);
  const builtin = circuitGlyphs[d.kind];
  if (builtin)
    return {
      width: builtin.width,
      height: builtin.height,
      shapes: [
        { type: 'path', d: builtin.path },
        ...(builtin.fill
          ? [{ type: 'path' as const, d: builtin.fill, fill: true }]
          : []),
      ],
      anchors: structuredClone(builtin.anchors),
      outline: false,
      body,
    };
  // A box: the drawing fills the body inside an 8-unit margin, the symbol text centered.
  const width = Math.max(8, body.width - 16),
    height = Math.max(8, body.height - 16);
  const text = d.symbol.trim().slice(0, 24);
  return {
    width,
    height,
    shapes: text
      ? [{ type: 'text', x: width / 2, y: height / 2, text }]
      : [],
    anchors: {},
    outline: true,
    captions: d.ports.some((p) => showPortLabel(d, p)),
    body,
  };
}
