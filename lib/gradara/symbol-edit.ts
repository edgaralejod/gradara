/**
 * The symbol editor's model: pure, immutable operations on what is being edited (a
 * block's definition, its drawing, and its body size), and a small undo history.
 *
 * Coordinates of shapes and anchors are design-box units (glyph.ts). The design box
 * sits centered in the body, as `circuitLayout` draws it, so `designOrigin` turns body
 * coordinates into design coordinates. Snapping happens in body coordinates, which keeps
 * a point on the same grid as the terminals: an anchor snapped to a terminal's line
 * gives a straight lead.
 */
import { defaultBlockSize } from './block-design';
import { blockSize } from './canvas';
import {
  GLYPH_LIMITS,
  glyphProblem,
  type GlyphPoint,
  type GlyphShape,
  type SymbolGlyph,
} from './glyph';
import { GRID, SIZE_STEP, snapOffset } from './grid';
import type { Block, Definition, Port } from './model';
import { portOffset, portSide, type Side } from './ports';
import { startingGlyph } from './symbol-start';

export type Size = { width: number; height: number };
export type SymbolEdit = {
  definition: Definition;
  glyph: SymbolGlyph;
  /** The body before rotation, in size steps. */
  size: Size;
  /**
   * The block keeps its standard look: the result carries no drawing until the drawing
   * is edited (`glyph` is then where editing starts, see symbol-start.ts). True when
   * the block has no drawing of its own and after Reset to standard; port moves and
   * body size keep it, so rearranging terminals never replaces a block's look.
   */
  standard?: boolean;
};

export const SNAP_STEPS = [1, 2, 4, 8] as const;
export type SnapStep = (typeof SNAP_STEPS)[number];

const round = (v: number) => Math.round(v * 100) / 100;
export const snapTo = (value: number, step: number) =>
  step > 0 ? round(Math.round(value / step) * step) : round(value);

// ── Starting and finishing ────────────────────────────────────────────────────

/** The block's body before rotation (Block.size holds the turned bounds). */
export function bodyOf(block: Block): Size {
  const size = blockSize(block);
  const turned = (block.rotation ?? 0) % 180 !== 0;
  return turned ? { width: size.height, height: size.width } : { ...size };
}

/** The size to give the block on the sheet: the body, turned as the block is. */
export function sheetSize(body: Size, rotation = 0): Size {
  return rotation % 180 ? { width: body.height, height: body.width } : body;
}

export function startEdit(block: Block): SymbolEdit {
  const definition = structuredClone(block.definition);
  const glyph = startingGlyph(definition);
  return {
    definition,
    glyph,
    size: clampBody(bodyOf(block)),
    ...(definition.glyph ? {} : { standard: true }),
  };
}

/** The edited definition to apply: ports with their sides and offsets, and the drawing. */
export function buildResult(edit: SymbolEdit): Definition {
  const { glyph: _drop, ...rest } = edit.definition;
  if (edit.standard) return { ...rest, ports: edit.definition.ports };
  const ids = new Set(edit.definition.ports.map((p) => p.id));
  const anchors = Object.fromEntries(
    Object.entries(edit.glyph.anchors).filter(([id]) => ids.has(id)),
  );
  return {
    ...rest,
    ports: edit.definition.ports,
    glyph: { ...edit.glyph, anchors, body: { ...edit.size } },
  };
}

/** Why the edit cannot be applied, or null. */
export function editProblem(edit: SymbolEdit): string | null {
  if (edit.standard) return null;
  return glyphProblem(
    { ...edit.glyph, body: { ...edit.size } },
    edit.definition.ports,
  );
}

/**
 * Reset to standard: the library's port sides and offsets, no drawing, and the standard
 * body. Ports the library does not have keep their places.
 */
