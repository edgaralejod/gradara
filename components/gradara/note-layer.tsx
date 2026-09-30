// SPDX-License-Identifier: Apache-2.0
'use client';
import { useEffect, useRef, useState } from 'react';
import { useViewport, ViewportPortal } from '@xyflow/react';
import { X } from 'lucide-react';
import type { Project } from '@/lib/gradara/model';
import { GRID } from '@/lib/gradara/grid';

export type Note = NonNullable<Project['annotations']>[number];

const snap = (v: number) => Math.round(v / GRID) * GRID;

/**
 * Text notes on the sheet: a heading and optional detail lines. Drag a note to move
 * it (it lands on the sheet grid), double-click it to edit, and press Delete while it
 * is selected to remove it. Every change is one undoable edit through `onChange`
 * (`null` removes the note). Notes live on the top-level sheet.
 */
export default function NoteLayer({
  notes,
  editable,
  editing,
  onEditingChange,
  onChange,
}: {
  notes: Note[];
  editable: boolean;
  /** The note being edited, if any (a new note opens for editing). */
  editing: number | null;
  onEditingChange: (index: number | null) => void;
  onChange: (index: number, note: Note | null) => void;
}) {
  const { zoom } = useViewport();
  const [selected, setSelected] = useState<number | null>(null);
  const [drag, setDrag] = useState<{
    index: number;
    dx: number;
    dy: number;
  } | null>(null);
  const start = useRef<{ x: number; y: number; moved: boolean } | null>(null);

  useEffect(() => {
    if (selected !== null && selected >= notes.length) setSelected(null);
  }, [notes.length, selected]);

  return (
    <ViewportPortal>
      {notes.map((note, index) => {
        const moving = drag?.index === index;
        const x = note.x + (moving ? drag.dx : 0);
        const y = note.y + (moving ? drag.dy : 0);
        if (editing === index && editable)
          return (
            <NoteEditor
              key={index}
              note={note}
              x={x}
              y={y}
              onDone={(next) => {
                onEditingChange(null);
                if (next === undefined) return;
                if (!next.text.trim() && !next.detail?.trim())
                  onChange(index, null);
                else if (
                  next.text !== note.text ||
                  (next.detail ?? '') !== (note.detail ?? '')
                )
                  onChange(index, next);
              }}
            />
          );
        return (
          <div
            key={index}
            className={`diagram-annotation${editable ? ' is-editable nodrag nopan' : ''}${selected === index ? ' is-selected' : ''}`}
            style={{ transform: `translate(${x}px, ${y}px)` }}
            tabIndex={editable ? 0 : undefined}
            role={editable ? 'button' : undefined}
            aria-label={
              editable
                ? `Note: ${note.text}. Drag to move, double-click to edit.`
                : undefined
            }
            title={
              editable
                ? 'Drag to move · Double-click to edit · Delete to remove'
                : undefined
            }
            onPointerDown={(e) => {
              if (!editable || e.button !== 0) return;
              e.stopPropagation();
              e.currentTarget.setPointerCapture(e.pointerId);
              start.current = { x: e.clientX, y: e.clientY, moved: false };
              setSelected(index);
            }}
            onPointerMove={(e) => {
              const s = start.current;
              if (!s) return;
              const dx = (e.clientX - s.x) / zoom,
                dy = (e.clientY - s.y) / zoom;
              if (!s.moved && Math.hypot(dx, dy) * zoom < 3) return;
              s.moved = true;
              setDrag({
                index,
                dx: snap(note.x + dx) - note.x,
                dy: snap(note.y + dy) - note.y,
              });
            }}
            onPointerUp={() => {
              const s = start.current;
              start.current = null;
              if (s?.moved && drag && (drag.dx || drag.dy))
                onChange(index, {
                  ...note,
                  x: note.x + drag.dx,
                  y: note.y + drag.dy,
                });
              setDrag(null);
            }}
            onDoubleClick={(e) => {
              if (!editable) return;
              e.stopPropagation();
              onEditingChange(index);
            }}
            onKeyDown={(e) => {
              if (!editable) return;
              if (e.key === 'Delete' || e.key === 'Backspace') {
                e.preventDefault();
                e.stopPropagation();
                onChange(index, null);
              } else if (e.key === 'Enter') {
                e.preventDefault();
                onEditingChange(index);
              } else if (e.key === 'Escape') setSelected(null);
            }}
            onBlur={() => setSelected((s) => (s === index ? null : s))}
          >
            <strong>{note.text}</strong>
            {note.detail && <span>{note.detail}</span>}
          </div>
        );
      })}
    </ViewportPortal>
  );
}

/** In-place editor: a heading and a detail line. Enter or clicking away saves; Esc cancels. */
function NoteEditor({
  note,
  x,
  y,
  onDone,
}: {
  note: Note;
  x: number;
  y: number;
  onDone: (next: Note | undefined) => void;
}) {
  const [text, setText] = useState(note.text);
  const [detail, setDetail] = useState(note.detail ?? '');
  const box = useRef<HTMLDivElement>(null);
  const title = useRef<HTMLInputElement>(null);
  useEffect(() => {
    title.current?.focus();
    title.current?.select();
  }, []);
  const save = () =>
    onDone({ ...note, text: text.trim(), detail: detail.trim() });
  const keys = (e: React.KeyboardEvent) => {
    e.stopPropagation();
    if (e.key === 'Escape') onDone(undefined);
    else if (e.key === 'Enter') {
      e.preventDefault();
      save();
    }
  };
  return (
    <div
      ref={box}
      className="diagram-annotation is-editing nodrag nopan nowheel"
      style={{ transform: `translate(${x}px, ${y}px)` }}
      onPointerDown={(e) => e.stopPropagation()}
      onBlur={(e) => {
        if (!box.current?.contains(e.relatedTarget as Node)) save();
      }}
    >
      <input
        ref={title}
        aria-label="Note heading"
        placeholder="Heading"
        value={text}
        onChange={(e) => setText(e.target.value)}
        onKeyDown={keys}
      />
      <input
        aria-label="Note detail"
        placeholder="Detail (optional)"
        value={detail}
        onChange={(e) => setDetail(e.target.value)}
        onKeyDown={keys}
      />
      <button
        type="button"
        className="note-delete"
        aria-label="Delete note"
        title="Delete note"
        onMouseDown={(e) => e.preventDefault()}
        onClick={() => onDone({ ...note, text: '', detail: '' })}
      >
        <X size={12} />
      </button>
    </div>
  );
}
