'use client';
import { useLayoutEffect, useRef, useState } from 'react';
import { X } from 'lucide-react';
import type { Definition, Port } from '@/lib/gradara/model';
import { clampPopoverPosition } from '@/lib/gradara/inserter';
import LibraryNavigator from './library-navigator';

export type InsertContext = {
  position: { x: number; y: number };
  screen: { x: number; y: number };
  connection?: { blockId: string; portId: string };
};

export default function BlockInserter({
  context,
  compatibleWith,
  onAdd,
  onAskAgent,
  onClose,
}: {
  context: InsertContext;
  compatibleWith?: Port;
  onAdd: (definition: Definition) => void;
  onAskAgent: () => void;
  onClose: () => void;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const [screen, setScreen] = useState(context.screen);
  useLayoutEffect(() => {
    const el = ref.current;
    const parent = el?.offsetParent;
    if (!el || !(parent instanceof HTMLElement)) {
      setScreen(context.screen);
      return;
    }
    setScreen(
      clampPopoverPosition(
        context.screen,
        { width: parent.clientWidth, height: parent.clientHeight },
        { width: el.offsetWidth, height: el.offsetHeight },
      ),
    );
  }, [context.screen]);
  return (
    <div
      ref={ref}
      className="block-inserter nodrag nopan nowheel"
      style={{ left: screen.x, top: screen.y }}
      aria-label="Insert a block"
    >
      <div className="inserter-heading">
        <strong>{compatibleWith ? 'Continue this path' : 'Add a block'}</strong>
        <span>
          {compatibleWith
            ? 'Straight left-to-right. Feedback can loop under later.'
            : 'Pick a component. It will sit on the sheet immediately.'}
        </span>
        <button type="button" onClick={onClose} aria-label="Close">
          <X size={14} />
        </button>
      </div>
      <LibraryNavigator
        variant="popover"
        compatibleWith={compatibleWith}
        onAdd={onAdd}
        onAskAgent={onAskAgent}
      />
    </div>
  );
}
