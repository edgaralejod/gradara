'use client';
// SPDX-License-Identifier: Apache-2.0
import { ListChecks, LoaderCircle, MessageCircleQuestion, PencilLine, Square } from 'lucide-react';
import { domainColors, type Project } from '@/lib/gradara/model';
import type { Entry, PlanPreview } from '@/lib/gradara/proposals-thread';

/**
 * The planner's plan while the executor carries it out. It shows as soon as the
 * plan exists, before any block is written, and gives way to the proposal or
 * draft card when the job finishes.
 */
export function PlanCard({
  plan,
  progress,
  onCancel,
}: {
  plan: PlanPreview;
  progress: string;
  onCancel: () => void;
}) {
  return (
    <article className="proposal-card plan-card" aria-busy="true">
      <header>
        <ListChecks size={13} />
        <strong>Plan</strong>
        {plan.blocks > 0 && (
          <span className="proposal-badge is-plan">
            {plan.blocks} block{plan.blocks === 1 ? '' : 's'} to write
          </span>
        )}
      </header>
      {plan.summary && <p className="proposal-summary">{plan.summary}</p>}
      <PlanSteps steps={plan.steps} />
      {plan.assumptions.length > 0 && (
        <ul className="proposal-assumptions">
          {plan.assumptions.map((a) => (
            <li key={a}>{a}</li>
          ))}
        </ul>
      )}
      <footer className="assistant-working">
        <LoaderCircle size={13} className="spin" />
        <span>{progress}…</span>
        <button type="button" onClick={onCancel}>
          <Square size={10} />
          Cancel
        </button>
      </footer>
    </article>
  );
}

/** A plan's steps, numbered in the order they happen. */
export function PlanSteps({ steps }: { steps: string[] }) {
  if (!steps.length) return null;
  return (
    <ol className="plan-steps">
      {steps.map((step, i) => (
        <li key={i}>{step}</li>
      ))}
    </ol>
  );
}

/** The plan behind a finished proposal or draft, folded away under its summary. */
export function PlanDetails({ steps }: { steps?: string[] }) {
  if (!steps?.length) return null;
  return (
    <details className="plan-details">
      <summary>
        Plan · {steps.length} step{steps.length === 1 ? '' : 's'}
      </summary>
      <PlanSteps steps={steps} />
    </details>
  );
}

/** A question the planner answered; nothing in the model changed. */
export function AnswerCard({
  entry,
  project,
  busy,
  onSelect,
  onMakeEdit,
}: {
  entry: Extract<Entry, { kind: 'answer' }>;
  project: Project;
  busy: boolean;
  onSelect: (blockIds: string[]) => void;
  onMakeEdit: () => void;
}) {
  const blocks = new Map(project.blocks.map((b) => [b.id, b]));
  const chips = (entry.blockIds ?? []).map((id) => blocks.get(id)).filter((b) => !!b);
  return (
    <article className="proposal-card answer-card">
      <header>
        <MessageCircleQuestion size={13} />
        <strong>Answer</strong>
        <span className="proposal-provider">
          {entry.provider}
          {entry.credits !== undefined ? ` · ${entry.credits} credits` : ''}
        </span>
      </header>
      {entry.text.split(/\n{2,}/).map((paragraph, i) => (
        <p key={i} className="proposal-summary">
          {paragraph}
        </p>
      ))}
      {chips.length > 0 && (
        <span className="problem-chips answer-blocks">
          {chips.map((block) => (
            <button type="button" key={block.id} className="problem-chip" onClick={() => onSelect([block.id])}>
              <i style={{ background: domainColors[block.definition.domain] }} />
              {block.definition.name}
            </button>
          ))}
        </span>
      )}
      {entry.suggestedEdit && (
        <footer className="answer-suggestion">
          <span>
            <strong>Suggested change</strong> {entry.suggestedEdit}
          </span>
          <button type="button" disabled={busy} onClick={onMakeEdit}>
            <PencilLine size={12} />
            Make this an edit
          </button>
        </footer>
      )}
    </article>
  );
}