export function resetToStandard(
  edit: SymbolEdit,
  standard: Definition,
): SymbolEdit {
  const ports = edit.definition.ports.map((p) => {
    const s = standard.ports.find((q) => q.id === p.id);
    const { side: _s, offset: _o, ...bare } = p;
    if (!s) return p;
    return {
      ...bare,
      ...(s.side ? { side: s.side } : {}),
      ...(typeof s.offset === 'number' ? { offset: s.offset } : {}),
    };
  });
  const { glyph: _drop, ...rest } = edit.definition;
  const definition: Definition = { ...rest, ports };
  return {
    definition,
    glyph: startingGlyph(definition),
    size: clampBody(defaultBlockSize(definition)),
    standard: true,
  };
}

/** Leave the standard look: the drawing to edit starts from the standard symbol. */
function drawn(edit: SymbolEdit): SymbolEdit {
  return edit.standard ? { ...edit, standard: false } : edit;
}
const withGlyph = (edit: SymbolEdit, glyph: SymbolGlyph): SymbolEdit => ({
  ...drawn(edit),
  glyph,
});

// ── Geometry helpers ──────────────────────────────────────────────────────────

/** Where the design box's origin sits in the body. */
export function designOrigin(edit: Pick<SymbolEdit, 'glyph' | 'size'>) {
  return {
    x: (edit.size.width - edit.glyph.width) / 2,
    y: (edit.size.height - edit.glyph.height) / 2,
  };
}

/** Snap a design-box point on the body's grid of `step` units. */
export function snapDesignPoint(
  edit: Pick<SymbolEdit, 'glyph' | 'size'>,
  p: { x: number; y: number },
  step: number,
): GlyphPoint {
  const o = designOrigin(edit);
  return [
    round(snapTo(p.x + o.x, step) - o.x),
    round(snapTo(p.y + o.y, step) - o.y),
  ];
}

const sideIsVertical = (side: Side) => side === 'left' || side === 'right';
export const sideLengthOf = (side: Side, size: Size) =>
  sideIsVertical(side) ? size.height : size.width;

/** A port's place along its side, in body units from the side's start. */
export function portAlong(
  edit: Pick<SymbolEdit, 'definition' | 'size'>,
  port: Port,
) {
  const len = sideLengthOf(portSide(port), edit.size);
  return round((portOffset(edit.definition, port, len) / 100) * len);
}

/** A port's point on the body (before rotation). */
export function portBodyPoint(
  edit: Pick<SymbolEdit, 'definition' | 'size'>,
  port: Port,
) {
  const side = portSide(port);
  const along = portAlong(edit, port);
  const { width, height } = edit.size;
  if (side === 'left') return { x: 0, y: along };
  if (side === 'right') return { x: width, y: along };
  if (side === 'top') return { x: along, y: 0 };
  return { x: along, y: height };
}

/** The axis-aligned bounds of a shape, in design units (text is estimated). */
export function shapeBounds(shape: GlyphShape) {
  switch (shape.type) {
    case 'line':
    case 'polygon': {
      const xs = shape.points.map((p) => p[0]),
        ys = shape.points.map((p) => p[1]);
      return box(
        Math.min(...xs),
        Math.min(...ys),
        Math.max(...xs),
        Math.max(...ys),
      );
    }
    case 'rect':
      return box(
        shape.x,
        shape.y,
        shape.x + shape.width,
        shape.y + shape.height,
      );
    case 'ellipse':
      return box(
        shape.cx - shape.rx,
        shape.cy - shape.ry,
        shape.cx + shape.rx,
        shape.cy + shape.ry,
      );
    case 'arc':
      return arcBounds(shape);
    case 'path':
      return pathBounds(shape.d);
    case 'text': {
      const font = shape.size === 'small' ? 12 : 14;
      const w = Math.max(4, shape.text.length * font * 0.58);
      const anchor = shape.anchor ?? 'middle';
      const x0 =
        anchor === 'start'
          ? shape.x
          : anchor === 'end'
            ? shape.x - w
            : shape.x - w / 2;
      return box(x0, shape.y - font / 2, x0 + w, shape.y + font / 2);
    }
  }
}
const box = (x0: number, y0: number, x1: number, y1: number) => ({
  x: x0,
  y: y0,
  width: x1 - x0,
  height: y1 - y0,
});

