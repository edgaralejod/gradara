/**
 * A block's own drawn symbol (`Definition.glyph`), made in the symbol editor or drawn by
 * the AI, and stored with the definition so it travels with the model and the AI blocks
 * library.
 *
 * It is the same model as the built-in schematic symbols (`circuitGlyphs` in
 * circuit-symbols.ts): a drawing in its own design box, with an anchor for each port
 * where that port's lead meets the drawing. The block draws it at design size, centered,
 * and runs a lead from each grid port to its anchor, so rotation, flip, upright text,
 * the sheet grid, and wire routing need nothing new. A drawing is presentation only: it
 * never reaches the emitted Modelica or the semantic signature.
 *
 * Shapes are kept as shapes (not one path string) so the editor can select and move
 * them; `compileGlyph` turns them into the stroke and fill paths the renderer draws.
 * Coordinates are design-box units with y pointing down; angles are degrees, clockwise
 * from the +x axis. Mirrored in server/models.py (`SymbolGlyph`), which enforces the
 * same limits.
 */
import type { Definition, Port } from './model';

export type GlyphPoint = [number, number];

export type GlyphShape =
  /** An open line through two or more points. */
  | { type: 'line'; points: GlyphPoint[] }
  /** A closed outline; `fill` paints it solid (an arrowhead, a gate triangle). */
  | { type: 'polygon'; points: GlyphPoint[]; fill?: boolean }
  | {
      type: 'rect';
      x: number;
      y: number;
      width: number;
      height: number;
      rx?: number;
      fill?: boolean;
    }
  | {
      type: 'ellipse';
      cx: number;
      cy: number;
      rx: number;
      ry: number;
      fill?: boolean;
    }
  /**
   * Plain SVG path data (M, L, H, V, C, S, Q, T, A, Z and numbers only): a built-in
   * symbol the editing started from, or a curve the AI drew. Moved as a whole.
   */
  | { type: 'path'; d: string; fill?: boolean }
  /** Part of a circle, from `start` to `end` degrees, clockwise. */
  | { type: 'arc'; cx: number; cy: number; r: number; start: number; end: number }
  /** A short label drawn in the diagram font; it stays upright when the block turns. */
  | {
      type: 'text';
      x: number;
      y: number;
      text: string;
      size?: 'normal' | 'small';
      anchor?: 'start' | 'middle' | 'end';
    };

export type SymbolGlyph = {
  /** The design box. */
  width: number;
  height: number;
  shapes: GlyphShape[];
  /** Port ID → where its lead meets the drawing. A port without one has no lead. */
  anchors: Record<string, { x: number; y: number }>;
  /** Keep the block's box around the drawing; otherwise it is drawn unboxed, like a schematic symbol. */
  outline?: boolean;
  /** Show terminal names (default: on for a boxed drawing, off for an unboxed one). */
  captions?: boolean;
  /** The block's standard body (before rotation), in 16-unit steps; default from the drawing. */
  body?: { width: number; height: number };
};

/** Bounds shared with server/models.py. */
export const GLYPH_LIMITS = {
  /** Largest design box side and body side. */
  size: 320,
  shapes: 200,
  points: 400,
  text: 24,
  /** Longest `path` shape data. */
  path: 4000,
  /** How far outside the design box a coordinate may reach. */
  margin: 16,
} as const;

/** What the renderer draws: one stroked path, one filled path, and upright labels. */
export type CompiledGlyph = {
  width: number;
  height: number;
  path: string;
  fill?: string;
  texts: {
    x: number;
    y: number;
    text: string;
    size: 'normal' | 'small';
    anchor: 'start' | 'middle' | 'end';
  }[];
  anchors: Record<string, { x: number; y: number }>;
};

const n = (v: number) => String(Math.round(v * 100) / 100);
const pts = (points: GlyphPoint[]) =>
  points.map(([x, y], i) => `${i ? 'L' : 'M'}${n(x)} ${n(y)}`).join('');

