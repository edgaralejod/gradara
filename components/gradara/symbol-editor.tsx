'use client';
import {
  useCallback,
  useEffect,
  useId,
  useMemo,
  useRef,
  useState,
  type CSSProperties,
  type KeyboardEvent as ReactKeyboardEvent,
  type PointerEvent as ReactPointerEvent,
  type ReactNode,
} from 'react';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogTitle,
} from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { BlockFace } from './block-face';
import type { SymbolEditorProps } from './symbol-editor-types';
import {
  domainColors,
  domainLabels,
  type Definition,
  type Port,
} from '@/lib/gradara/model';
import {
  shapePath,
  type GlyphPoint,
  type GlyphShape,
} from '@/lib/gradara/glyph';
import { GRID } from '@/lib/gradara/grid';
import { circuitGlyphs } from '@/lib/gradara/circuit-symbols';
import {
  blockShape,
  defaultBlockSize,
  showPortLabel,
} from '@/lib/gradara/block-design';
import { portPlacement, portSide, type Side } from '@/lib/gradara/ports';
import {
  addShape,
  angleOf,
  buildResult,
  captionsShown,
  deleteShapes,
  designOrigin,
  directionNotes,
  dragHandle,
  duplicateShapes,
  editProblem,
  fitDesignBox,
  history,
  isClosed,
  moveShapes,
  placePort,
  portBodyPoint,
  reorderShapes,
  replaceDrawing,
  resetToStandard,
  setAnchor,
  setBodySize,
  setCaptions,
  setFill,
  setOutline,
  setPortSide,
  shapeBounds,
  shapeHandles,
  sheetSize,
  snapDesignPoint,
  snapTo,
  SNAP_STEPS,
  startEdit,
  toggleLead,
  updateShape,
  type History,
  type SnapStep,
  type SymbolEdit,
} from '@/lib/gradara/symbol-edit';

type Tool =
  | 'select'
  | 'line'
  | 'polyline'
  | 'rect'
  | 'ellipse'
  | 'arc'
  | 'text';
type Pt = { x: number; y: number };

/** Room around the body on the stage, in diagram units: terminals and dimensions. */
const MARGIN = 32;

const TOOLS: { id: Tool; key: string; label: string; hint: string }[] = [
  {
    id: 'select',
    key: 'V',
    label: 'Select',
    hint: 'Click or box-select shapes; Shift adds. Drag a terminal along its side or onto another.',
  },
  { id: 'line', key: 'L', label: 'Line', hint: 'Drag, or click the two ends.' },
  {
    id: 'polyline',
    key: 'P',
    label: 'Polyline',
    hint: 'Click each point. Enter or double-click finishes; click the first point to close it.',
  },
  {
    id: 'rect',
    key: 'R',
    label: 'Rectangle',
    hint: 'Drag from one corner to the other.',
  },
  {
    id: 'ellipse',
    key: 'E',
    label: 'Ellipse',
    hint: 'Drag the box it fits in.',
  },
  {
    id: 'arc',
    key: 'A',
    label: 'Arc',
    hint: 'Click the center, then where it starts, then where it ends (clockwise).',
  },
  {
    id: 'text',
    key: 'T',
    label: 'Text',
    hint: 'Click where the label goes, type it, and press Enter.',
  },
];

const SIDES: Side[] = ['left', 'right', 'top', 'bottom'];
const sideLabel: Record<Side, string> = {
  left: 'Left',
  right: 'Right',
  top: 'Top',
  bottom: 'Bottom',
};

function ToolIcon({ tool }: { tool: Tool }) {
  const common = {
    width: 16,
    height: 16,
    viewBox: '0 0 16 16',
    fill: 'none',
    stroke: 'currentColor',
    strokeWidth: 1.4,
    strokeLinecap: 'round' as const,
    strokeLinejoin: 'round' as const,
    'aria-hidden': true,
  };
  switch (tool) {
    case 'select':
      return (
        <svg {...common}>
          <path d="M4 2.5V12.5L6.8 9.9L8.7 13.8L10.3 13L8.4 9.2H12.2Z" />
        </svg>
      );
    case 'line':
      return (
        <svg {...common}>
          <path d="M3 13L13 3" />
          <rect
            x="1.8"
            y="11.8"
            width="2.4"
            height="2.4"
            fill="currentColor"
            stroke="none"
          />
          <rect
            x="11.8"
            y="1.8"
            width="2.4"
            height="2.4"
            fill="currentColor"
            stroke="none"
          />
        </svg>
      );
    case 'polyline':
      return (
        <svg {...common}>
          <path d="M2.5 12.5L6 4.5L10 10.5L13.5 3.5" />
        </svg>
      );
    case 'rect':
      return (
        <svg {...common}>
          <rect x="2.5" y="4" width="11" height="8" />
        </svg>
      );
    case 'ellipse':
      return (
        <svg {...common}>
          <ellipse cx="8" cy="8" rx="5.5" ry="4.5" />
        </svg>
      );
    case 'arc':
      return (
        <svg {...common}>
          <path d="M2.5 11.5A5.5 5.5 0 0 1 13.5 11.5" />
          <path d="M8 11.5V11.5" strokeWidth="2" />
        </svg>
      );
    case 'text':
      return (
        <svg {...common}>
          <path d="M3.5 4H12.5M8 4V13M6 13H10" />
        </svg>
      );
  }
}

/** A number field that commits on Enter or blur, so a typed value is one undo step. */
function NumberField({
  label,
  value,
  onCommit,
  step = 1,
  min,
  max,
}: {
  label: string;
  value: number;
  onCommit: (v: number) => void;
  step?: number;
  min?: number;
  max?: number;
}) {
  const [text, setText] = useState(String(value));
  const [focused, setFocused] = useState(false);
  const shown = focused ? text : String(Math.round(value * 100) / 100);
  const commit = () => {
    const v = Number(text);
    if (text.trim() !== '' && Number.isFinite(v) && v !== value) onCommit(v);
    else setText(String(value));
  };
  return (
    <label className="se-field">
      <span>{label}</span>
      <input
        type="number"
        inputMode="decimal"
        step={step}
        min={min}
        max={max}
        value={shown}
        onFocus={() => {
          setText(String(Math.round(value * 100) / 100));
          setFocused(true);
        }}
        onChange={(e) => setText(e.target.value)}
        onBlur={() => {
          setFocused(false);
          commit();
        }}
        onKeyDown={(e) => {
          if (e.key === 'Enter') commit();
        }}
      />
    </label>
  );
}

function Stepper({
  label,
  value,
  min,
  max,
  onChange,
}: {
  label: string;
  value: number;
  min: number;
  max: number;
  onChange: (v: number) => void;
}) {
  return (
    <div className="se-stepper">
      <span className="se-stepper-label">{label}</span>
      <button
        type="button"
        aria-label={`Decrease ${label.toLowerCase()}`}
        disabled={value <= min}
        onClick={() => onChange(value - 16)}
      >
        −
      </button>
      <output aria-live="polite">{value}</output>
      <button
        type="button"
        aria-label={`Increase ${label.toLowerCase()}`}
        disabled={value >= max}
        onClick={() => onChange(value + 16)}
      >
        +
      </button>
    </div>
  );
}