function arcBounds(a: Extract<GlyphShape, { type: 'arc' }>) {
  let sweep = (((a.end - a.start) % 360) + 360) % 360;
  if (sweep === 0) sweep = 360;
  const at = (deg: number) => {
    const r = (deg * Math.PI) / 180;
    return [a.cx + a.r * Math.cos(r), a.cy + a.r * Math.sin(r)];
  };
  const pts = [at(a.start), at(a.start + sweep)];
  for (let k = Math.ceil(a.start / 90) * 90; k < a.start + sweep; k += 90)
    pts.push(at(k));
  const xs = pts.map((p) => p[0]),
    ys = pts.map((p) => p[1]);
  return box(
    Math.min(...xs),
    Math.min(...ys),
    Math.max(...xs),
    Math.max(...ys),
  );
}

type PathCommand = { cmd: string; args: number[] };
const ARITY: Record<string, number> = {
  M: 2,
  L: 2,
  H: 1,
  V: 1,
  C: 6,
  S: 4,
  Q: 4,
  T: 2,
  A: 7,
  Z: 0,
};

export function parsePath(d: string): PathCommand[] {
  const tokens =
    d.match(/[MmLlHhVvCcSsQqTtAaZz]|-?(?:\d+\.?\d*|\.\d+)(?:[eE][-+]?\d+)?/g) ??
    [];
  const out: PathCommand[] = [];
  let cmd = '';
  let args: number[] = [];
  const flush = () => {
    if (!cmd) return;
    const n = ARITY[cmd.toUpperCase()];
    if (n === 0) {
      out.push({ cmd, args: [] });
      return;
    }
    for (let i = 0; i + n <= args.length; i += n) {
      // Extra coordinate pairs after a moveto are linetos.
      const c = i > 0 && cmd === 'M' ? 'L' : i > 0 && cmd === 'm' ? 'l' : cmd;
      out.push({ cmd: c, args: args.slice(i, i + n) });
    }
  };
  for (const t of tokens) {
    if (/[A-Za-z]/.test(t)) {
      flush();
      cmd = t;
      args = [];
      if (t === 'Z' || t === 'z') {
        flush();
        cmd = '';
      }
    } else args.push(Number(t));
  }
  flush();
  return out;
}

const formatPath = (cmds: PathCommand[]) =>
  cmds
    .map((c) => c.cmd + c.args.map((a) => String(round(a))).join(' '))
    .join('');

/** Move path data by (dx, dy): absolute coordinates shift, relative ones stay. */
export function translatePath(d: string, dx: number, dy: number): string {
  const cmds = parsePath(d).map((c, i) => {
    const args = [...c.args];
    // A path's first relative moveto is absolute.
    const absolute =
      c.cmd === c.cmd.toUpperCase() || (i === 0 && c.cmd === 'm');
    if (!absolute) return c;
    switch (c.cmd.toUpperCase()) {
      case 'H':
        args[0] += dx;
        break;
      case 'V':
        args[0] += dy;
        break;
      case 'A':
        args[5] += dx;
        args[6] += dy;
        break;
      case 'Z':
        break;
      default:
        for (let k = 0; k < args.length; k += 2) {
          args[k] += dx;
          args[k + 1] += dy;
        }
    }
    return { cmd: c.cmd, args };
  });
  return formatPath(cmds);
}

/** Bounds of path data from its end and control points (close enough for selection). */
export function pathBounds(d: string) {
  let x = 0,
    y = 0,
    sx = 0,
    sy = 0;
  const xs: number[] = [],
    ys: number[] = [];
  const add = (px: number, py: number) => {
    xs.push(px);
    ys.push(py);
  };
  for (const { cmd, args } of parsePath(d)) {
    const rel = cmd !== cmd.toUpperCase();
    const C = cmd.toUpperCase();
    const bx = rel ? x : 0,
      by = rel ? y : 0;
    if (C === 'Z') {
      x = sx;
      y = sy;
      continue;
    }
    if (C === 'H') x = bx + args[0];
    else if (C === 'V') y = by + args[0];
    else if (C === 'A') {
      x = bx + args[5];
      y = by + args[6];
    } else {
      for (let k = 0; k < args.length - 2; k += 2)
        add(bx + args[k], by + args[k + 1]);
      x = bx + args[args.length - 2];
      y = by + args[args.length - 1];
    }
    if (C === 'M') {
      sx = x;
      sy = y;
    }
    add(x, y);
  }
  if (!xs.length) return box(0, 0, 0, 0);
  return box(
    Math.min(...xs),
    Math.min(...ys),
    Math.max(...xs),
    Math.max(...ys),
  );
}