/** The SVG path of one shape (empty for text). */
export function shapePath(shape: GlyphShape): string {
  switch (shape.type) {
    case 'line':
      return pts(shape.points);
    case 'polygon':
      return `${pts(shape.points)}Z`;
    case 'rect': {
      const { x, y, width: w, height: h } = shape;
      const r = Math.max(0, Math.min(shape.rx ?? 0, w / 2, h / 2));
      if (!r) return `M${n(x)} ${n(y)}H${n(x + w)}V${n(y + h)}H${n(x)}Z`;
      return (
        `M${n(x + r)} ${n(y)}H${n(x + w - r)}A${n(r)} ${n(r)} 0 0 1 ${n(x + w)} ${n(y + r)}` +
        `V${n(y + h - r)}A${n(r)} ${n(r)} 0 0 1 ${n(x + w - r)} ${n(y + h)}` +
        `H${n(x + r)}A${n(r)} ${n(r)} 0 0 1 ${n(x)} ${n(y + h - r)}` +
        `V${n(y + r)}A${n(r)} ${n(r)} 0 0 1 ${n(x + r)} ${n(y)}Z`
      );
    }
    case 'ellipse': {
      const { cx, cy, rx, ry } = shape;
      return (
        `M${n(cx - rx)} ${n(cy)}A${n(rx)} ${n(ry)} 0 1 0 ${n(cx + rx)} ${n(cy)}` +
        `A${n(rx)} ${n(ry)} 0 1 0 ${n(cx - rx)} ${n(cy)}Z`
      );
    }
    case 'arc': {
      const { cx, cy, r } = shape;
      let sweep = (((shape.end - shape.start) % 360) + 360) % 360;
      if (sweep === 0) sweep = 360;
      const at = (deg: number) => {
        const a = (deg * Math.PI) / 180;
        return [cx + r * Math.cos(a), cy + r * Math.sin(a)];
      };
      const [x0, y0] = at(shape.start);
      if (sweep >= 360) {
        const [x1, y1] = at(shape.start + 180);
        return `M${n(x0)} ${n(y0)}A${n(r)} ${n(r)} 0 1 1 ${n(x1)} ${n(y1)}A${n(r)} ${n(r)} 0 1 1 ${n(x0)} ${n(y0)}`;
      }
      const [x1, y1] = at(shape.start + sweep);
      return `M${n(x0)} ${n(y0)}A${n(r)} ${n(r)} 0 ${sweep > 180 ? 1 : 0} 1 ${n(x1)} ${n(y1)}`;
    }
    case 'path':
      return shape.d;
    case 'text':
      return '';
  }
}

/** Path data that is only drawing commands and numbers (no scripts, URLs, or styles). */
export const PATH_DATA = /^[MmLlHhVvCcSsQqTtAaZz0-9.,eE\s+-]*$/;

/** Turn a stored drawing into the stroke and fill paths and labels the renderer draws. */
export function compileGlyph(glyph: SymbolGlyph): CompiledGlyph {
  const strokes: string[] = [];
  const fills: string[] = [];
  const texts: CompiledGlyph['texts'] = [];
  for (const shape of glyph.shapes) {
    if (shape.type === 'text') {
      texts.push({
        x: shape.x,
        y: shape.y,
        text: shape.text,
        size: shape.size ?? 'normal',
        anchor: shape.anchor ?? 'middle',
      });
      continue;
    }
    const d = shapePath(shape);
    strokes.push(d);
    if ('fill' in shape && shape.fill) fills.push(d);
  }
  return {
    width: glyph.width,
    height: glyph.height,
    path: strokes.join(''),
    ...(fills.length ? { fill: fills.join('') } : {}),
    texts,
    anchors: glyph.anchors,
  };
}

const finite = (...values: unknown[]) =>
  values.every((v) => typeof v === 'number' && Number.isFinite(v));

/**
 * Why `glyph` cannot be stored for a block with `ports`, or null when it can. The
 * service enforces the same rules (server/models.py `SymbolGlyph`).
 */
