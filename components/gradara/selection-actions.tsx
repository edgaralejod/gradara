'use client';
import { useState } from 'react';
import { useStore } from '@xyflow/react';
import { Ellipsis, Group, LayoutGrid } from 'lucide-react';

/**
 * Simulink's selection ellipsis: after you select two or more blocks, a small "…"
 * sits at the selection's lower-right corner. Point at it (or focus it) to show the
 * actions for the selection, starting with Create subsystem.
 */
export default function SelectionActions({
  onGroup,
  onArrange,
}: {
  onGroup: () => void;
  onArrange: () => void;
}) {
  const [open, setOpen] = useState(false);
  // The selection's lower-right corner on screen, or '' when there is nothing to show.
  const corner = useStore((s) => {
    if (s.userSelectionActive || s.connection.inProgress) return '';
    let n = 0;
    let right = -Infinity;
    let bottom = -Infinity;
    for (const node of s.nodeLookup.values()) {
      if (!node.selected) continue;
      if (node.dragging) return '';
      n++;
      const { x, y } = node.internals.positionAbsolute;
      right = Math.max(right, x + (node.measured.width ?? 0));
      bottom = Math.max(bottom, y + (node.measured.height ?? 0));
    }
    if (n < 2) return '';
    const [tx, ty, zoom] = s.transform;
    return `${Math.round(right * zoom + tx)},${Math.round(bottom * zoom + ty)}`;
  });
  if (!corner) return null;
  const [x, y] = corner.split(',').map(Number);
  return (
    <div
      className={`selection-actions ${open ? 'is-open' : ''}`}
      style={{ left: x + 6, top: y + 6 }}
      onPointerEnter={() => setOpen(true)}
      onPointerLeave={() => setOpen(false)}
      onFocus={() => setOpen(true)}
      onBlur={(e) => {
        if (!e.currentTarget.contains(e.relatedTarget as Node)) setOpen(false);
      }}
      onPointerDown={(e) => e.stopPropagation()}
    >
      {open ? (
        <>
          <button
            type="button"
            onClick={onGroup}
            title="Create subsystem · ⌘/Ctrl + G"
          >
            <Group size={13} />
            Create subsystem
          </button>
          <button
            type="button"
            onClick={onArrange}
            title="Arrange the selection · ⌘/Ctrl + Shift + A"
          >
            <LayoutGrid size={13} />
            Arrange
          </button>
        </>
      ) : (
        <button type="button" aria-label="Actions for the selection">
          <Ellipsis size={14} />
        </button>
      )}
    </div>
  );
}