// ── Shapes ────────────────────────────────────────────────────────────────────

const mapShapes = (
  edit: SymbolEdit,
  indices: Iterable<number>,
  f: (s: GlyphShape) => GlyphShape,
) => {
  const set = new Set(indices);
  return withGlyph(edit, {
    ...edit.glyph,
    shapes: edit.glyph.shapes.map((s, i) => (set.has(i) ? f(s) : s)),
  });
};

export function addShape(edit: SymbolEdit, shape: GlyphShape): SymbolEdit {
  return withGlyph(edit, {
    ...edit.glyph,
    shapes: [...edit.glyph.shapes, shape],
  });
}
/** Replace several shapes at once (the AI's drawing, a pasted set). */
export function replaceDrawing(
  edit: SymbolEdit,
  glyph: SymbolGlyph,
): SymbolEdit {
  return withGlyph(edit, {
    ...structuredClone(glyph),
    body: glyph.body ?? edit.glyph.body,
  });
}

export function updateShape(
  edit: SymbolEdit,
  index: number,
  shape: GlyphShape,
): SymbolEdit {
  return mapShapes(edit, [index], () => shape);
}

export function deleteShapes(
  edit: SymbolEdit,
  indices: Iterable<number>,
): SymbolEdit {
  const set = new Set(indices);
  if (!set.size) return edit;
  return withGlyph(edit, {
    ...edit.glyph,
    shapes: edit.glyph.shapes.filter((_, i) => !set.has(i)),
  });
}

export function moveShape(
  shape: GlyphShape,
  dx: number,
  dy: number,
): GlyphShape {
  const pt = ([x, y]: GlyphPoint): GlyphPoint => [round(x + dx), round(y + dy)];
  switch (shape.type) {
    case 'line':
    case 'polygon':
      return { ...shape, points: shape.points.map(pt) };
    case 'rect':
    case 'text':
      return { ...shape, x: round(shape.x + dx), y: round(shape.y + dy) };
    case 'ellipse':
    case 'arc':
      return { ...shape, cx: round(shape.cx + dx), cy: round(shape.cy + dy) };
    case 'path':
      return { ...shape, d: translatePath(shape.d, dx, dy) };
  }
}

export function moveShapes(
  edit: SymbolEdit,
  indices: Iterable<number>,
  dx: number,
  dy: number,
): SymbolEdit {
  if (!dx && !dy) return edit;
  return mapShapes(edit, indices, (s) => moveShape(s, dx, dy));
}

/** Copies of the shapes, offset one grid step, appended; returns their new indices. */
export function duplicateShapes(
  edit: SymbolEdit,
  indices: Iterable<number>,
  offset = GRID,
): { edit: SymbolEdit; indices: number[] } {
  const picked = [...new Set(indices)]
    .sort((a, b) => a - b)
    .filter((i) => edit.glyph.shapes[i]);
  const copies = picked.map((i) =>
    moveShape(structuredClone(edit.glyph.shapes[i]), offset, offset),
  );
  const start = edit.glyph.shapes.length;
  return {
    edit: withGlyph(edit, {
      ...edit.glyph,
      shapes: [...edit.glyph.shapes, ...copies],
    }),
    indices: copies.map((_, k) => start + k),
  };
}

/**
 * Bring shapes forward (+1) or back (-1) one place, or to the front / back
 * ('front' | 'back'). Returns the shapes' new indices so the selection can follow.
 */
