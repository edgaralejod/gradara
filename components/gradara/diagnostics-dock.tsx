'use client';
import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  useSyncExternalStore,
  type ReactNode,
} from 'react';
import { RESET_LAYOUT_EVENT } from './resizable-columns';
import {
  ChevronDown,
  ChevronUp,
  CircleAlert,
  ListChecks,
  Sparkles,
  TriangleAlert,
} from 'lucide-react';

export type DockTab = 'problems' | 'assistant';
export type DockState = { open: boolean; tab: DockTab; height: number };

const STORAGE_KEY = 'gradara.dock';
const DEFAULT: DockState = { open: false, tab: 'problems', height: 220 };
const MIN_HEIGHT = 140;

function parse(raw: string): DockState {
  try {
    const stored = JSON.parse(raw || '{}') as Partial<DockState>;
    return {
      open: typeof stored.open === 'boolean' ? stored.open : DEFAULT.open,
      tab: stored.tab === 'assistant' ? 'assistant' : 'problems',
      height:
        typeof stored.height === 'number' && Number.isFinite(stored.height)
          ? Math.max(MIN_HEIGHT, stored.height)
          : DEFAULT.height,
    };
  } catch {
    return DEFAULT;
  }
}

// Storage-backed store; the server snapshot keeps hydration identical.
const listeners = new Set<() => void>();
let memory = '';
function snapshot() {
  try {
    return localStorage.getItem(STORAGE_KEY) ?? memory;
  } catch {
    return memory;
  }
}
function subscribe(listener: () => void) {
  listeners.add(listener);
  window.addEventListener('storage', listener);
  return () => {
    listeners.delete(listener);
    window.removeEventListener('storage', listener);
  };
}

/** Dock visibility, tab, and height, remembered per browser. */
export function useDockState() {
  const raw = useSyncExternalStore(subscribe, snapshot, () => '');
  const state = useMemo(() => parse(raw), [raw]);
  const update = useCallback((change: Partial<DockState>) => {
    memory = JSON.stringify({ ...parse(snapshot()), ...change });
    try {
      localStorage.setItem(STORAGE_KEY, memory);
    } catch {
      /* Private windows may refuse storage; the dock still works in memory. */
    }
    for (const listener of listeners) listener();
  }, []);
  // Reset layout closes the dock and restores its height; the chosen tab stays.
  useEffect(() => {
    const reset = () => update({ open: DEFAULT.open, height: DEFAULT.height });
    window.addEventListener(RESET_LAYOUT_EVENT, reset);
    return () => window.removeEventListener(RESET_LAYOUT_EVENT, reset);
  }, [update]);
  return [state, update] as const;
}

export default function DiagnosticsDock({
  state,
  onChange,
  counts,
  assistantActive,
  actions,
  problems,
  assistant,
}: {
  state: DockState;
  onChange: (change: Partial<DockState>) => void;
  counts: { error: number; warning: number; info: number };
  assistantActive?: boolean;
  actions?: ReactNode;
  problems: ReactNode;
  assistant: ReactNode;
}) {
  const ref = useRef<HTMLElement>(null);
  const [preview, setPreview] = useState<number | null>(null);
  const frame = useRef(0);
  const clamp = (height: number) => {
    const container = ref.current?.parentElement?.clientHeight ?? 800;
    return Math.round(Math.min(Math.max(MIN_HEIGHT, height), Math.max(MIN_HEIGHT, container * 0.5)));
  };
  const height = Math.max(MIN_HEIGHT, preview ?? state.height);
  const openTab = (tab: DockTab) =>
    onChange(state.open && state.tab === tab ? { open: false } : { open: true, tab });

  return (
    <section
      ref={ref}
      className={`diagnostics-dock ${state.open ? 'is-open' : ''}`}
      style={state.open ? { height: `min(${height}px, 50%)` } : undefined}
      aria-label="Problems and assistant"
    >
      {state.open && (
        <button
          type="button"
          className="dock-resize"
          aria-label="Resize panel. Use the up and down arrow keys."
          onPointerDown={(e) => {
            e.preventDefault();
            e.currentTarget.setPointerCapture(e.pointerId);
            const startY = e.clientY;
            const startHeight = clamp(state.height);
            const target = e.currentTarget;
            const move = (event: PointerEvent) => {
              cancelAnimationFrame(frame.current);
              frame.current = requestAnimationFrame(() =>
                setPreview(clamp(startHeight + startY - event.clientY)),
              );
            };
            const up = (event: PointerEvent) => {
              cancelAnimationFrame(frame.current);
              target.removeEventListener('pointermove', move);
              target.removeEventListener('pointerup', up);
              target.removeEventListener('pointercancel', up);
              setPreview(null);
              onChange({ height: clamp(startHeight + startY - event.clientY) });
            };
            target.addEventListener('pointermove', move);
            target.addEventListener('pointerup', up);
            target.addEventListener('pointercancel', up);
          }}
          onKeyDown={(e) => {
            if (e.key === 'ArrowUp' || e.key === 'ArrowDown') {
              e.preventDefault();
              onChange({ height: clamp(state.height + (e.key === 'ArrowUp' ? 24 : -24)) });
            }
          }}
        />
      )}
      <header className="dock-header">
        <div className="dock-tabs" role="tablist" aria-label="Panel">
          <button
            type="button"
            role="tab"
            aria-selected={state.open && state.tab === 'problems'}
            className={state.open && state.tab === 'problems' ? 'is-active' : ''}
            onClick={() => openTab('problems')}
          >
            <ListChecks size={13} />
            Problems
            {counts.error > 0 && (
              <span className="dock-count is-error" title={`${counts.error} errors`}>
                <CircleAlert size={11} />
                {counts.error}
              </span>
            )}
            {counts.warning > 0 && (
              <span className="dock-count is-warning" title={`${counts.warning} warnings`}>
                <TriangleAlert size={11} />
                {counts.warning}
              </span>
            )}
          </button>
          <button
            type="button"
            role="tab"
            aria-selected={state.open && state.tab === 'assistant'}
            className={state.open && state.tab === 'assistant' ? 'is-active' : ''}
            onClick={() => openTab('assistant')}
          >
            <Sparkles size={13} />
            Assistant
            {assistantActive && <span className="dock-activity" aria-label="Working" />}
          </button>
        </div>
        <div className="dock-actions">
          {state.open && actions}
          <button
            type="button"
            className="dock-toggle"
            aria-label={state.open ? 'Collapse panel · ⌘J' : 'Expand panel · ⌘J'}
            title={state.open ? 'Collapse · ⌘J' : 'Expand · ⌘J'}
            onClick={() => onChange({ open: !state.open })}
          >
            {state.open ? <ChevronDown size={14} /> : <ChevronUp size={14} />}
          </button>
        </div>
      </header>
      {state.open && (
        <div className="dock-body" role="tabpanel">
          {state.tab === 'problems' ? problems : assistant}
        </div>
      )}
    </section>
  );
}