function Toggle({
  label,
  checked,
  onChange,
  disabled,
}: {
  label: string;
  checked: boolean;
  onChange: (v: boolean) => void;
  disabled?: boolean;
}) {
  return (
    <label className="se-check">
      <input
        type="checkbox"
        checked={checked}
        disabled={disabled}
        onChange={(e) => onChange(e.target.checked)}
      />
      <span>{label}</span>
    </label>
  );
}

/** The block as it sits on the sheet at 100%: its face and terminals. */
function SheetPreview({
  definition,
  size,
  rotation = 0,
  flip = false,
  label,
}: {
  definition: Definition;
  size: { width: number; height: number };
  rotation?: number;
  flip?: boolean;
  label: string;
}) {
  const sheet =
    rotation % 180 ? { width: size.height, height: size.width } : size;
  return (
    <figure className="se-preview">
      <div className="se-preview-well">
        <span
          className="se-preview-body"
          style={
            {
              ...sheet,
              '--domain': domainColors[definition.domain],
            } as CSSProperties
          }
        >
          <BlockFace
            definition={definition}
            size={size}
            rotation={rotation}
            flip={flip}
          />
          {definition.ports.map((p) => {
            const { side, offset } = portPlacement(
              definition,
              p,
              rotation,
              sheet,
              flip,
            );
            return (
              <span
                key={p.id}
                className={`preview-terminal terminal-${side} ${p.direction === 'physical' ? 'is-physical' : ''}`}
                style={
                  {
                    [side === 'left' || side === 'right' ? 'top' : 'left']:
                      `${offset}%`,
                    '--port-color': domainColors[p.domain],
                  } as CSSProperties
                }
              />
            );
          })}
        </span>
      </div>
      <figcaption>{label}</figcaption>
    </figure>
  );
}

type Gesture =
  | { kind: 'move'; base: SymbolEdit; start: Pt; indices: number[] }
  | { kind: 'handle'; base: SymbolEdit; index: number; handle: string }
  | { kind: 'terminal'; base: SymbolEdit; port: string }
  | { kind: 'anchor'; base: SymbolEdit; port: string }
  | { kind: 'marquee'; start: Pt; additive: boolean; before: number[] }
  | { kind: 'drag-draw'; start: Pt }
  | { kind: 'text'; at: Pt };

/** A shape being drawn: the points clicked so far and where the pointer is. */
type Draft = { tool: Tool; points: Pt[]; cursor: Pt };

function draftShape(d: Draft, fill: boolean): GlyphShape | null {
  const pts = d.points.map((p): GlyphPoint => [p.x, p.y]);
  const cur: GlyphPoint = [d.cursor.x, d.cursor.y];
  const a = d.points[0];
  if (!a) return null;
  switch (d.tool) {
    case 'line':
      return { type: 'line', points: [pts[0], cur] };
    case 'polyline':
      return { type: 'line', points: [...pts, cur] };
    case 'rect': {
      const x = Math.min(a.x, d.cursor.x),
        y = Math.min(a.y, d.cursor.y);
      return {
        type: 'rect',
        x,
        y,
        width: Math.abs(d.cursor.x - a.x),
        height: Math.abs(d.cursor.y - a.y),
        ...(fill ? { fill } : {}),
      };
    }
    case 'ellipse':
      return {
        type: 'ellipse',
        cx: (a.x + d.cursor.x) / 2,
        cy: (a.y + d.cursor.y) / 2,
        rx: Math.abs(d.cursor.x - a.x) / 2,
        ry: Math.abs(d.cursor.y - a.y) / 2,
        ...(fill ? { fill } : {}),
      };
    case 'arc': {
      if (d.points.length === 1) return { type: 'line', points: [pts[0], cur] };
      const b = d.points[1];
      const r = Math.round(Math.hypot(b.x - a.x, b.y - a.y) * 100) / 100;
      return {
        type: 'arc',
        cx: a.x,
        cy: a.y,
        r,
        start: angleOf(a, b),
        end: angleOf(a, d.cursor),
      };
    }
    default:
      return null;
  }
}

const isTyping = (t: EventTarget | null) =>
  t instanceof HTMLElement &&
  (t.isContentEditable || ['INPUT', 'TEXTAREA', 'SELECT'].includes(t.tagName));

const shapeName: Record<GlyphShape['type'], string> = {
  line: 'Line',
  polygon: 'Polygon',
  rect: 'Rectangle',
  ellipse: 'Ellipse',
  path: 'Path',
  arc: 'Arc',
  text: 'Label',
};

