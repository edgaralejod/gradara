'use client';
// SPDX-License-Identifier: Apache-2.0
import { Check, FolderOpen, Lightbulb, Plus, X } from 'lucide-react';
import { domainColors, type Project } from '@/lib/gradara/model';
import { portPoint, sideToPosition } from '@/lib/gradara/ports';
import { pointsToPath, routeBetween } from '@/lib/gradara/routing';
import type { Entry } from '@/lib/gradara/proposals-thread';
import { BlockFace } from './block-face';

type BlockEntry = Extract<Entry, { kind: 'block' }>;
type ModelEntry = Extract<Entry, { kind: 'model' }>;
type UnsupportedEntry = Extract<Entry, { kind: 'unsupported' }>;

/** A created or refined block, waiting to be added to the model. */
export function BlockDraftCard({
  entry,
  canApply,
  onApply,
  onDiscard,
}: {
  entry: BlockEntry;
  /** False when the refined block is gone from the sheet. */
  canApply: boolean;
  onApply: () => void;
  onDiscard: () => void;
}) {
  const block = entry.definition;
  return (
    <article className={`proposal-card draft-card is-${entry.status}`}>
      <header>
        <strong>{entry.refines ? 'Refined block' : 'New block'}</strong>
        <span className="proposal-badge is-verified">
          <Check size={11} />
          Modelica checked · in AI blocks
        </span>
      </header>
      <div className="draft-block">
        <span className="draft-symbol">{block.symbol}</span>
        <div>
          <strong>{block.name}</strong>
          <p>{block.description}</p>
        </div>
      </div>
      <div className="preview-terminals">
        {block.ports.map((port) => (
          <span key={port.id} style={{ borderColor: domainColors[port.domain] }}>
            <i style={{ background: domainColors[port.domain] }} />
            {port.name} <small>{port.direction === 'physical' ? port.domain : port.direction}</small>
          </span>
        ))}
      </div>
      <details className="draft-equations">
        <summary>Equations</summary>
        <pre>{block.equations}</pre>
      </details>
      <footer>
        {entry.status === 'pending' ? (
          <>
            {!canApply && <span className="proposal-stale">The block is no longer on this sheet</span>}
            <button type="button" onClick={onDiscard}>
              <X size={12} />
              Discard
            </button>
            <button type="button" className="is-primary" disabled={!canApply} onClick={onApply}>
              <Plus size={12} />
              {entry.refines ? 'Apply changes' : 'Add to model'}
            </button>
          </>
        ) : (
          <span className="proposal-status">
            {entry.status === 'applied' ? (entry.refines ? 'Applied' : 'Added to the model') : 'Discarded'}
          </span>
        )}
        <span className="proposal-provider">
          {entry.provider}
          {entry.credits !== undefined ? ` · ${entry.credits} credits` : ''}
        </span>
      </footer>
    </article>
  );
}

function DiagramPreview({ project }: { project: Project }) {
  const blocks = new Map(project.blocks.map((block) => [block.id, block]));
  const width = Math.max(...project.blocks.map((b) => b.position.x + (b.size?.width ?? 120))) + 80;
  const height = Math.max(...project.blocks.map((b) => b.position.y + (b.size?.height ?? 80))) + 80;
  return (
    <svg className="model-draft-diagram" viewBox={`0 0 ${width} ${height}`} aria-label="Generated model diagram">
      {project.wires.map((wire) => {
        const source = blocks.get(wire.source);
        const target = blocks.get(wire.target);
        if (!source || !target) return null;
        const a = portPoint(source, wire.sourceHandle);
        const b = portPoint(target, wire.targetHandle);
        if (!a || !b) return null;
        const domain = source.definition.ports.find((p) => p.id === wire.sourceHandle)?.domain ?? 'signal';
        return (
          <path
            key={wire.id}
            d={pointsToPath(routeBetween(a, b, sideToPosition(a.side), sideToPosition(b.side)))}
            fill="none"
            stroke={domainColors[domain]}
            strokeWidth={2}
          />
        );
      })}
      {project.blocks.map((block) => (
        <g key={block.id}>
          <foreignObject
            x={block.position.x}
            y={block.position.y}
            width={block.size?.width ?? 120}
            height={block.size?.height ?? 80}
          >
            <div style={{ position: 'relative', width: '100%', height: '100%' }}>
              <BlockFace definition={block.definition} />
            </div>
          </foreignObject>
          <text
            x={block.position.x + (block.size?.width ?? 120) / 2}
            y={block.position.y + (block.size?.height ?? 80) + 20}
            textAnchor="middle"
            fontSize={14}
          >
            {block.definition.name}
          </text>
        </g>
      ))}
    </svg>
  );
}

/** A generated model, checked by a simulation, waiting to be opened as a new model. */
export function ModelDraftCard({
  entry,
  opening,
  onOpen,
  onDiscard,
}: {
  entry: ModelEntry;
  opening: boolean;
  onOpen: () => void;
  onDiscard: () => void;
}) {
  const { draft } = entry;
  return (
    <article className={`proposal-card draft-card is-${entry.status}`}>
      <header>
        <strong>New model</strong>
        <span className="proposal-badge is-verified">
          <Check size={11} />
          Simulation completed · {draft.samples.toLocaleString()} samples
        </span>
      </header>
      <p className="proposal-summary">
        <strong>{draft.project.name}</strong> — {draft.project.description}
      </p>
      <DiagramPreview project={draft.project} />
      <p className="draft-facts">
        {draft.project.blocks.length} blocks · {draft.project.wires.length} connections · {draft.project.duration} s
      </p>
      <details className="draft-equations">
        <summary>Library choices and assumptions</summary>
        <p>
          <strong>Reused:</strong> {draft.reused.join(', ') || 'None'}
        </p>
        <p>
          <strong>Created in AI blocks:</strong> {draft.generated.map((b) => b.name).join(', ') || 'None needed'}
        </p>
        <ul>
          {draft.assumptions.map((item, i) => (
            <li key={i}>{item}</li>
          ))}
        </ul>
      </details>
      <footer>
        {entry.status === 'pending' ? (
          <>
            <button type="button" disabled={opening} onClick={onDiscard}>
              <X size={12} />
              Discard
            </button>
            <button type="button" className="is-primary" disabled={opening} onClick={onOpen}>
              <FolderOpen size={12} />
              {opening ? 'Opening…' : 'Open as new model'}
            </button>
          </>
        ) : (
          <span className="proposal-status">{entry.status === 'applied' ? 'Opened as a new model' : 'Discarded'}</span>
        )}
      </footer>
    </article>
  );
}

/** "Gradara cannot do this yet": the edge of the product, with a way to ask for it. */
export function UnsupportedCard({
  entry,
  onImprove,
}: {
  entry: UnsupportedEntry;
  onImprove: () => void;
}) {
  return (
    <article className="proposal-card unsupported-card">
      <header>
        <Lightbulb size={13} />
        <strong>Gradara cannot do this yet</strong>
      </header>
      <p className="proposal-summary">{entry.reason}</p>
      <p className="draft-facts">
        Your model was not changed. Improve Gradara opens a public GitHub issue with your request and this reason;
        no model or file is attached, and you can edit it before submitting.
      </p>
      <footer>
        <button type="button" className="is-primary" onClick={onImprove}>
          <Lightbulb size={12} />
          Improve Gradara…
        </button>
      </footer>
    </article>
  );
}
