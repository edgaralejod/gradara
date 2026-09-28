'use client';
import { useRef, useState } from 'react';
import {
  Dialog,
  DialogContent,
  DialogTitle,
  DialogDescription,
} from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import {
  domainColors,
  domainLabels,
  type Block,
  type Domain,
} from '@/lib/gradara/model';
import {
  portSummary,
  portTypes,
  type PortChange,
  type PortRole,
  type Side,
} from '@/lib/gradara/subsystem-ports';

const sides: Side[] = ['left', 'right', 'top', 'bottom'];
const sideLabels: Record<Side, string> = {
  left: 'Left',
  right: 'Right',
  top: 'Top',
  bottom: 'Bottom',
};

/**
 * The properties dialog of a subsystem port pill. A port has no parameters or
 * equations, so its dialog holds what a port does have: input or output, the type
 * it carries, its name and number, and the side of the subsystem block it sits on.
 */
export default function PortDialog({
  block,
  count,
  onClose,
  onApply,
}: {
  block: Block;
  /** How many ports share its numbering, for the Number list. */
  count: (role: PortRole, type: Domain) => number;
  onClose: () => void;
  onApply: (change: PortChange) => void;
}) {
  const nameField = useRef<HTMLInputElement>(null);
  const now = portSummary(block);
  const [draft, setDraft] = useState({
    role: now.role,
    type: now.domain,
    name: now.name,
    number: now.number ?? 1,
    side: now.side,
  });
  const retyped = draft.role !== now.role || draft.type !== now.domain;
  const change: PortChange = {
    ...(draft.role !== now.role ? { role: draft.role } : {}),
    ...(draft.type !== now.domain ? { type: draft.type } : {}),
    ...(draft.name.trim() && draft.name.trim() !== now.name
      ? { name: draft.name }
      : {}),
    ...(!retyped && draft.number !== (now.number ?? 1)
      ? { number: draft.number }
      : {}),
    ...(!retyped && draft.side !== now.side ? { side: draft.side } : {}),
  };
  const dirty = Object.keys(change).length > 0;
  const apply = () => {
    if (dirty) onApply(change);
    else onClose();
  };
  const numbers = count(draft.role, draft.type) + (retyped ? 1 : 0);
  return (
    <Dialog
      open
      onOpenChange={(open) => {
        if (!open) onClose();
      }}
    >
      <DialogContent
        className="source-dialog block-dialog port-dialog"
        initialFocus={nameField}
      >
        <DialogTitle>
          <span
            className="port-dialog-swatch"
            style={{ background: domainColors[draft.type] }}
          />
          {now.name}
        </DialogTitle>
        <DialogDescription>
          A port of this subsystem. Its name shows on the subsystem block
          outside. Apply saves all changes as one undo step.
        </DialogDescription>
        <div className="block-dialog-properties port-dialog-fields">
          <label className="field-row">
            <span>Port</span>
            <select
              value={draft.role}
              onChange={(e) =>
                setDraft({ ...draft, role: e.target.value as PortRole })
              }
            >
              <option value="input">Input</option>
              <option value="output">Output</option>
            </select>
          </label>
          <label className="field-row">
            <span>Type</span>
            <select
              value={draft.type}
              onChange={(e) =>
                setDraft({ ...draft, type: e.target.value as Domain })
              }
            >
              {portTypes.map((d) => (
                <option key={d} value={d}>
                  {domainLabels[d]}
                </option>
              ))}
            </select>
          </label>
          <div className="field-row">
            <label htmlFor="port-dialog-name">Name</label>
            <Input
              id="port-dialog-name"
              ref={nameField}
              maxLength={60}
              value={draft.name}
              onChange={(e) => setDraft({ ...draft, name: e.target.value })}
              onKeyDown={(e) => {
                if (e.key === 'Enter') apply();
              }}
            />
          </div>
          <label className="field-row">
            <span>Number</span>
            <select
              disabled={retyped}
              value={retyped ? numbers : draft.number}
              onChange={(e) =>
                setDraft({ ...draft, number: Number(e.target.value) })
              }
            >
              {Array.from({ length: Math.max(1, numbers) }, (_, i) => (
                <option key={i} value={i + 1}>
                  {i + 1}
                </option>
              ))}
            </select>
          </label>
          <label className="field-row">
            <span>Side outside</span>
            <select
              disabled={retyped}
              value={draft.side}
              onChange={(e) =>
                setDraft({ ...draft, side: e.target.value as Side })
              }
            >
              {sides.map((s) => (
                <option key={s} value={s}>
                  {sideLabels[s]}
                </option>
              ))}
            </select>
          </label>
          <p className="size-hint">
            {retyped
              ? 'Changing input/output or type removes the wires on this port, inside and outside. It becomes the last port of its kind; renumber or move it afterwards.'
              : 'A physical type makes the port a terminal; input or output then only decides the side it starts on.'}
          </p>
        </div>
        <div className="dialog-actions">
          {dirty && (
            <output className="block-dialog-dirty">
              <i />
              Unapplied changes
            </output>
          )}
          <Button variant="outline" onClick={onClose}>
            {dirty ? 'Cancel' : 'Close'}
          </Button>
          <Button disabled={!dirty} onClick={apply}>
            Apply
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
