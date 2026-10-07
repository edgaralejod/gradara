'use client';
import {
  Check,
  CircleAlert,
  Minus,
  PencilLine,
  Plus,
  RefreshCw,
  Undo2,
  Waypoints,
  X,
} from 'lucide-react';
import { domainColors, type Project } from '@/lib/gradara/model';
import type { EditChange, EditProposal } from '@/lib/gradara/proposal';
import type { ProposalStatus } from '@/lib/gradara/proposals-thread';

export type { ProposalStatus };

const GROUPS: { id: string; title: string; ops: string[]; icon: typeof Plus }[] = [
  { id: 'added', title: 'Added', ops: ['add_block', 'create_block'], icon: Plus },
  { id: 'removed', title: 'Removed', ops: ['remove_block'], icon: Minus },
  {
    id: 'changed',
    title: 'Changed',
    ops: ['set_parameter', 'rename_block', 'revise_definition', 'set_duration', 'log_signal'],
    icon: PencilLine,
  },
  { id: 'rewired', title: 'Rewired', ops: ['connect', 'disconnect'], icon: Waypoints },
];

export default function ProposalCard({
  proposal,
  current,
  status,
  stale,
  revising,
  onApply,
  onDiscard,
  onRefine,
  onSelect,
}: {
  proposal: EditProposal;
  current: Project;
  status: ProposalStatus;
  stale: boolean;
  /** True while the Ask bar is set to revise this proposal. */
  revising: boolean;
  onApply: () => void;
  onDiscard: () => void;
  onRefine: () => void;
  onSelect: (blockIds: string[]) => void;
}) {
  const names = new Map<string, { name: string; domain: string; exists: boolean }>();
  for (const b of current.blocks)
    names.set(b.id, { name: b.definition.name, domain: b.definition.domain, exists: true });
  for (const b of proposal.project.blocks)
    if (!names.has(b.id))
      names.set(b.id, { name: b.definition.name, domain: b.definition.domain, exists: false });
  const chip = (id: string) => {
    const entry = names.get(id);
    if (!entry) return null;
    return (
      <button
        type="button"
        key={id}
        className="problem-chip"
        disabled={!entry.exists && status !== 'applied'}
        title={entry.exists || status === 'applied' ? 'Select on the canvas' : 'Added when you apply'}
        onClick={() => onSelect([id])}
      >
        <i style={{ background: domainColors[entry.domain as keyof typeof domainColors] }} />
        {entry.name}
      </button>
    );
  };
  const groups = GROUPS.map((g) => ({
    ...g,
    items: proposal.changes.filter((c) => g.ops.includes(c.op)),
  })).filter((g) => g.items.length);

  return (
    <article className={`proposal-card is-${status}`}>
      <header>
        <strong>Proposed edit</strong>
        {proposal.verified ? (
          <span className="proposal-badge is-verified">
            <Check size={11} />
            Checked in OpenModelica
            {proposal.samples ? ` · ${proposal.samples.toLocaleString()} samples` : ''}
          </span>
        ) : (
          <span className="proposal-badge is-unverified">
            <CircleAlert size={11} />
            Not verified
          </span>
        )}
      </header>
      <p className="proposal-summary">{proposal.summary}</p>
      {proposal.assumptions.length > 0 && (
        <ul className="proposal-assumptions">
          {proposal.assumptions.map((a) => (
            <li key={a}>{a}</li>
          ))}
        </ul>
      )}
      <div className="proposal-changes">
        {groups.map((g) => (
          <section key={g.id}>
            <h4>
              <g.icon size={12} />
              {g.title}
            </h4>
            <ul>
              {g.items.map((c: EditChange, i) => (
                <li key={`${c.op}-${i}`}>
                  <span>{c.description}</span>
                  <span className="problem-chips">{c.blockIds.map(chip)}</span>
                </li>
              ))}
            </ul>
          </section>
        ))}
      </div>
      {!proposal.verified && proposal.diagnostics.length > 0 && (
        <ul className="proposal-diagnostics">
          {proposal.diagnostics.map((d) => (
            <li key={d.id}>
              <CircleAlert size={12} />
              {d.message}
            </li>
          ))}
        </ul>
      )}
      <footer>
        {status === 'pending' ? (
          <>
            {stale && (
              <span className="proposal-stale">
                Model changed since this proposal — ask again
              </span>
            )}
            <button type="button" aria-pressed={revising} onClick={onRefine}>
              <RefreshCw size={12} />
              Refine
            </button>
            <button type="button" onClick={onDiscard}>
              <X size={12} />
              Discard
            </button>
            <button type="button" className="is-primary" disabled={stale} onClick={onApply}>
              <Check size={12} />
              Apply {proposal.changes.length === 1 ? 'change' : `${proposal.changes.length} changes`}
            </button>
          </>
        ) : (
          <span className="proposal-status">
            {status === 'applied' ? (
              <>
                <Undo2 size={12} /> Applied as one undo step
              </>
            ) : status === 'superseded' ? (
              'Revised below'
            ) : (
              'Discarded'
            )}
          </span>
        )}
        <span className="proposal-provider">
          {proposal.provider}
          {proposal.credits !== undefined ? ` · ${proposal.credits} credits` : ''}
        </span>
      </footer>
    </article>
  );
}
