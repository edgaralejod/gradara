'use client';
import { useState } from 'react';
import { Layers, Plus, SlidersHorizontal, X } from 'lucide-react';
import type { Block, Project } from '@/lib/gradara/model';
import {
  addDiagramVariant,
  addParameterVariant,
  missingPorts,
  removeVariant,
  renameVariant,
  setPortUnused,
  switchVariant,
} from '@/lib/gradara/variants';

/** Inspector section for a subsystem instance's variants. */
export default function VariantPanel({
  doc,
  block,
  onCommit,
}: {
  /** The whole document, to look up each variant's inside. */
  doc: Project;
  block: Block;
  /** Apply an edit to the open sheet as one undo step. */
  onCommit: (change: (view: Project) => Project) => void;
}) {
  const [editing, setEditing] = useState('');
  const [draft, setDraft] = useState('');
  const sr = block.definition.subsystem;
  if (!sr) return null;
  const variants = sr.variants ?? [];
  const shared = (ref: string) =>
    variants.filter((v) => v.ref === ref).length > 1;
  const finishRename = (variantId: string) => {
    onCommit((p) => renameVariant(p, block.id, variantId, draft));
    setEditing('');
  };
  return (
    <div className="variant-panel">
      <div className="section-label">Variants</div>
      {variants.length ? (
        <ul className="variant-list" aria-label="Variants">
          {variants.map((v) => {
            const missing = missingPorts(doc, block, v);
            const unused = new Set(v.unused ?? []);
            const active = v.id === sr.active;
            return (
              <li key={v.id} className={active ? 'is-active' : ''}>
                <div className="variant-row">
                  <button
                    aria-pressed={active}
                    aria-label={
                      active ? `${v.name} (active)` : `Switch to ${v.name}`
                    }
                    className="variant-choose"
                    title={active ? 'Active variant' : `Switch to ${v.name}`}
                    onClick={() =>
                      onCommit((p) => switchVariant(p, block.id, v.id))
                    }
                  >
                    <span className="variant-dot" />
                  </button>
                  {editing === v.id ? (
                    <input
                      ref={(el) => el?.focus()}
                      value={draft}
                      maxLength={60}
                      onChange={(e) => setDraft(e.target.value)}
                      onBlur={() => finishRename(v.id)}
                      onKeyDown={(e) => {
                        if (e.key === 'Enter') finishRename(v.id);
                        if (e.key === 'Escape') setEditing('');
                        e.stopPropagation();
                      }}
                    />
                  ) : (
                    <span
                      className="variant-name"
                      title="Double-click to rename"
                      onDoubleClick={() => {
                        setDraft(v.name);
                        setEditing(v.id);
                      }}
                    >
                      {v.name}
                    </span>
                  )}
                  <span
                    className="variant-kind"
                    title={
                      shared(v.ref)
                        ? 'Shares its inside with another variant; differs in parameter values'
                        : 'Has its own inside'
                    }
                  >
                    {shared(v.ref) ? (
                      <SlidersHorizontal size={11} />
                    ) : (
                      <Layers size={11} />
                    )}
                  </span>
                  <button
                    className="variant-remove"
                    aria-label={`Remove variant ${v.name}`}
                    onClick={() =>
                      onCommit((p) => removeVariant(p, block.id, v.id))
                    }
                  >
                    <X size={12} />
                  </button>
                </div>
                {missing.map((port) => (
                  <label
                    key={port.id}
                    className={`variant-port ${unused.has(port.id) ? '' : 'is-problem'}`}
                  >
                    <input
                      type="checkbox"
                      checked={unused.has(port.id)}
                      onChange={(e) =>
                        onCommit((p) =>
                          setPortUnused(
                            p,
                            block.id,
                            v.id,
                            port.id,
                            e.target.checked,
                          ),
                        )
                      }
                    />
                    <span>{port.name}: not used here</span>
                  </label>
                ))}
              </li>
            );
          })}
        </ul>
      ) : (
        <p className="variant-hint">
          Add a variant to keep alternative insides behind these ports, and
          switch between them on the block.
        </p>
      )}
      <div className="variant-actions">
        <button
          onClick={() =>
            onCommit((p) => addDiagramVariant(p, block.id)?.project ?? p)
          }
          title="Copy the current inside into a new variant you can edit"
        >
          <Plus size={12} />
          Diagram variant
        </button>
        <button
          onClick={() =>
            onCommit((p) => addParameterVariant(p, block.id)?.project ?? p)
          }
          title="Same inside, its own promoted parameter values"
        >
          <Plus size={12} />
          Parameter variant
        </button>
      </div>
    </div>
  );
}
