'use client';
import { X } from 'lucide-react';
import type { Definition, Port } from '@/lib/gradara/model';
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
  return (
    <div
      className="block-inserter nodrag nopan nowheel"
      style={{ left: context.screen.x, top: context.screen.y }}
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
