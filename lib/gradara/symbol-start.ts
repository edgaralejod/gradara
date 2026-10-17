/**
 * Where the symbol editor starts: the block's own drawing when it has one; a built-in
 * schematic symbol as a path to edit around; otherwise its box with the symbol text.
 */
import { blockShape, defaultBlockSize, showPortLabel } from './block-design';
import { portOffset, portSide } from './ports';
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
  // A triangle, circle, or tapered bar: its own outline as shapes over the whole body,
  // with each port's anchor right at its terminal, so it looks as it did.
  const shape = blockShape(d);
  if (shape === 'gain' || shape === 'sum' || shape === 'mux' || shape === 'demux') {
    const { width: w, height: h } = body;
    const outline =
      shape === 'sum'
        ? { type: 'ellipse' as const, cx: w / 2, cy: h / 2, rx: w / 2 - 1, ry: h / 2 - 1 }
        : {
            type: 'polygon' as const,
            points: (shape === 'gain'
              ? [[1, 1], [w - 1, h / 2], [1, h - 1]]
              : shape === 'mux'
                ? [[1, 1], [w - 1, h / 4], [w - 1, (3 * h) / 4], [1, h - 1]]
                : [[1, h / 4], [w - 1, 1], [w - 1, h - 1], [1, (3 * h) / 4]]) as [number, number][],
          };
    const anchors = Object.fromEntries(
      d.ports.map((p) => {
        const side = portSide(p);
        const along = side === 'left' || side === 'right' ? h : w;
        const at = (portOffset(d, p, along) / 100) * along;
        return [
          p.id,
          side === 'left' ? { x: 0, y: at } : side === 'right' ? { x: w, y: at }
            : side === 'top' ? { x: at, y: 0 } : { x: at, y: h },
        ];
      }),
    );
    const text = d.symbol.trim().slice(0, 24);
    return {
      width: w,
      height: h,
      shapes: [
        outline,
        ...(text && shape === 'gain'
          ? [{ type: 'text' as const, x: w * 0.36, y: h / 2, text }]
          : []),
      ],
      anchors,
      outline: false,
      captions: d.ports.some((p) => showPortLabel(d, p)),
      body,
    };
  }
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

/**
 * Whether a block's look can be edited. Subsystems, their ports, tags, and buses draw
 * what they hold (their inside, a tag, signal names), so they keep their faces.
 */
export function canEditSymbol(d: Definition): boolean {
  return (
    !d.subsystem &&
    !d.boundary &&
    !['goto', 'from', 'connectionLabel'].includes(d.kind) &&
    !['mux', 'demux', 'busCreator', 'busSelector', 'physicalBus'].includes(d.kind)
  );
}
