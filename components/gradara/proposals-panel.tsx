'use client';
// SPDX-License-Identifier: Apache-2.0
import { useEffect, useRef, useState } from 'react';
import { CircleAlert, LoaderCircle, Settings, Sparkles, Square, Stethoscope, Trash2 } from 'lucide-react';
import type { AskAction, AskContext } from '@/lib/gradara/ask';
import { domainColors, type Project } from '@/lib/gradara/model';
import type { DiagnoseResult, Entry } from '@/lib/gradara/proposals-thread';
import type { Evidence, ExplainResult } from '@/lib/gradara/results-discussion';
import AskBar, { type AskSubmit } from './ask-bar';
import { BlockDraftCard, ModelDraftCard, UnsupportedCard } from './draft-cards';
import ProposalCard from './proposal-card';
import ResultsCard from './results-card';
import type { Proposals, Revision } from './use-proposals';

const SUGGESTIONS = [
  'Add a speed sensor on the load shaft',
  'Increase the controller gain by 20%',
  'Replace the step reference with a ramp',
];

/**
 * The Proposals tab: every AI answer for this model as a card, kept on this
 * computer, with the Ask bar docked underneath. Nothing changes the model until
 * you choose Apply, Add or Open on a card.
 */
export default function ProposalsPanel({
  proposals,
  project,
  context,
  names,
  opening,
  onAsk,
  onApply,
  onApplyBlock,
  canApplyBlock,
  onOpenModel,
  onSelect,
  onOpenSettings,
  onImprove,
  onBuildFeature,
  onEvidence,
  onPropose,
  runAvailable,
  onPreview,
}: {
  proposals: Proposals;
  project: Project;
  /** What the docked bar would send: the selection, or the runs on show. */
  context: AskContext;
  names: (id: string) => string | undefined;
  /** The model card being opened. */
  opening: string;
  onAsk: (request: AskSubmit, revision?: Revision) => void;
  onApply: (entry: Extract<Entry, { kind: 'proposal' }>) => boolean;
  onApplyBlock: (entry: Extract<Entry, { kind: 'block' }>) => boolean;
  canApplyBlock: (entry: Extract<Entry, { kind: 'block' }>) => boolean;
  onOpenModel: (entry: Extract<Entry, { kind: 'model' }>) => void;
  onSelect: (blockIds: string[]) => void;
  onOpenSettings: () => void;
  onImprove: (entry: Extract<Entry, { kind: 'unsupported' }>) => void;
  onBuildFeature: (entry: Extract<Entry, { kind: 'unsupported' }>) => void;
  onEvidence: (runId: string, evidence: Evidence, window: [number, number]) => void;
  onPropose: (entry: Extract<Entry, { kind: 'results' }>, changePrompt: string, turn: ExplainResult) => void;
  runAvailable: (runId: string) => boolean;
  onPreview: (context: AskContext, question: string) => Promise<string>;
}) {
  const { entries, busy } = proposals;
  // Chips removed in the docked bar apply until the context itself changes.
  const contextKey = JSON.stringify(context);
  const [edited, setEdited] = useState<{ key: string; value: AskContext } | null>(null);
  const current = edited?.key === contextKey ? edited.value : context;
  const [action, setAction] = useState<AskAction | undefined>();
  // The proposal being revised, remembered with its model so it never carries over to another one.
  const [revisingIn, setRevisingIn] = useState({ model: '', id: '' });
  const revisingId = revisingIn.model === (project.modelId ?? '') ? revisingIn.id : '';
  const setRevisingId = (id: string) => setRevisingIn({ model: project.modelId ?? '', id });
  const revising = entries.find(
    (e): e is Extract<Entry, { kind: 'proposal' }> =>
      e.id === revisingId && e.kind === 'proposal' && e.status === 'pending',
  );
  const thread = useRef<HTMLDivElement>(null);
  const latest = entries.length + (busy ? 1 : 0);
  useEffect(() => {
    // Keep the newest answer in view as the thread grows.
    thread.current?.scrollTo({ top: thread.current.scrollHeight, behavior: 'smooth' });
  }, [latest]);
  const [suggestion, setSuggestion] = useState('');

  return (
    <div className="assistant-panel proposals-panel">
      <div className="assistant-thread" aria-live="polite" ref={thread}>
        {proposals.loadError && (
          <div className="assistant-error" role="alert">
            <CircleAlert size={13} />
            <span>{proposals.loadError}</span>
          </div>
        )}
        {!entries.length && (
          <div className="assistant-intro">
            <Sparkles size={15} />
            <div>
              <strong>Ask Gradara.</strong>
              <p>
                Ask for a change to this model, a new block, or a whole model; explain a problem; or, in Results,
                ask why a run looks the way it does. Every answer arrives here as a card you can inspect. Nothing
                changes until you choose Apply. Press A on the canvas to ask where you are.
              </p>
              <div className="assistant-suggestions">
                {SUGGESTIONS.map((s) => (
                  <button type="button" key={s} onClick={() => setSuggestion(s)}>
                    {s}
                  </button>
                ))}
              </div>
            </div>
          </div>
        )}
        {entries.map((entry) => {
          switch (entry.kind) {
            case 'request':
              return (
                <div key={entry.id} className="assistant-request">
                  <span>{entry.text}</span>
                  <em>{entry.scope}</em>
                </div>
              );
            case 'error':
              return (
                <div key={entry.id} className="assistant-error" role="alert">
                  <CircleAlert size={13} />
                  <span>{entry.text}</span>
                  {/settings/i.test(entry.text) && (
                    <button type="button" onClick={onOpenSettings}>
                      <Settings size={12} />
                      Open Settings
                    </button>
                  )}
                </div>
              );
            case 'diagnosis':
              return <DiagnosisCard key={entry.id} result={entry.result} project={project} onSelect={onSelect} />;
            case 'block':
              return (
                <BlockDraftCard
                  key={entry.id}
                  entry={entry}
                  canApply={canApplyBlock(entry)}
                  onApply={() => {
                    if (onApplyBlock(entry)) proposals.setStatus(entry.id, 'applied');
                  }}
                  onDiscard={() => proposals.setStatus(entry.id, 'discarded')}
                />
              );
            case 'model':
              return (
                <ModelDraftCard
                  key={entry.id}
                  entry={entry}
                  opening={opening === entry.id}
                  onOpen={() => onOpenModel(entry)}
                  onDiscard={() => proposals.setStatus(entry.id, 'discarded')}
                />
              );
            case 'unsupported':
              return (
                <UnsupportedCard
                  key={entry.id}
                  entry={entry}
                  onImprove={() => onImprove(entry)}
                  onBuild={() => onBuildFeature(entry)}
                />
              );
            case 'results':
              return (
                <ResultsCard
                  key={entry.id}
                  entry={entry}
                  project={project}
                  busy={busy}
                  available={runAvailable}
                  onEvidence={onEvidence}
                  onFollowUp={(question) => proposals.explainResults(entry.context, question, entry.id)}
                  onPropose={(prompt, turn) => onPropose(entry, prompt, turn)}
                  onSelect={onSelect}
                  onCancel={proposals.cancel}
                />
              );
            case 'proposal':
              return (
                <ProposalCard
                  key={entry.id}
                  proposal={entry.proposal}
                  current={project}
                  status={entry.status}
                  stale={project.revision !== entry.baseRevision}
                  revising={revising?.id === entry.id}
                  onApply={() => {
                    if (onApply(entry)) proposals.setStatus(entry.id, 'applied');
                  }}
                  onDiscard={() => proposals.setStatus(entry.id, 'discarded')}
                  onRefine={() => setRevisingId(revising?.id === entry.id ? '' : entry.id)}
                  onSelect={onSelect}
                />
              );
          }
        })}
        {busy && !busy.entryId && (
          <div className="assistant-working">
            <LoaderCircle size={13} className="spin" />
            <span>{busy.progress || busy.label}…</span>
            <button type="button" onClick={proposals.cancel}>
              <Square size={10} />
              Cancel
            </button>
          </div>
        )}
        {entries.length > 0 && !busy && (
          <button type="button" className="proposals-clear" onClick={proposals.discardAll}>
            <Trash2 size={11} />
            Clear this model’s proposals
          </button>
        )}
      </div>
      <AskBar
        key={suggestion}
        variant="docked"
        context={current}
        onContextChange={(value) => setEdited({ key: contextKey, value })}
        action={action}
        onAction={setAction}
        busy={!!busy}
        names={names}
        initialText={suggestion}
        revising={
          revising
            ? { summary: revising.proposal.summary, onStop: () => setRevisingId('') }
            : undefined
        }
        onPreview={onPreview}
        onSubmit={(request) => {
          onAsk(
            request,
            revising
              ? {
                  entryId: revising.id,
                  previous: {
                    prompt: revising.request,
                    summary: revising.proposal.summary,
                    operations: revising.proposal.operations,
                  },
                }
              : undefined,
          );
          setRevisingId('');
          setSuggestion('');
        }}
        focusOnOpen={!!suggestion || !!revising}
      />
    </div>
  );
}