export function reorderShapes(
  edit: SymbolEdit,
  indices: Iterable<number>,
  to: 1 | -1 | 'front' | 'back',
): { edit: SymbolEdit; indices: number[] } {
  const set = new Set(indices);
  const tagged = edit.glyph.shapes.map((shape, i) => ({
    shape,
    picked: set.has(i),
  }));
  let order = tagged;
  if (to === 'front')
    order = [
      ...tagged.filter((t) => !t.picked),
      ...tagged.filter((t) => t.picked),
    ];
  else if (to === 'back')
    order = [
      ...tagged.filter((t) => t.picked),
      ...tagged.filter((t) => !t.picked),
    ];
  else {
    order = [...tagged];
    const step = (i: number) => {
      const j = i + (to as number);
      if (j < 0 || j >= order.length || order[j].picked) return;
      [order[i], order[j]] = [order[j], order[i]];
    };
    if (to === 1) {
      for (let i = order.length - 1; i >= 0; i--) if (order[i].picked) step(i);
    } else for (let i = 0; i < order.length; i++) if (order[i].picked) step(i);
  }
  const next = withGlyph(edit, {
    ...edit.glyph,
    shapes: order.map((t) => t.shape),
  });
  return {
    edit: next,
    indices: order.flatMap((t, i) => (t.picked ? [i] : [])),
  };
}

export type Handle = { id: string; x: number; y: number };

/**
 * The handles a selected shape offers: its points (line, polygon), corners (rect),
 * radii (ellipse), or ends (arc). A path or a label is moved whole.
 */
export function shapeHandles(shape: GlyphShape): Handle[] {
  switch (shape.type) {
    case 'line':
    case 'polygon':
      return shape.points.map(([x, y], i) => ({ id: `p${i}`, x, y }));
    case 'rect': {
      const { x, y, width: w, height: h } = shape;
      return [
        { id: 'nw', x, y },
        { id: 'ne', x: x + w, y },
        { id: 'sw', x, y: y + h },
        { id: 'se', x: x + w, y: y + h },
      ];
    }
    case 'ellipse':
      return [
        { id: 'rx', x: shape.cx + shape.rx, y: shape.cy },
        { id: 'ry', x: shape.cx, y: shape.cy + shape.ry },
      ];
    case 'arc': {
      const at = (deg: number) => ({
        x: round(shape.cx + shape.r * Math.cos((deg * Math.PI) / 180)),
        y: round(shape.cy + shape.r * Math.sin((deg * Math.PI) / 180)),
      });
      return [
        { id: 'center', x: shape.cx, y: shape.cy },
        { id: 'start', ...at(shape.start) },
        { id: 'end', ...at(shape.end) },
      ];
    }
    default:
      return [];
  }
}

/** Degrees clockwise from +x (y down) from `c` to `p`, in [0, 360). */
export const angleOf = (
  c: { x: number; y: number },
  p: { x: number; y: number },
) => round(((Math.atan2(p.y - c.y, p.x - c.x) * 180) / Math.PI + 360) % 360);

/** A shape with handle `id` dragged to `p` (design units, already snapped). */
export function dragHandle(
  shape: GlyphShape,
  id: string,
  [px, py]: GlyphPoint,
): GlyphShape {
  switch (shape.type) {
    case 'line':
    case 'polygon': {
      const i = Number(id.slice(1));
      return {
        ...shape,
        points: shape.points.map((p, k) => (k === i ? [px, py] : p)),
      };
    }
    case 'rect': {
      const x1 = shape.x + shape.width,
        y1 = shape.y + shape.height;
      // The opposite corner stays put.
      const fx = id.endsWith('w') ? x1 : shape.x,
        fy = id.startsWith('n') ? y1 : shape.y;
      const width = Math.max(1, Math.abs(px - fx)),
        height = Math.max(1, Math.abs(py - fy));
      return {
        ...shape,
        x: round(Math.min(px, fx)),
        y: round(Math.min(py, fy)),
        width: round(width),
        height: round(height),
      };
    }
    case 'ellipse':
      return id === 'rx'
        ? { ...shape, rx: round(Math.max(1, Math.abs(px - shape.cx))) }
        : { ...shape, ry: round(Math.max(1, Math.abs(py - shape.cy))) };
    case 'arc': {
      if (id === 'center') return { ...shape, cx: px, cy: py };
      const c = { x: shape.cx, y: shape.cy };
      const r = round(Math.max(1, Math.hypot(px - c.x, py - c.y)));
      return { ...shape, r, [id]: angleOf(c, { x: px, y: py }) };
    }
    default:
      return shape;
  }
}