export function SymbolEditor({
  block,
  standard,
  onApply,
  onSaveToLibrary,
  onAskAi,
  aiPrice,
  onClose,
}: SymbolEditorProps) {
  const [h, setH] = useState<History<SymbolEdit>>(() =>
    history.start(startEdit(block)),
  );
  const hRef = useRef(h);
  const update = useCallback(
    (f: (h: History<SymbolEdit>) => History<SymbolEdit>) => {
      hRef.current = f(hRef.current);
      setH(hRef.current);
    },
    [],
  );
  const commit = useCallback(
    (f: (e: SymbolEdit) => SymbolEdit) =>
      update((x) => history.push(x, f(x.present))),
    [update],
  );
  const edit = h.present;
  const [tool, setTool] = useState<Tool>('select');
  const [snap, setSnap] = useState<SnapStep>(4);
  const [fillNew, setFillNew] = useState(false);
  const [rawSelection, setSelection] = useState<number[]>([]);
  const [draft, setDraft] = useState<Draft | null>(null);
  const [marquee, setMarquee] = useState<{ a: Pt; b: Pt } | null>(null);
  const [textEntry, setTextEntryState] = useState<{
    at: Pt;
    value: string;
  } | null>(null);
  // Mirrored in a ref: the field's blur after Escape or Enter must not add it again.
  const textRef = useRef(textEntry);
  const setTextEntry = (v: { at: Pt; value: string } | null) => {
    textRef.current = v;
    setTextEntryState(v);
  };
  const [hoverPort, setHoverPort] = useState<string | null>(null);
  const gesture = useRef<Gesture | null>(null);
  const svgRef = useRef<SVGSVGElement>(null);
  // A callback ref: the dialog mounts its content after the first render.
  const [stage, setStage] = useState<HTMLDivElement | null>(null);
  const [scale, setScale] = useState(4);
  const ids = useId();

  // AI drawing
  const [aiText, setAiText] = useState('');
  const [ai, setAi] = useState<{
    state: 'idle' | 'running' | 'done' | 'error';
    message?: string;
  }>({ state: 'idle' });
  const [save, setSave] = useState<{
    state: 'idle' | 'saving' | 'saved' | 'error';
    message?: string;
  }>({ state: 'idle' });
  const alive = useRef(true);
  useEffect(() => {
    alive.current = true;
    return () => {
      alive.current = false;
    };
  }, []);

  const result = useMemo(() => buildResult(edit), [edit]);
  const problem = editProblem(edit);
  const dirty = h.past.length > 0;
  const { width: W, height: H } = edit.size;
  const origin = designOrigin(edit);
  const glyph = edit.glyph;
  // A built-in schematic symbol is its own starting drawing, so it can be edited at once;
  // otherwise the standard look shows until something is drawn.
  const drawingShown = !edit.standard || !!circuitGlyphs[edit.definition.kind];
  const shapes = drawingShown ? glyph.shapes : [];
  const notes = directionNotes(edit.definition);
  // Reset to standard has nothing to do when the block already looks standard.
  const atStandard =
    !!standard &&
    !!edit.standard &&
    edit.definition.ports.every((p) => {
      const s = standard.ports.find((q) => q.id === p.id);
      return !s || (p.side === s.side && p.offset === s.offset);
    }) &&
    edit.size.width === defaultBlockSize(standard).width &&
    edit.size.height === defaultBlockSize(standard).height;
  const px = 1 / scale; // one screen pixel, in diagram units

  // Fit the body (and its margin) to the stage.
  useEffect(() => {
    if (!stage) return;
    // Client sizes ignore the dialog's opening transform. The observer reports at once.
    const ro = new ResizeObserver(() => {
      const k = Math.min(
        (stage.clientWidth - 24) / (W + 2 * MARGIN),
        (stage.clientHeight - 24) / (H + 2 * MARGIN),
      );
      setScale(Math.max(1, Math.min(6, Math.floor(k * 4) / 4)));
    });
    ro.observe(stage);
    return () => ro.disconnect();
  }, [stage, W, H]);

  // The selection stays valid after undo, reset, or an AI drawing.
  const selection = rawSelection.filter((i) => i < shapes.length);

  const toBody = (e: { clientX: number; clientY: number }): Pt => {
    const r = svgRef.current!.getBoundingClientRect();
    return {
      x: (e.clientX - r.left) / scale - MARGIN,
      y: (e.clientY - r.top) / scale - MARGIN,
    };
  };
  const toDesign = (p: Pt): Pt => ({ x: p.x - origin.x, y: p.y - origin.y });
  const snapped = (p: Pt): Pt => {
    const [x, y] = snapDesignPoint(edit, toDesign(p), snap);
    return { x, y };
  };

  const cancelGesture = () => {
    const g = gesture.current;
    if (g && 'base' in g) update((x) => history.preview(x, g.base));
    if (g?.kind === 'marquee') setSelection(g.before);
    gesture.current = null;
    setMarquee(null);
    if (draft) {
      setDraft(null);
      return true;
    }
    if (textRef.current) {
      setTextEntry(null);
      return true;
    }
    return !!g;
  };

  /** Escape: cancel the gesture, then the selection, then the tool; otherwise close. */
  const consumeEscape = () => {
    if (cancelGesture()) return true;
    if (selection.length) {
      setSelection([]);
      return true;
    }
    if (tool !== 'select') {
      setTool('select');
      return true;
    }
    return false;
  };

  const finishDraft = (d: Draft | null, closed = false) => {
    if (!d) return;
    setDraft(null);
    let shape: GlyphShape | null = null;
    if (d.tool === 'polyline') {
      const pts = d.points.filter(
        (p, i) =>
          i === 0 || p.x !== d.points[i - 1].x || p.y !== d.points[i - 1].y,
      );
      if (pts.length < 2) return;
      const points = pts.map((p): GlyphPoint => [p.x, p.y]);
      shape =
        closed && pts.length >= 3
          ? { type: 'polygon', points, ...(fillNew ? { fill: true } : {}) }
          : { type: 'line', points };
    } else shape = draftShape(d, fillNew);
    if (!shape) return;
    if (
      shape.type === 'line' &&
      shape.points.every(
        (p) => p[0] === shape.points[0][0] && p[1] === shape.points[0][1],
      )
    )
      return;
    if (
      (shape.type === 'rect' && (!shape.width || !shape.height)) ||
      (shape.type === 'ellipse' && (!shape.rx || !shape.ry)) ||
      (shape.type === 'arc' && (!shape.r || shape.start === shape.end))
    )
      return;
    const index = edit.glyph.shapes.length;
    commit((e) => addShape(e, shape));
    setSelection([index]);
  };

  const onPointerDown = (e: ReactPointerEvent<HTMLDivElement>) => {
    if (e.button !== 0 || textEntry) return;
    // Keys act on the stage after a click on it, not on the field focused before.
    const popup = e.currentTarget.closest<HTMLElement>(
      '[data-slot="dialog-content"]',
    );
    if (isTyping(document.activeElement)) popup?.focus({ preventScroll: true });
    const target = e.target as Element;
    const at = toBody(e);
    const p = snapped(at);
    const portEl = target.closest('[data-terminal]');
    const anchorEl = target.closest('[data-anchor]');
    const handleEl = target.closest('[data-handle]');
    const shapeEl = target.closest('[data-shape]');
    e.currentTarget.setPointerCapture(e.pointerId);
    if (portEl) {
      gesture.current = {
        kind: 'terminal',
        base: edit,
        port: portEl.getAttribute('data-terminal')!,
      };
      return;
    }
    if (anchorEl) {
      gesture.current = {
        kind: 'anchor',
        base: edit,
        port: anchorEl.getAttribute('data-anchor')!,
      };
      return;
    }
    if (tool === 'select') {
      if (handleEl) {
        gesture.current = {
          kind: 'handle',
          base: edit,
          index: Number(handleEl.getAttribute('data-index')),
          handle: handleEl.getAttribute('data-handle')!,
        };
        return;
      }
      if (shapeEl) {
        const index = Number(shapeEl.getAttribute('data-shape'));
        let next = selection;
        if (e.shiftKey) {
          next = selection.includes(index)
            ? selection.filter((i) => i !== index)
            : [...selection, index];
          setSelection(next);
          if (!next.includes(index)) return;
        } else if (!selection.includes(index)) {
          next = [index];
          setSelection(next);
        }
        gesture.current = {
          kind: 'move',
          base: edit,
          start: at,
          indices: next,
        };
        return;
      }
      gesture.current = {
        kind: 'marquee',
        start: at,
        additive: e.shiftKey,
        before: selection,
      };
      if (!e.shiftKey) setSelection([]);
      return;
    }
    if (tool === 'text') {
      // The field opens on release, after the press has settled focus.
      gesture.current = { kind: 'text', at: p };
      return;
    }
    if (tool === 'polyline') {
      if (!draft) setDraft({ tool, points: [p], cursor: p });
      else {
        const first = draft.points[0];
        const near = Math.hypot(p.x - first.x, p.y - first.y) <= 6 * px;
        if (near && draft.points.length >= 3) finishDraft(draft, true);
        else setDraft({ ...draft, points: [...draft.points, p], cursor: p });
      }
      return;
    }
    if (tool === 'arc') {
      if (!draft) setDraft({ tool, points: [p], cursor: p });
      else if (draft.points.length === 1)
        setDraft({ ...draft, points: [...draft.points, p], cursor: p });
      else finishDraft({ ...draft, cursor: p });
      return;
    }
    // Line (drag or two clicks), rectangle, ellipse.
    if (draft && draft.tool === 'line') {
      finishDraft({ ...draft, cursor: p });
      return;
    }
    setDraft({ tool, points: [p], cursor: p });
    gesture.current = { kind: 'drag-draw', start: p };
  };

  const onPointerMove = (e: ReactPointerEvent<HTMLDivElement>) => {
    const at = toBody(e);
    const g = gesture.current;
    if (!g) {
      if (draft) setDraft({ ...draft, cursor: snapped(at) });
      return;
    }
    switch (g.kind) {
      case 'terminal': {
        // The nearest side, and the place along it.
        const d = {
          left: Math.abs(at.x),
          right: Math.abs(at.x - W),
          top: Math.abs(at.y),
          bottom: Math.abs(at.y - H),
        };
        const side = (Object.keys(d) as Side[]).reduce((a, b) =>
          d[b] < d[a] ? b : a,
        );
        const along = side === 'left' || side === 'right' ? at.y : at.x;
        update((x) =>
          history.preview(x, placePort(g.base, g.port, side, along)),
        );
        break;
      }
      case 'anchor': {
        const [x, y] = snapDesignPoint(g.base, toDesign(at), snap);
        update((h) => history.preview(h, setAnchor(g.base, g.port, { x, y })));
        break;
      }
      case 'handle': {
        const shape = g.base.glyph.shapes[g.index];
        if (!shape) break;
        const p = snapDesignPoint(g.base, toDesign(at), snap);
        update((h) =>
          history.preview(
            h,
            updateShape(g.base, g.index, dragHandle(shape, g.handle, p)),
          ),
        );
        break;
      }
      case 'move': {
        const dx = snapTo(at.x - g.start.x, snap),
          dy = snapTo(at.y - g.start.y, snap);
        update((h) =>
          history.preview(h, moveShapes(g.base, g.indices, dx, dy)),
        );
        break;
      }
      case 'marquee': {
        setMarquee({ a: g.start, b: at });
        const x0 = Math.min(g.start.x, at.x) - origin.x,
          x1 = Math.max(g.start.x, at.x) - origin.x,
          y0 = Math.min(g.start.y, at.y) - origin.y,
          y1 = Math.max(g.start.y, at.y) - origin.y;
        const inside = shapes.flatMap((s, i) => {
          const b = shapeBounds(s);
          return b.x >= x0 &&
            b.y >= y0 &&
            b.x + b.width <= x1 &&
            b.y + b.height <= y1
            ? [i]
            : [];
        });
        setSelection(
          g.additive ? [...new Set([...g.before, ...inside])] : inside,
        );
        break;
      }
      case 'drag-draw':
        if (draft) setDraft({ ...draft, cursor: snapped(at) });
        break;
    }
  };

  const onPointerUp = (e: ReactPointerEvent<HTMLDivElement>) => {
    const g = gesture.current;
    gesture.current = null;
    if (e.currentTarget.hasPointerCapture(e.pointerId))
      e.currentTarget.releasePointerCapture(e.pointerId);
    if (!g) return;
    if ('base' in g) {
      update((x) => history.settle(x, g.base));
      return;
    }
    if (g.kind === 'marquee') setMarquee(null);
    if (g.kind === 'text') setTextEntry({ at: g.at, value: '' });
    if (g.kind === 'drag-draw' && draft) {
      const end = snapped(toBody(e));
      const moved = end.x !== g.start.x || end.y !== g.start.y;
      // A line clicked without dragging waits for its second end.
      if (!moved && draft.tool === 'line') return;
      finishDraft({ ...draft, cursor: end });
    }
  };

  const onKeyDown = (e: ReactKeyboardEvent) => {
    if (isTyping(e.target)) return;
    const mod = e.metaKey || e.ctrlKey;
    const key = e.key.toLowerCase();
    if (mod && key === 'z') {
      e.preventDefault();
      cancelGesture();
      update((x) => (e.shiftKey ? history.redo(x) : history.undo(x)));
      return;
    }
    if (mod && key === 'y') {
      e.preventDefault();
      update((x) => history.redo(x));
      return;
    }
    if (mod && key === 'd' && selection.length) {
      e.preventDefault();
      duplicate();
      return;
    }
    if (mod && key === 'a') {
      e.preventDefault();
      setSelection(shapes.map((_, i) => i));
      return;
    }
    if (mod || e.altKey) return;
    if (e.key === 'Enter' && draft?.tool === 'polyline') {
      e.preventDefault();
      finishDraft({ ...draft, points: draft.points });
      return;
    }
    if ((e.key === 'Delete' || e.key === 'Backspace') && selection.length) {
      e.preventDefault();
      commit((x) => deleteShapes(x, selection));
      setSelection([]);
      return;
    }
    const arrows: Record<string, [number, number]> = {
      ArrowLeft: [-1, 0],
      ArrowRight: [1, 0],
      ArrowUp: [0, -1],
      ArrowDown: [0, 1],
    };
    if (arrows[e.key] && selection.length) {
      e.preventDefault();
      const step = e.shiftKey ? Math.max(GRID, snap * 4) : snap;
      const [dx, dy] = arrows[e.key];
      commit((x) => moveShapes(x, selection, dx * step, dy * step));
      return;
    }
    const t = TOOLS.find((t) => t.key.toLowerCase() === key);
    if (t && !e.shiftKey) {
      e.preventDefault();
      cancelGesture();
      setTool(t.id);
      if (t.id !== 'select') setSelection([]);
    }
  };

  const duplicate = () => {
    const { edit: next, indices } = duplicateShapes(
      hRef.current.present,
      selection,
      snap * 2,
    );
    commit(() => next);
    setSelection(indices);
  };
  const reorder = (to: 1 | -1 | 'front' | 'back') => {
    const { edit: next, indices } = reorderShapes(
      hRef.current.present,
      selection,
      to,
    );
    commit(() => next);
    setSelection(indices);
  };

  const commitText = () => {
    const entry = textRef.current;
    if (!entry) return;
    const text = entry.value.trim().slice(0, 24);
    const { at } = entry;
    setTextEntry(null);
    if (!text) return;
    const index = edit.glyph.shapes.length;
    commit((e) => addShape(e, { type: 'text', x: at.x, y: at.y, text }));
    setSelection([index]);
  };

  const askAi = async () => {
    if (!onAskAi || !aiText.trim() || ai.state === 'running') return;
    setAi({ state: 'running' });
    try {
      const drawing = await onAskAi(
        aiText.trim(),
        buildResult(hRef.current.present),
      );
      if (!alive.current) return;
      commit((e) => replaceDrawing(e, drawing));
      setSelection([]);
      setTool('select');
      setAi({
        state: 'done',
        message: 'Drawn. Undo brings back the previous drawing.',
      });
    } catch (err) {
      if (!alive.current) return;
      setAi({
        state: 'error',
        message: err instanceof Error ? err.message : String(err),
      });
    }
  };

  const saveToLibrary = async () => {
    if (!onSaveToLibrary || problem) return;
    setSave({ state: 'saving' });
    try {
      await onSaveToLibrary(result);
      if (alive.current)
        setSave({ state: 'saved', message: 'Saved to AI blocks.' });
    } catch (err) {
      if (alive.current)
        setSave({
          state: 'error',
          message: err instanceof Error ? err.message : String(err),
        });
    }
  };

  const apply = () => {
    if (problem) return;
    onApply(result, sheetSize(edit.size, block.rotation ?? 0));
  };

  // ── Stage drawing ───────────────────────────────────────────────────────────
  const vbW = W + 2 * MARGIN,
    vbH = H + 2 * MARGIN;
  const gridLines: ReactNode[] = [];
  for (let x = -MARGIN; x <= W + MARGIN; x += GRID)
    gridLines.push(
      <line key={`x${x}`} x1={x} y1={-MARGIN} x2={x} y2={H + MARGIN} />,
    );
  for (let y = -MARGIN; y <= H + MARGIN; y += GRID)
    gridLines.push(
      <line key={`y${y}`} x1={-MARGIN} y1={y} x2={W + MARGIN} y2={y} />,
    );
  // The finer snap grid, inside the design box, where it is wide enough to see.
  const snapDots: ReactNode[] = [];
  if (drawingShown && snap < GRID && snap * scale >= 6) {
    const x0 = Math.ceil(origin.x / snap) * snap,
      y0 = Math.ceil(origin.y / snap) * snap;
    let d = '';
    for (let x = x0; x <= origin.x + glyph.width + 1e-6; x += snap)
      for (let y = y0; y <= origin.y + glyph.height + 1e-6; y += snap)
        if (x % GRID || y % GRID) d += `M${x} ${y}h0`;
    snapDots.push(<path key="dots" d={d} />);
  }
  const selected = new Set(selection);
  const single = selection.length === 1 ? shapes[selection[0]] : undefined;
  const preview = draft ? draftShape(draft, fillNew) : null;
  const toolInfo = TOOLS.find((t) => t.id === tool)!;
  const stageHint = !drawingShown
    ? 'Standard look. Drawing anything starts a custom symbol from it.'
    : draft?.tool === 'polyline'
      ? 'Click the next point. Enter or double-click finishes; click the first point to close.'
      : draft?.tool === 'arc'
        ? draft.points.length === 1
          ? 'Click where the arc starts.'
          : 'Click where the arc ends.'
        : toolInfo.hint;

  const terminal = (p: Port) => {
    const at = portBodyPoint(edit, p);
    const color = domainColors[p.domain];
    const physical = p.direction === 'physical';
    const s = (physical ? 9 : 7) * px;
    const active = hoverPort === p.id;
    return (
      <g
        key={p.id}
        className="se-terminal"
        data-terminal={p.id}
        onPointerEnter={() => setHoverPort(p.id)}
        onPointerLeave={() => setHoverPort((x) => (x === p.id ? null : x))}
      >
        <title>{`${p.name} (${p.direction === 'physical' ? domainLabels[p.domain] + ' terminal' : domainLabels[p.domain] + ' ' + p.direction})`}</title>
        <circle cx={at.x} cy={at.y} r={10 * px} className="se-terminal-hit" />
        {physical ? (
          <rect
            x={at.x - s / 2}
            y={at.y - s / 2}
            width={s}
            height={s}
            rx={1.5 * px}
            style={{
              fill: color,
              stroke: 'white',
              strokeWidth: 1.5 * px,
              outline: 'none',
            }}
          />
        ) : (
          <circle
            cx={at.x}
            cy={at.y}
            r={s / 2}
            style={{ fill: color, stroke: 'white', strokeWidth: 1.5 * px }}
          />
        )}
        {physical && (
          <rect
            x={at.x - s / 2 - px}
            y={at.y - s / 2 - px}
            width={s + 2 * px}
            height={s + 2 * px}
            rx={2 * px}
            style={{ fill: 'none', stroke: color, strokeWidth: px }}
          />
        )}
        {active && (
          <circle
            cx={at.x}
            cy={at.y}
            r={8 * px}
            style={{
              fill: 'none',
              stroke: color,
              strokeWidth: px,
              opacity: 0.5,
            }}
          />
        )}
      </g>
    );
  };

  const dims = (
    <g className="se-dims" aria-hidden="true">
      <path d={`M0 ${-20}H${W}M0 ${-24}V${-16}M${W} ${-24}V${-16}`} />
      <path d={`M${-20} 0V${H}M${-24} 0H${-16}M${-24} ${H}H${-16}`} />
      <text
        x={W / 2}
        y={-20 - 4 * px}
        style={{ fontSize: 10 * px }}
        textAnchor="middle"
      >
        {W}
      </text>
      <text
        x={-20 - 4 * px}
        y={H / 2}
        style={{ fontSize: 10 * px }}
        textAnchor="middle"
        transform={`rotate(-90 ${-20 - 4 * px} ${H / 2})`}
      >
        {H}
      </text>
    </g>
  );

  const portsById = Object.fromEntries(
    edit.definition.ports.map((p) => [p.id, p]),
  );

  // ── Panel ───────────────────────────────────────────────────────────────────
  const selectionPanel = () => {
    if (!selection.length)
      return (
        <p className="se-empty">
          Nothing selected. Pick a shape on the stage, or draw one.
        </p>
      );
    const i = selection[0];
    const put = (shape: GlyphShape) => commit((e) => updateShape(e, i, shape));
    const b = single ? shapeBounds(single) : undefined;
    return (
      <>
        <p className="se-selection-name">
          {single ? shapeName[single.type] : `${selection.length} shapes`}
        </p>
        {single && b && (
          <div className="se-fields">
            {single.type === 'rect' ? (
              <>
                <NumberField
                  label="X"
                  value={single.x}
                  onCommit={(v) => put({ ...single, x: v })}
                />
                <NumberField
                  label="Y"
                  value={single.y}
                  onCommit={(v) => put({ ...single, y: v })}
                />
                <NumberField
                  label="W"
                  value={single.width}
                  min={1}
                  onCommit={(v) => v > 0 && put({ ...single, width: v })}
                />
                <NumberField
                  label="H"
                  value={single.height}
                  min={1}
                  onCommit={(v) => v > 0 && put({ ...single, height: v })}
                />
              </>
            ) : single.type === 'ellipse' ? (
              <>
                <NumberField
                  label="X"
                  value={single.cx}
                  onCommit={(v) => put({ ...single, cx: v })}
                />
                <NumberField
                  label="Y"
                  value={single.cy}
                  onCommit={(v) => put({ ...single, cy: v })}
                />
                <NumberField
                  label="Rx"
                  value={single.rx}
                  min={1}
                  onCommit={(v) => v > 0 && put({ ...single, rx: v })}
                />
                <NumberField
                  label="Ry"
                  value={single.ry}
                  min={1}
                  onCommit={(v) => v > 0 && put({ ...single, ry: v })}
                />
              </>
            ) : single.type === 'arc' ? (
              <>
                <NumberField
                  label="X"
                  value={single.cx}
                  onCommit={(v) => put({ ...single, cx: v })}
                />
                <NumberField
                  label="Y"
                  value={single.cy}
                  onCommit={(v) => put({ ...single, cy: v })}
                />
                <NumberField
                  label="R"
                  value={single.r}
                  min={1}
                  onCommit={(v) => v > 0 && put({ ...single, r: v })}
                />
                <NumberField
                  label="From °"
                  value={single.start}
                  onCommit={(v) => put({ ...single, start: v })}
                />
                <NumberField
                  label="To °"
                  value={single.end}
                  onCommit={(v) => put({ ...single, end: v })}
                />
              </>
            ) : single.type === 'text' ? (
              <>
                <NumberField
                  label="X"
                  value={single.x}
                  onCommit={(v) => put({ ...single, x: v })}
                />
                <NumberField
                  label="Y"
                  value={single.y}
                  onCommit={(v) => put({ ...single, y: v })}
                />
              </>
            ) : (
              <>
                <NumberField
                  label="X"
                  value={b.x}
                  onCommit={(v) =>
                    commit((e) => moveShapes(e, [i], v - b.x, 0))
                  }
                />
                <NumberField
                  label="Y"
                  value={b.y}
                  onCommit={(v) =>
                    commit((e) => moveShapes(e, [i], 0, v - b.y))
                  }
                />
                <p className="se-meta se-fields-wide">
                  {single.type === 'path'
                    ? `${Math.round(b.width)} × ${Math.round(b.height)}. A path moves as a whole.`
                    : `${Math.round(b.width)} × ${Math.round(b.height)}, ${'points' in single ? single.points.length : 0} points. Drag a point to move it.`}
                </p>
              </>
            )}
          </div>
        )}
        {single?.type === 'text' && (
          <div className="se-text-fields">
            <label className="se-field se-field-wide">
              <span>Text</span>
              <input
                type="text"
                maxLength={24}
                key={`${i}-${single.text}`}
                defaultValue={single.text}
                onBlur={(e) => {
                  const v = e.target.value.trim();
                  if (v && v !== single.text) put({ ...single, text: v });
                }}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') (e.target as HTMLInputElement).blur();
                }}
              />
            </label>
            <label className="se-field">
              <span>Size</span>
              <select
                value={single.size ?? 'normal'}
                onChange={(e) =>
                  put({ ...single, size: e.target.value as 'normal' | 'small' })
                }
              >
                <option value="normal">Normal</option>
                <option value="small">Small</option>
              </select>
            </label>
            <label className="se-field">
              <span>Align</span>
              <select
                value={single.anchor ?? 'middle'}
                onChange={(e) =>
                  put({
                    ...single,
                    anchor: e.target.value as 'start' | 'middle' | 'end',
                  })
                }
              >
                <option value="start">Start</option>
                <option value="middle">Middle</option>
                <option value="end">End</option>
              </select>
            </label>
          </div>
        )}
        {selection.some((k) => shapes[k] && isClosed(shapes[k])) && (
          <Toggle
            label="Filled"
            checked={selection.every(
              (k) =>
                !shapes[k] ||
                !isClosed(shapes[k]) ||
                !!(shapes[k] as { fill?: boolean }).fill,
            )}
            onChange={(v) => commit((e) => setFill(e, selection, v))}
          />
        )}
        <div className="se-row-actions">
          <button
            type="button"
            onClick={() => reorder(-1)}
            title="Send back one step"
          >
            Back
          </button>
          <button
            type="button"
            onClick={() => reorder(1)}
            title="Bring forward one step"
          >
            Forward
          </button>
          <button
            type="button"
            onClick={duplicate}
            title="Duplicate (⌘/Ctrl+D)"
          >
            Duplicate
          </button>
          <button
            type="button"
            onClick={() => {
              commit((e) => deleteShapes(e, selection));
              setSelection([]);
            }}
            title="Delete (Delete)"
          >
            Delete
          </button>
        </div>
      </>
    );
  };

  return (
    <Dialog
      open
      onOpenChange={(open, details) => {
        if (open) return;
        if (details?.reason === 'escape-key' && consumeEscape()) {
          details.cancel();
          return;
        }
        onClose();
      }}
    >
      <DialogContent
        className="symbol-editor"
        resizeKey="symbol-editor"
        onKeyDown={onKeyDown}
      >
        <header className="se-header">
          <DialogTitle>Symbol of {edit.definition.name}</DialogTitle>
          <DialogDescription>
            Arrange the terminals and draw the symbol. Apply changes this block
            as one undo step.
          </DialogDescription>
        </header>
        <div className="se-main">
          <div
            className="se-tools"
            role="toolbar"
            aria-label="Drawing tools"
            aria-orientation="vertical"
          >
            {TOOLS.map((t) => (
              <button
                key={t.id}
                type="button"
                className="se-tool"
                aria-pressed={tool === t.id}
                aria-label={`${t.label} (${t.key})`}
                title={`${t.label} (${t.key})`}
                onClick={() => {
                  cancelGesture();
                  setTool(t.id);
                }}
              >
                <ToolIcon tool={t.id} />
              </button>
            ))}
          </div>
          <div className="se-stage-column">
            <div className="se-stage-bar">
              <span className="se-hint" aria-live="polite">
                {stageHint}
              </span>
              <div className="se-stage-controls">
                <label className="se-check" title="Fill new closed shapes">
                  <input
                    type="checkbox"
                    checked={fillNew}
                    onChange={(e) => setFillNew(e.target.checked)}
                  />
                  <span>Fill</span>
                </label>
                <fieldset className="se-segmented">
                  <legend className="se-segmented-label">Snap</legend>
                  {SNAP_STEPS.map((s) => (
                    <label
                      key={s}
                      title={`Snap to ${s} unit${s > 1 ? 's' : ''}`}
                    >
                      <input
                        type="radio"
                        name={`${ids}-snap`}
                        value={s}
                        checked={snap === s}
                        onChange={() => setSnap(s)}
                      />
                      <span>{s}</span>
                    </label>
                  ))}
                </fieldset>
                <span className="se-zoom" title="Stage zoom">
                  {Math.round(scale * 100)}%
                </span>
                <button
                  type="button"
                  className="se-icon-button"
                  aria-label="Undo (⌘/Ctrl+Z)"
                  title="Undo (⌘/Ctrl+Z)"
                  disabled={!h.past.length}
                  onClick={() => update((x) => history.undo(x))}
                >
                  <svg
                    width="14"
                    height="14"
                    viewBox="0 0 14 14"
                    fill="none"
                    stroke="currentColor"
                    strokeWidth="1.4"
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    aria-hidden="true"
                  >
                    <path d="M4.5 3L2 5.5L4.5 8M2 5.5H8.5A3.5 3.5 0 0 1 8.5 12.5H6" />
                  </svg>
                </button>
                <button
                  type="button"
                  className="se-icon-button"
                  aria-label="Redo (Shift+⌘/Ctrl+Z)"
                  title="Redo (Shift+⌘/Ctrl+Z)"
                  disabled={!h.future.length}
                  onClick={() => update((x) => history.redo(x))}
                >
                  <svg
                    width="14"
                    height="14"
                    viewBox="0 0 14 14"
                    fill="none"
                    stroke="currentColor"
                    strokeWidth="1.4"
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    aria-hidden="true"
                  >
                    <path d="M9.5 3L12 5.5L9.5 8M12 5.5H5.5A3.5 3.5 0 0 0 5.5 12.5H8" />
                  </svg>
                </button>
              </div>
            </div>
            <div className="se-stage" ref={setStage}>
              <div
                className={`se-sheet tool-${tool}`}
                style={{ width: vbW * scale, height: vbH * scale }}
                aria-label={`Drawing stage for ${edit.definition.name}, ${W} by ${H}`}
                onPointerDown={onPointerDown}
                onPointerMove={onPointerMove}
                onPointerUp={onPointerUp}
                onPointerCancel={() => cancelGesture()}
                onDoubleClick={() => {
                  if (draft?.tool === 'polyline') finishDraft(draft);
                }}
              >
                <svg
                  className="se-grid"
                  viewBox={`${-MARGIN} ${-MARGIN} ${vbW} ${vbH}`}
                  aria-hidden="true"
                >
                  <g className="se-grid-lines" style={{ strokeWidth: px }}>
                    {gridLines}
                  </g>
                </svg>
                <div
                  className="se-face"
                  style={
                    {
                      left: MARGIN * scale,
                      top: MARGIN * scale,
                      width: W,
                      height: H,
                      transform: `scale(${scale})`,
                      // Lines keep a drafting weight at high zoom (the previews show the real one).
                      '--se-weight': Math.min(scale, 2) / scale,
                    } as CSSProperties
                  }
                >
                  <BlockFace definition={result} size={edit.size} />
                </div>
                <svg
                  ref={svgRef}
                  className="se-overlay"
                  viewBox={`${-MARGIN} ${-MARGIN} ${vbW} ${vbH}`}
                  aria-hidden="true"
                  style={{ '--px': `${px}` } as CSSProperties}
                >
                  {!glyph.outline || !drawingShown ? (
                    <rect
                      className="se-body"
                      x={0}
                      y={0}
                      width={W}
                      height={H}
                      style={{ strokeWidth: px }}
                    />
                  ) : null}
                  {dims}
                  <g className="se-snap-dots" style={{ strokeWidth: 1.6 * px }}>
                    {snapDots}
                  </g>
                  {drawingShown && (
                    <rect
                      className="se-design-box"
                      x={origin.x}
                      y={origin.y}
                      width={glyph.width}
                      height={glyph.height}
                      style={{
                        strokeWidth: px,
                        strokeDasharray: `${3 * px} ${3 * px}`,
                      }}
                    >
                      <title>Design box</title>
                    </rect>
                  )}
                  <g transform={`translate(${origin.x} ${origin.y})`}>
                    <g
                      className={`se-hits${tool === 'select' ? '' : ' is-inert'}`}
                    >
                      {shapes.map((s, i) => {
                        if (s.type === 'text') {
                          const b = shapeBounds(s);
                          return (
                            <rect
                              key={i}
                              data-shape={i}
                              className="se-hit is-area"
                              x={b.x}
                              y={b.y}
                              width={b.width}
                              height={b.height}
                            />
                          );
                        }
                        const filled = 'fill' in s && s.fill;
                        return (
                          <path
                            key={i}
                            data-shape={i}
                            className={`se-hit${filled ? ' is-area' : ''}`}
                            d={shapePath(s)}
                          />
                        );
                      })}
                    </g>
                    <g
                      className="se-selected"
                      style={{ strokeWidth: 1.2 * px }}
                    >
                      {shapes.map((s, i) => {
                        if (!selected.has(i)) return null;
                        const b = shapeBounds(s);
                        return (
                          <g key={i}>
                            {s.type !== 'text' && <path d={shapePath(s)} />}
                            <rect
                              className="se-selected-box"
                              x={b.x - 3 * px}
                              y={b.y - 3 * px}
                              width={b.width + 6 * px}
                              height={b.height + 6 * px}
                              style={{ strokeDasharray: `${2 * px} ${2 * px}` }}
                            />
                          </g>
                        );
                      })}
                    </g>
                    {tool === 'select' &&
                      single &&
                      shapeHandles(single).map((hd) => (
                        <rect
                          key={hd.id}
                          className="se-handle"
                          data-handle={hd.id}
                          data-index={selection[0]}
                          x={hd.x - 3.5 * px}
                          y={hd.y - 3.5 * px}
                          width={7 * px}
                          height={7 * px}
                          style={{ strokeWidth: 1.2 * px }}
                        />
                      ))}
                    {preview && (
                      <path
                        className={`se-draft${'fill' in preview && preview.fill ? ' is-filled' : ''}`}
                        d={shapePath(preview)}
                        style={{ strokeWidth: 1.2 * px }}
                      />
                    )}
                    {draft?.tool === 'polyline' && draft.points.length >= 3 && (
                      <circle
                        className="se-close-target"
                        cx={draft.points[0].x}
                        cy={draft.points[0].y}
                        r={6 * px}
                        style={{ strokeWidth: px }}
                      />
                    )}
                    {drawingShown &&
                      Object.entries(glyph.anchors).map(([id, a]) => {
                        const port = portsById[id];
                        if (!port) return null;
                        const s = 4 * px;
                        return (
                          <path
                            key={id}
                            className="se-anchor"
                            data-anchor={id}
                            d={`M${a.x} ${a.y - s}L${a.x + s} ${a.y}L${a.x} ${a.y + s}L${a.x - s} ${a.y}Z`}
                            style={{
                              stroke: domainColors[port.domain],
                              strokeWidth: 1.2 * px,
                            }}
                          >
                            <title>{`Lead of ${port.name} meets the drawing here`}</title>
                          </path>
                        );
                      })}
                  </g>
                  {edit.definition.ports.map(terminal)}
                  {marquee && (
                    <rect
                      className="se-marquee"
                      x={Math.min(marquee.a.x, marquee.b.x)}
                      y={Math.min(marquee.a.y, marquee.b.y)}
                      width={Math.abs(marquee.b.x - marquee.a.x)}
                      height={Math.abs(marquee.b.y - marquee.a.y)}
                      style={{ strokeWidth: px }}
                    />
                  )}
                </svg>
                {textEntry && (
                  <input
                    className="se-text-entry"
                    aria-label="Label text"
                    ref={(el) => {
                      if (el && document.activeElement !== el) el.focus();
                    }}
                    maxLength={24}
                    value={textEntry.value}
                    style={{
                      left: (textEntry.at.x + origin.x + MARGIN) * scale,
                      top: (textEntry.at.y + origin.y + MARGIN) * scale,
                    }}
                    onChange={(e) =>
                      setTextEntry({ ...textEntry, value: e.target.value })
                    }
                    onKeyDown={(e) => {
                      if (e.key === 'Enter') {
                        e.preventDefault();
                        commitText();
                      }
                    }}
                    onBlur={commitText}
                  />
                )}
              </div>
            </div>
            <div className="se-previews" aria-label="Previews at 100%">
              <SheetPreview
                definition={result}
                size={edit.size}
                label="On the sheet"
              />
              <SheetPreview
                definition={result}
                size={edit.size}
                rotation={90}
                label="Turned 90°"
              />
              <SheetPreview
                definition={result}
                size={edit.size}
                flip
                label="Flipped"
              />
            </div>
          </div>
          <aside className="se-panel" aria-label="Symbol properties">
            <section aria-labelledby={`${ids}-terminals`}>
              <h3 id={`${ids}-terminals`}>Terminals</h3>
              <ul className="se-ports">
                {edit.definition.ports.map((p) => {
                  const note = notes.find((n) => n.port === p.id);
                  const lead = drawingShown && p.id in glyph.anchors;
                  return (
                    <li
                      key={p.id}
                      className={hoverPort === p.id ? 'is-hover' : undefined}
                    >
                      <div className="se-port-row">
                        <span
                          className={`se-swatch${p.direction === 'physical' ? ' is-physical' : ''}`}
                          style={
                            {
                              '--port-color': domainColors[p.domain],
                            } as CSSProperties
                          }
                          aria-hidden="true"
                        />
                        <span
                          className="se-port-name"
                          title={`${p.name}: ${domainLabels[p.domain]} ${p.direction === 'physical' ? 'terminal' : p.direction}`}
                        >
                          {p.name}
                        </span>
                        <select
                          aria-label={`Side of ${p.name}`}
                          value={portSide(p)}
                          onChange={(e) =>
                            commit((x) =>
                              setPortSide(x, p.id, e.target.value as Side),
                            )
                          }
                        >
                          {SIDES.map((s) => (
                            <option key={s} value={s}>
                              {sideLabel[s]}
                            </option>
                          ))}
                        </select>
                        <button
                          type="button"
                          className="se-lead"
                          aria-pressed={lead}
                          aria-label={`Lead for ${p.name}`}
                          title={
                            lead
                              ? 'Remove the lead to the drawing'
                              : 'Run a lead from the terminal to the drawing'
                          }
                          onClick={() => commit((x) => toggleLead(x, p.id))}
                        >
                          Lead
                        </button>
                      </div>
                      {note && <p className="se-note">{note.note}</p>}
                    </li>
                  );
                })}
              </ul>
            </section>
            <section aria-labelledby={`${ids}-body`}>
              <h3 id={`${ids}-body`}>Body</h3>
              <div className="se-steppers">
                <Stepper
                  label="Width"
                  value={W}
                  min={16}
                  max={320}
                  onChange={(v) =>
                    commit((x) =>
                      setBodySize(x, { width: v, height: x.size.height }),
                    )
                  }
                />
                <Stepper
                  label="Height"
                  value={H}
                  min={16}
                  max={320}
                  onChange={(v) =>
                    commit((x) =>
                      setBodySize(x, { width: x.size.width, height: v }),
                    )
                  }
                />
              </div>
              <div className="se-toggles">
                <Toggle
                  label="Boxed"
                  checked={
                    drawingShown
                      ? !!glyph.outline
                      : blockShape(result) === 'box'
                  }
                  onChange={(v) => commit((x) => setOutline(x, v))}
                />
                <Toggle
                  label="Terminal names"
                  checked={
                    drawingShown
                      ? captionsShown(glyph)
                      : result.ports.some((p) => showPortLabel(result, p))
                  }
                  onChange={(v) => commit((x) => setCaptions(x, v))}
                />
              </div>
              <button
                type="button"
                className="se-text-button"
                disabled={
                  !drawingShown ||
                  (!glyph.shapes.length && !Object.keys(glyph.anchors).length)
                }
                onClick={() => commit(fitDesignBox)}
              >
                Fit design box to drawing
              </button>
            </section>
            <section aria-labelledby={`${ids}-selection`}>
              <h3 id={`${ids}-selection`}>Selection</h3>
              {selectionPanel()}
            </section>
            {onAskAi && (
              <section aria-labelledby={`${ids}-ai`} className="se-ai">
                <h3 id={`${ids}-ai`}>Draw with AI</h3>
                <label className="se-sr" htmlFor={`${ids}-ai-text`}>
                  What to draw
                </label>
                <textarea
                  id={`${ids}-ai-text`}
                  rows={2}
                  maxLength={200}
                  placeholder="a schematic N-channel MOSFET"
                  value={aiText}
                  disabled={ai.state === 'running'}
                  onChange={(e) => setAiText(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter' && (e.metaKey || e.ctrlKey))
                      void askAi();
                  }}
                />
                <div className="se-ai-row">
                  {aiPrice && <span className="se-meta">{aiPrice}</span>}
                  <Button
                    size="sm"
                    variant="outline"
                    disabled={!aiText.trim() || ai.state === 'running'}
                    onClick={() => void askAi()}
                  >
                    {ai.state === 'running' ? 'Drawing…' : 'Draw'}
                  </Button>
                </div>
                {ai.state === 'running' && (
                  <output className="se-meta se-progress">
                    <i aria-hidden="true" /> Drawing the symbol for these
                    terminals. Closing the editor stops waiting.
                  </output>
                )}
                {ai.state === 'done' && (
                  <output className="se-meta">{ai.message}</output>
                )}
                {ai.state === 'error' && (
                  <p className="se-error" role="alert">
                    {ai.message}
                  </p>
                )}
              </section>
            )}
          </aside>
        </div>
        <div className="dialog-actions se-actions">
          {standard && (
            <Button
              variant="ghost"
              disabled={atStandard}
              onClick={() => {
                cancelGesture();
                commit((x) => resetToStandard(x, standard));
                setSelection([]);
              }}
              title="Back to the library's look; Undo brings this drawing back"
            >
              Reset to standard
            </Button>
          )}
          <output className="se-status">
            {problem ? (
              <span className="se-error">{problem}</span>
            ) : save.state === 'saved' || save.state === 'error' ? (
              <span className={save.state === 'error' ? 'se-error' : undefined}>
                {save.message}
              </span>
            ) : dirty ? (
              <span className="block-dialog-dirty">
                <i />
                Unapplied changes
              </span>
            ) : null}
          </output>
          {onSaveToLibrary && (
            <Button
              variant="outline"
              disabled={!!problem || save.state === 'saving'}
              onClick={() => void saveToLibrary()}
            >
              {save.state === 'saving' ? 'Saving…' : 'Save to AI blocks'}
            </Button>
          )}
          <Button variant="outline" onClick={onClose}>
            {dirty ? 'Cancel' : 'Close'}
          </Button>
          <Button disabled={!!problem} onClick={apply}>
            Apply
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}

export default SymbolEditor;