function DiagnosisCard({
  result,
  project,
  onSelect,
}: {
  result: DiagnoseResult;
  project: Project;
  onSelect: (blockIds: string[]) => void;
}) {
  const blocks = new Map(project.blocks.map((b) => [b.id, b]));
  const { diagnosis } = result;
  return (
    <article className="diagnosis-card">
      <header>
        <Stethoscope size={13} />
        <strong>Diagnosis</strong>
        <span className="proposal-provider">
          {result.provider}
          {result.credits !== undefined ? ` · ${result.credits} credits` : ''}
        </span>
      </header>
      <p className="proposal-summary">{diagnosis.summary}</p>
      {diagnosis.causes.length > 0 && (
        <ol className="diagnosis-causes">
          {diagnosis.causes.map((c, i) => (
            <li key={i}>
              <span>{c.explanation}</span>
              <span className="problem-chips">
                {c.blockIds.map((id) => {
                  const block = blocks.get(id);
                  if (!block) return null;
                  return (
                    <button type="button" key={id} className="problem-chip" onClick={() => onSelect([id])}>
                      <i style={{ background: domainColors[block.definition.domain] }} />
                      {block.definition.name}
                    </button>
                  );
                })}
              </span>
            </li>
          ))}
        </ol>
      )}
      {diagnosis.manualSteps.length > 0 && (
        <>
          <h4>What you can do</h4>
          <ul className="diagnosis-steps">
            {diagnosis.manualSteps.map((s) => (
              <li key={s}>{s}</li>
            ))}
          </ul>
        </>
      )}
      {!diagnosis.fixable && (
        <p className="diagnosis-note">The AI did not find a safe automatic fix for this problem.</p>
      )}
      {result.fixError && <p className="diagnosis-note is-error">A fix was not proposed: {result.fixError}</p>}
    </article>
  );
}