export const isClosed = (s: GlyphShape) =>
  s.type === 'polygon' ||
  s.type === 'rect' ||
  s.type === 'ellipse' ||
  s.type === 'path';

export function setFill(
  edit: SymbolEdit,
  indices: Iterable<number>,
  fill: boolean,
): SymbolEdit {
  return mapShapes(edit, indices, (s) => {
    if (!isClosed(s)) return s;
    const { fill: _f, ...bare } = s as GlyphShape & { fill?: boolean };
    return (fill ? { ...bare, fill: true } : bare) as GlyphShape;
  });
}

// ── Anchors (where a port's lead meets the drawing) ───────────────────────────

/** Where a new lead meets the drawing: the design-box edge facing the port, on its line. */
export function defaultAnchor(edit: SymbolEdit, port: Port) {
  const o = designOrigin(edit);
  const p = portBodyPoint(edit, port);
  const { width: w, height: h } = edit.glyph;
  const clamp = (v: number, hi: number) => round(Math.min(hi, Math.max(0, v)));
  switch (portSide(port)) {
    case 'left':
      return { x: 0, y: clamp(p.y - o.y, h) };
    case 'right':
      return { x: w, y: clamp(p.y - o.y, h) };
    case 'top':
      return { x: clamp(p.x - o.x, w), y: 0 };
    case 'bottom':
      return { x: clamp(p.x - o.x, w), y: h };
  }
}

export function setAnchor(
  edit: SymbolEdit,
  portId: string,
  at: { x: number; y: number },
): SymbolEdit {
  return withGlyph(edit, {
    ...edit.glyph,
    anchors: {
      ...edit.glyph.anchors,
      [portId]: { x: round(at.x), y: round(at.y) },
    },
  });
}

export function clearAnchor(edit: SymbolEdit, portId: string): SymbolEdit {
  if (!(portId in edit.glyph.anchors)) return edit;
  const { [portId]: _drop, ...anchors } = edit.glyph.anchors;
  return withGlyph(edit, { ...edit.glyph, anchors });
}

/** The Lead toggle: add a lead at the default anchor, or remove it. */
export function toggleLead(edit: SymbolEdit, portId: string): SymbolEdit {
  const port = edit.definition.ports.find((p) => p.id === portId);
  if (!port) return edit;
  return portId in edit.glyph.anchors
    ? clearAnchor(edit, portId)
    : setAnchor(edit, portId, defaultAnchor(edit, port));
}

// ── Ports ─────────────────────────────────────────────────────────────────────

const setPorts = (edit: SymbolEdit, ports: Port[]): SymbolEdit => ({
  ...edit,
  definition: { ...edit.definition, ports },
});

/** A side's grid slots: whole grid steps, at least one step in from each corner. */
function slots(length: number) {
  const out: number[] = [];
  for (let u = GRID; u <= length - GRID; u += GRID) out.push(u);
  return out.length ? out : [length / 2];
}

/**
 * Put a port on `side` at `along` body units from the side's start, snapped to the
 * grid and moved to the nearest free step. Ports already on that side keep their
 * places (they are pinned to explicit offsets so a new neighbour does not shuffle
 * them); the side the port left re-spreads its automatic ports. A lead that ran
 * straight into the design-box edge stays straight.
 */
