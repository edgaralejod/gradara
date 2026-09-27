'use client';
import { useEffect, useRef, useState } from 'react';
import { Check, ChevronDown, Layers, Play, Plus, X } from 'lucide-react';
import type { Configuration, Project } from '@/lib/gradara/model';
import {
  matchingConfiguration,
  variantInstances,
} from '@/lib/gradara/variants';

/**
 * The configuration picker beside Run: which variant every subsystem uses.
 * Shown only when the model has variants.
 */
export default function ConfigurationMenu({
  doc,
  disabled,
  onApply,
  onSave,
  onRemove,
  onRunAll,
}: {
  doc: Project;
  disabled: boolean;
  onApply: (configuration: Configuration) => void;
  onSave: (name: string) => void;
  onRemove: (configuration: Configuration) => void;
  onRunAll: () => void;
}) {
  const [open, setOpen] = useState(false);
  const [naming, setNaming] = useState(false);
  const [name, setName] = useState('');
  const root = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!open) return;
    const close = (e: PointerEvent) => {
      if (!root.current?.contains(e.target as Node)) {
        setOpen(false);
        setNaming(false);
      }
    };
    document.addEventListener('pointerdown', close);
    return () => document.removeEventListener('pointerdown', close);
  }, [open]);
  if (!variantInstances(doc).length) return null;
  const configurations = doc.configurations ?? [];
  const current = matchingConfiguration(doc);
  const save = () => {
    onSave(name || `Configuration ${configurations.length + 1}`);
    setName('');
    setNaming(false);
    setOpen(false);
  };
  return (
    <div className="configuration-menu" ref={root}>
      <button
        className="configuration-trigger"
        aria-haspopup="menu"
        aria-expanded={open}
        disabled={disabled}
        title="Configuration: the variant every subsystem uses"
        onClick={() => setOpen(!open)}
      >
        <Layers size={13} />
        <span>{current?.name ?? 'Custom'}</span>
        <ChevronDown size={12} />
      </button>
      {open && (
        <div className="configuration-popover" role="menu">
          {configurations.map((c) => (
            <div key={c.id} className="configuration-item">
              <button
                role="menuitemradio"
                aria-checked={c.id === current?.id}
                onClick={() => {
                  onApply(c);
                  setOpen(false);
                }}
              >
                <span className="configuration-check">
                  {c.id === current?.id && <Check size={12} />}
                </span>
                {c.name}
              </button>
              <button
                className="configuration-remove"
                aria-label={`Delete configuration ${c.name}`}
                onClick={() => onRemove(c)}
              >
                <X size={12} />
              </button>
            </div>
          ))}
          {!configurations.length && (
            <p className="configuration-empty">
              Save the current variant choices to switch back to them in one
              step.
            </p>
          )}
          <div className="configuration-separator" />
          {naming ? (
            <form
              className="configuration-name"
              onSubmit={(e) => {
                e.preventDefault();
                save();
              }}
            >
              <input
                ref={(el) => el?.focus()}
                value={name}
                maxLength={60}
                placeholder={`Configuration ${configurations.length + 1}`}
                onChange={(e) => setName(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Escape') setNaming(false);
                  e.stopPropagation();
                }}
              />
              <button type="submit">Save</button>
            </form>
          ) : (
            <button role="menuitem" onClick={() => setNaming(true)}>
              <span className="configuration-check">
                <Plus size={12} />
              </span>
              Save current choices…
            </button>
          )}
          <button
            role="menuitem"
            disabled={configurations.length < 2}
            onClick={() => {
              onRunAll();
              setOpen(false);
            }}
          >
            <span className="configuration-check">
              <Play size={11} />
            </span>
            Run all configurations
          </button>
        </div>
      )}
    </div>
  );
}