export function glyphProblem(
  glyph: SymbolGlyph,
  ports: Pick<Port, 'id'>[],
): string | null {
  const { size, shapes, points, text, margin } = GLYPH_LIMITS;
  if (!finite(glyph.width, glyph.height))
    return 'The drawing needs a width and height.';
  if (
    glyph.width < 8 ||
    glyph.height < 8 ||
    glyph.width > size ||
    glyph.height > size
  )
    return `The drawing must be 8 to ${size} units on each side.`;
  if (glyph.body) {
    const { width, height } = glyph.body;
    if (!finite(width, height) || width % 16 || height % 16)
      return 'The body size is in 16-unit steps.';
    if (width < 16 || height < 16 || width > size || height > size)
      return `The body must be 16 to ${size} units on each side.`;
  }
  if (!Array.isArray(glyph.shapes) || glyph.shapes.length > shapes)
    return `A drawing has at most ${shapes} shapes.`;
  const inBox = (x: number, y: number) =>
    x >= -margin &&
    y >= -margin &&
    x <= glyph.width + margin &&
    y <= glyph.height + margin;
  let count = 0;
  for (const shape of glyph.shapes) {
    switch (shape.type) {
      case 'line':
      case 'polygon':
        if (!Array.isArray(shape.points) || shape.points.length < 2)
          return 'A line needs at least two points.';
        count += shape.points.length;
        if (
          shape.points.some(
            (p) => !Array.isArray(p) || !finite(p[0], p[1]) || !inBox(p[0], p[1]),
          )
        )
          return 'A point lies outside the drawing.';
        break;
      case 'rect':
        if (!finite(shape.x, shape.y, shape.width, shape.height) || shape.width <= 0 || shape.height <= 0)
          return 'A rectangle needs a position and a positive size.';
        if (!inBox(shape.x, shape.y) || !inBox(shape.x + shape.width, shape.y + shape.height))
          return 'A rectangle lies outside the drawing.';
        break;
      case 'ellipse':
        if (!finite(shape.cx, shape.cy, shape.rx, shape.ry) || shape.rx <= 0 || shape.ry <= 0)
          return 'An ellipse needs a center and positive radii.';
        if (!inBox(shape.cx - shape.rx, shape.cy - shape.ry) || !inBox(shape.cx + shape.rx, shape.cy + shape.ry))
          return 'An ellipse lies outside the drawing.';
        break;
      case 'arc':
        if (!finite(shape.cx, shape.cy, shape.r, shape.start, shape.end) || shape.r <= 0)
          return 'An arc needs a center, a positive radius, and two angles.';
        if (!inBox(shape.cx - shape.r, shape.cy - shape.r) || !inBox(shape.cx + shape.r, shape.cy + shape.r))
          return 'An arc lies outside the drawing.';
        break;
      case 'path':
        if (
          typeof shape.d !== 'string' ||
          !shape.d.trim() ||
          shape.d.length > GLYPH_LIMITS.path ||
          !PATH_DATA.test(shape.d)
        )
          return 'A path holds drawing commands and numbers only.';
        break;
      case 'text':
        if (typeof shape.text !== 'string' || !shape.text.trim() || shape.text.length > text)
          return `A label has 1 to ${text} characters.`;
        if (!finite(shape.x, shape.y) || !inBox(shape.x, shape.y))
          return 'A label lies outside the drawing.';
        break;
      default:
        return 'The drawing has a shape Gradara does not know.';
    }
  }
  if (count > points) return `A drawing has at most ${points} points.`;
  const ids = new Set(ports.map((p) => p.id));
  for (const [id, a] of Object.entries(glyph.anchors ?? {})) {
    if (!ids.has(id)) return `The drawing has an anchor for a port the block does not have (${id}).`;
    if (!finite(a?.x, a?.y) || !inBox(a.x, a.y))
      return 'A port anchor lies outside the drawing.';
  }
  return null;
}

/** The drawing to render for a block: its own, or none. */
export const drawnGlyph = (d: Pick<Definition, 'glyph'>) => d.glyph;

/** A drawing whose anchors name only ports the definition still has (after ports change). */
export function withLiveAnchors(d: Definition): Definition {
  if (!d.glyph) return d;
  const ids = new Set(d.ports.map((p) => p.id));
  const anchors = Object.fromEntries(
    Object.entries(d.glyph.anchors).filter(([id]) => ids.has(id)),
  );
  return Object.keys(anchors).length === Object.keys(d.glyph.anchors).length
    ? d
    : { ...d, glyph: { ...d.glyph, anchors } };
}
