'use client';
import {
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
  type ReactNode,
} from 'react';

export type CanvasMenuItem =
  | {
      id: string;
      label: string;
      icon?: ReactNode;
      shortcut?: string;
      disabled?: boolean;
      /** Why it is disabled, shown on hover. */
      hint?: string;
      run: () => void;
    }
  | { separator: true; id: string }
  | { heading: string; id: string };

const isAction = (
  item: CanvasMenuItem,
): item is Extract<CanvasMenuItem, { run: () => void }> => 'run' in item;

/**
 * The canvas's right-click menu: a list of commands at the pointer, kept inside the
 * canvas. Arrow keys move, Enter runs, Escape or any click elsewhere closes it.
 */
export default function CanvasMenu({
  at,
  bounds,
  items,
  onClose,
}: {
  /** Pointer position inside the canvas. */
  at: { x: number; y: number };
  bounds: { width: number; height: number };
  items: CanvasMenuItem[];
  onClose: () => void;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const [place, setPlace] = useState(at);
  // Keep the whole menu on the canvas: flip left or up near an edge.
  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    const { offsetWidth: w, offsetHeight: h } = el;
    setPlace({
      x: at.x + w > bounds.width - 4 ? Math.max(4, at.x - w) : at.x,
      y:
        at.y + h > bounds.height - 4
          ? Math.max(4, bounds.height - h - 4)
          : at.y,
    });
  }, [at, bounds]);
  useEffect(() => {
    ref.current
      ?.querySelector<HTMLButtonElement>('button:not(:disabled)')
      ?.focus();
    const away = (e: Event) => {
      if (!ref.current?.contains(e.target as Node)) onClose();
    };
    document.addEventListener('pointerdown', away, true);
    document.addEventListener('wheel', away, true);
    window.addEventListener('blur', onClose);
    return () => {
      document.removeEventListener('pointerdown', away, true);
      document.removeEventListener('wheel', away, true);
      window.removeEventListener('blur', onClose);
    };
  }, [onClose]);
  const move = (step: number) => {
    const buttons = [
      ...(ref.current?.querySelectorAll<HTMLButtonElement>(
        'button:not(:disabled)',
      ) ?? []),
    ];
    const i = buttons.indexOf(document.activeElement as HTMLButtonElement);
    buttons[(i + step + buttons.length) % buttons.length]?.focus();
  };
  return (
    <div
      ref={ref}
      className="canvas-menu"
      role="menu"
      tabIndex={-1}
      aria-label="Canvas"
      style={{ left: place.x, top: place.y }}
      onContextMenu={(e) => e.preventDefault()}
      onKeyDown={(e) => {
        e.stopPropagation();
        if (e.key === 'Escape') onClose();
        else if (e.key === 'ArrowDown') {
          e.preventDefault();
          move(1);
        } else if (e.key === 'ArrowUp') {
          e.preventDefault();
          move(-1);
        }
      }}
    >
      {items.map((item) =>
        'separator' in item ? (
          <hr key={item.id} className="canvas-menu-separator" />
        ) : 'heading' in item ? (
          <div
            key={item.id}
            className="canvas-menu-heading"
            role="presentation"
          >
            {item.heading}
          </div>
        ) : isAction(item) ? (
          <button
            key={item.id}
            type="button"
            role="menuitem"
            aria-label={
              item.shortcut ? `${item.label} (${item.shortcut})` : item.label
            }
            disabled={item.disabled}
            title={item.disabled ? item.hint : undefined}
            onClick={() => {
              onClose();
              item.run();
            }}
          >
            <span className="canvas-menu-icon">{item.icon}</span>
            <span className="canvas-menu-label">{item.label}</span>
            {item.shortcut && <kbd>{item.shortcut}</kbd>}
          </button>
        ) : null,
      )}
    </div>
  );
}