export function placePort(
  edit: SymbolEdit,
  portId: string,
  side: Side,
  along?: number,
): SymbolEdit {
  const port = edit.definition.ports.find((p) => p.id === portId);
  if (!port) return edit;
  const from = portSide(port);
  const len = sideLengthOf(side, edit.size);
  const before = portBodyPoint(edit, port);
  const taken = edit.definition.ports
    .filter((p) => p.id !== portId && portSide(p) === side)
    .map((p) => portAlong(edit, p));
  const want = along ?? len / 2;
  const free = slots(len).filter((u) => !taken.includes(u));
  const target = (free.length ? free : slots(len)).reduce((best, u) =>
    Math.abs(u - want) < Math.abs(best - want) ? u : best,
  );
  const pinned = new Set(
    edit.definition.ports
      .filter((p) => p.id !== portId && portSide(p) === side)
      .map((p) => p.id),
  );
  const ports = edit.definition.ports.map((p) => {
    if (p.id === portId)
      return { ...p, side, offset: round((target / len) * 100) };
    if (pinned.has(p.id) && typeof p.offset !== 'number')
      return { ...p, offset: round((portAlong(edit, p) / len) * 100) };
    return p;
  });
  let next = setPorts(edit, ports);
  // An anchor on the facing edge, in line with the port, follows it along that edge.
  const anchor = edit.glyph.anchors[portId];
  if (anchor && from === side) {
    const o = designOrigin(edit);
    const straight = sideIsVertical(side)
      ? Math.abs(anchor.y + o.y - before.y) < 1e-6 &&
        anchor.x === (side === 'left' ? 0 : edit.glyph.width)
      : Math.abs(anchor.x + o.x - before.x) < 1e-6 &&
        anchor.y === (side === 'top' ? 0 : edit.glyph.height);
    if (straight) {
      const moved = next.definition.ports.find((p) => p.id === portId)!;
      next = {
        ...next,
        glyph: {
          ...next.glyph,
          anchors: {
            ...next.glyph.anchors,
            [portId]: defaultAnchor(next, moved),
          },
        },
      };
    }
  }
  return next;
}

/**
 * The side select: move a port to `side`. When every port there is placed
 * automatically, the port joins that spread; otherwise it takes the free step nearest
 * the side's middle.
 */
export function setPortSide(
  edit: SymbolEdit,
  portId: string,
  side: Side,
): SymbolEdit {
  const port = edit.definition.ports.find((p) => p.id === portId);
  if (!port || portSide(port) === side) return edit;
  const peers = edit.definition.ports.filter(
    (p) => p.id !== portId && portSide(p) === side,
  );
  if (peers.every((p) => typeof p.offset !== 'number')) {
    const { offset: _o, ...bare } = port;
    return setPorts(
      edit,
      edit.definition.ports.map((p) =>
        p.id === portId ? { ...bare, side } : p,
      ),
    );
  }
  return placePort(edit, portId, side);
}

// ── Body ──────────────────────────────────────────────────────────────────────

const clampSide = (v: number) =>
  Math.min(
    GLYPH_LIMITS.size,
    Math.max(SIZE_STEP, Math.round(v / SIZE_STEP) * SIZE_STEP),
  );
export const clampBody = (s: Size): Size => ({
  width: clampSide(s.width),
  height: clampSide(s.height),
});

/** A new body size (size steps, within limits); explicit port offsets move to the new grid. */
export function setBodySize(edit: SymbolEdit, size: Size): SymbolEdit {
  const next = clampBody(size);
  if (next.width === edit.size.width && next.height === edit.size.height)
    return edit;
  const ports = edit.definition.ports.map((p) => {
    if (typeof p.offset !== 'number') return p;
    const len = sideLengthOf(portSide(p), next);
    const units = Math.min(
      len - GRID,
      Math.max(GRID, snapOffset(p.offset / 100, len)),
    );
    return { ...p, offset: round((units / len) * 100) };
  });
  return {
    ...edit,
    size: next,
    definition: { ...edit.definition, ports },
    glyph: { ...edit.glyph, body: next },
  };
}

export function setOutline(edit: SymbolEdit, outline: boolean): SymbolEdit {
  return withGlyph(edit, { ...edit.glyph, outline });
}

export function setCaptions(edit: SymbolEdit, captions: boolean): SymbolEdit {
  return withGlyph(edit, { ...edit.glyph, captions });
}

/** Whether terminal names show (glyph.captions, defaulting to the outline). */
export const captionsShown = (glyph: SymbolGlyph) =>
  glyph.captions ?? !!glyph.outline;

