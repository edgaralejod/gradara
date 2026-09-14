import {
  emptySelection,
  extractSelection,
  pasteSelection,
  translateSelection,
  type ModelSelection,
} from './selection';
import type { Project } from './model';
import type { Pt } from './routing';
export type CopyPreview = { project: Project; selection: ModelSelection };
export type CopyDragProps = {
  project: Project;
  selection: ModelSelection;
  onPreview: (preview: CopyPreview | null) => void;
  onCommit: (preview: CopyPreview) => void;
};
type Drag = {
  pointer: number;
  root: HTMLElement;
  from: Pt;
  screen: Pt;
  original: Project;
  initial: CopyPreview;
  current: CopyPreview;
  moved: boolean;
};

/** Native frame methods require their Window receiver, even when injected. */
export function browserCopyDragHost(target: Window) {
  return {
    window: target,
    requestFrame: (callback: FrameRequestCallback) =>
      target.requestAnimationFrame(callback),
    cancelFrame: (id: number) => target.cancelAnimationFrame(id),
  };
}

/** Install the actual pointer owner; the host boundary allows deterministic gesture tests. */
export function installCopyDrag(
  getProps: () => CopyDragProps,
  flow: {
    screenToFlowPosition: (point: Pt, options: { snapToGrid: boolean }) => Pt;
  },
  host: {
    window: Window;
    requestFrame: (callback: FrameRequestCallback) => number;
    cancelFrame: (id: number) => void;
  },
) {
  let drag: Drag | null = null;

  let frame: number | null = null;
  let suppressClick = false;
  const stop = (e: Event) => {
    e.preventDefault();
    e.stopPropagation();
    e.stopImmediatePropagation();
  };
  const position = (e: PointerEvent) =>
    flow.screenToFlowPosition(
      { x: e.clientX, y: e.clientY },
      { snapToGrid: false },
    );
  const paint = () => {
    if (frame !== null) return;
    frame = host.requestFrame(() => {
      frame = null;
      if (drag?.moved) getProps().onPreview(drag.current);
    });
  };
  const finish = (commit: boolean) => {
    const g = drag;
    if (!g) return;
    drag = null;
    if (frame !== null) host.cancelFrame(frame);
    frame = null;
    if (g.root.hasPointerCapture(g.pointer))
      g.root.releasePointerCapture(g.pointer);
    g.root.removeAttribute('data-copying');
    if (commit && g.moved && getProps().project === g.original)
      getProps().onCommit(g.current);
    getProps().onPreview(null);
  };
  const down = (e: PointerEvent) => {
    // Ctrl is deliberate on all platforms; Cmd remains available for selection.
    if (drag || !e.ctrlKey || e.button !== 0) {
      suppressClick = false;
      return;
    }
    const target = e.target as Element;
    if (
      target.closest(
        '[data-port-id],.block-name,.react-flow__resize-control,input,button,textarea',
      )
    )
      return;
    const node = target.closest<HTMLElement>('.react-flow__node[data-id]');
    const root = node?.closest<HTMLElement>('.react-flow');
    const id = node?.dataset.id;
    if (!root || !id || (root.dataset.wiring && root.dataset.wiring !== 'idle'))
      return;
    const p = getProps().project;
    if (!p.blocks.some((b) => b.id === id)) return;
    stop(e);
    const selection = getProps().selection.blockIds.includes(id)
      ? getProps().selection
      : { ...emptySelection(), blockIds: [id] };
    const initial = pasteSelection(p, extractSelection(p, selection), {
      x: 0,
      y: 0,
    });
    drag = {
      pointer: e.pointerId,
      root,
      from: position(e),
      screen: { x: e.clientX, y: e.clientY },
      original: p,
      initial,
      current: initial,
      moved: false,
    };
    root.dataset.copying = 'true';
    root.tabIndex = -1;
    root.focus({ preventScroll: true });
    root.setPointerCapture(e.pointerId);
    suppressClick = true;
  };
  const move = (e: PointerEvent) => {
    const g = drag;
    if (!g || e.pointerId !== g.pointer) return;
    stop(e);
    if (Math.hypot(e.clientX - g.screen.x, e.clientY - g.screen.y) > 4)
      g.moved = true;
    if (!g.moved) return;
    const at = position(e);
    const delta = {
      x: Math.round((at.x - g.from.x) / 20) * 20,
      y: Math.round((at.y - g.from.y) / 20) * 20,
    };
    g.current = {
      ...g.initial,
      project: translateSelection(
        g.initial.project,
        g.initial.selection,
        delta,
      ),
    };
    paint();
  };
  const up = (e: PointerEvent) => {
    if (e.pointerId !== drag?.pointer) return;
    move(e);
    finish(true);
  };
  const cancel = () => finish(false);
  const key = (e: KeyboardEvent) => {
    if (!drag) return;
    stop(e);
    if (
      e.key === 'Escape' ||
      ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'z')
    )
      finish(false);
  };
  const click = (e: MouseEvent) => {
    if (suppressClick && (e.target as Element).closest('.react-flow')) {
      stop(e);
      suppressClick = false;
    }
  };
  const context = (e: MouseEvent) => {
    if (
      drag ||
      (e.ctrlKey && (e.target as Element).closest('.react-flow__node'))
    )
      stop(e);
  };
  host.window.addEventListener('pointerdown', down, true);
  host.window.addEventListener('pointermove', move, true);
  host.window.addEventListener('pointerup', up, true);
  host.window.addEventListener('pointercancel', cancel, true);
  host.window.addEventListener('blur', cancel);
  host.window.addEventListener('keydown', key, true);
  host.window.addEventListener('click', click, true);
  host.window.addEventListener('contextmenu', context, true);
  return () => {
    cancel();
    host.window.removeEventListener('pointerdown', down, true);
    host.window.removeEventListener('pointermove', move, true);
    host.window.removeEventListener('pointerup', up, true);
    host.window.removeEventListener('pointercancel', cancel, true);
    host.window.removeEventListener('blur', cancel);
    host.window.removeEventListener('keydown', key, true);
    host.window.removeEventListener('click', click, true);
    host.window.removeEventListener('contextmenu', context, true);
  };
}