/**
 * Fit the design box to the drawing and anchors. The box stays centered in the body
 * and nothing moves on the block: it grows or shrinks symmetrically about the body's
 * middle, so leads keep their lengths and stay straight.
 */
export function fitDesignBox(edit: SymbolEdit): SymbolEdit {
  const o = designOrigin(edit);
  const xs: number[] = [],
    ys: number[] = [];
  for (const s of edit.glyph.shapes) {
    const b = shapeBounds(s);
    xs.push(b.x + o.x, b.x + b.width + o.x);
    ys.push(b.y + o.y, b.y + b.height + o.y);
  }
  for (const a of Object.values(edit.glyph.anchors)) {
    xs.push(a.x + o.x);
    ys.push(a.y + o.y);
  }
  if (!xs.length) return edit;
  const cx = edit.size.width / 2,
    cy = edit.size.height / 2;
  const half = (vs: number[], c: number) =>
    Math.max(...vs.map((v) => Math.abs(v - c)));
  const width = Math.min(
    GLYPH_LIMITS.size,
    Math.max(8, round(Math.ceil(half(xs, cx) * 2))),
  );
  const height = Math.min(
    GLYPH_LIMITS.size,
    Math.max(8, round(Math.ceil(half(ys, cy) * 2))),
  );
  const dx = round((edit.glyph.width - width) / 2),
    dy = round((edit.glyph.height - height) / 2);
  // The origin moves by (dx, dy); shapes move back by as much, so the block is unchanged.
  const shapes = edit.glyph.shapes.map((s) => moveShape(s, -dx, -dy));
  const anchors = Object.fromEntries(
    Object.entries(edit.glyph.anchors).map(([id, a]) => [
      id,
      { x: round(a.x - dx), y: round(a.y - dy) },
    ]),
  );
  return withGlyph(edit, { ...edit.glyph, width, height, shapes, anchors });
}

// ── Direction notes ───────────────────────────────────────────────────────────

/**
 * Signal inputs on the right and outputs on the left are allowed, with a quiet note:
 * a block on a feedback path reads better flipped. Physical terminals go anywhere.
 */
export function directionNotes(
  definition: Definition,
): { port: string; note: string }[] {
  return definition.ports.flatMap((p) => {
    if (p.direction === 'physical') return [];
    const side = portSide(p);
    if (p.direction === 'input' && side === 'right')
      return [
        {
          port: p.id,
          note: `${p.name} is an input on the right. For a feedback path, Flip the block instead (⌘/Ctrl+I).`,
        },
      ];
    if (p.direction === 'output' && side === 'left')
      return [
        {
          port: p.id,
          note: `${p.name} is an output on the left. For a feedback path, Flip the block instead (⌘/Ctrl+I).`,
        },
      ];
    return [];
  });
}

// ── History ───────────────────────────────────────────────────────────────────

export type History<T> = { past: T[]; present: T; future: T[] };
const LIMIT = 200;

export const history = {
  start<T>(present: T): History<T> {
    return { past: [], present, future: [] };
  },
  /** A completed change: one undo step. */
  push<T>(h: History<T>, next: T): History<T> {
    if (next === h.present) return h;
    return {
      past: [...h.past, h.present].slice(-LIMIT),
      present: next,
      future: [],
    };
  },
  /** A gesture in progress: shown, not yet an undo step. */
  preview<T>(h: History<T>, next: T): History<T> {
    return { ...h, present: next };
  },
  /** End a gesture that began at `base`: one undo step back to it (none if unchanged). */
  settle<T>(h: History<T>, base: T): History<T> {
    if (h.present === base) return h;
    return {
      past: [...h.past, base].slice(-LIMIT),
      present: h.present,
      future: [],
    };
  },
  undo<T>(h: History<T>): History<T> {
    if (!h.past.length) return h;
    return {
      past: h.past.slice(0, -1),
      present: h.past[h.past.length - 1],
      future: [h.present, ...h.future],
    };
  },
  redo<T>(h: History<T>): History<T> {
    if (!h.future.length) return h;
    return {
      past: [...h.past, h.present],
      present: h.future[0],
      future: h.future.slice(1),
    };
  },
};
