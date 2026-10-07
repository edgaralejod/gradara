'use client';
// SPDX-License-Identifier: Apache-2.0
import { useState } from 'react';
import {
  Activity,
  ArrowUp,
  BadgeCheck,
  CircleHelp,
  LoaderCircle,
  Square,
  Wand2,
} from 'lucide-react';
import { useAi } from '@/lib/gradara/ai';
import { domainColors, type Project } from '@/lib/gradara/model';
import type { Entry } from '@/lib/gradara/proposals-thread';
import {
  evidenceText,
  type Evidence,
  type ExplainResult,
} from '@/lib/gradara/results-discussion';
import type { Busy } from './use-proposals';

type ResultsEntry = Extract<Entry, { kind: 'results' }>;

/**
 * One results discussion: each answer with its evidence (chips that select the
 * signal and zoom the plot), causes marked measured or hypothesis, what was not
 * recorded, next steps, a change to try, and a box for follow-up questions.
 */
export default function ResultsCard({
  entry,
  project,
  busy,
  available,
  onEvidence,
  onFollowUp,
  onPropose,
  onSelect,
  onCancel,
}: {
  entry: ResultsEntry;
  project: Project;
  busy: Busy | null;
  /** Run IDs that still exist; a deleted run's evidence cannot be shown. */
  available: (runId: string) => boolean;
  onEvidence: (runId: string, evidence: Evidence, window: [number, number]) => void;
  onFollowUp: (question: string) => void;
  onPropose: (changePrompt: string, turn: ExplainResult) => void;
  onSelect: (blockIds: string[]) => void;
  onCancel: () => void;
}) {
  const [question, setQuestion] = useState('');
  const { label: price } = useAi('results');
  const editPrice = useAi('edit').label;
  const blocks = new Map(project.blocks.map((b) => [b.id, b]));
  const working = busy?.entryId === entry.id;
  const send = () => {
    const text = question.trim();
    if (text.length < 3 || busy) return;
    onFollowUp(text);
    setQuestion('');
  };
  const titles = entry.context.titles;
  return (
    <article className="proposal-card results-card">
      <header>
        <Activity size={13} />
        <strong>Explain results</strong>
        <span className="results-runs">
          {entry.runIds.map((id, i) => (
            <span key={id} className="results-run" title={titles[id] ?? id}>
              {'ABC'[i]} · {titles[id] ?? 'Run'}
            </span>
          ))}
        </span>
      </header>
      {entry.turns.map((turn, index) => {
        const { answer } = turn.result;
        const chip = (evidence: Evidence, key: string) => {
          const runId = turn.result.runs[evidence.run];
          const signal = turn.result.signals[evidence.signal];
          const usable = !!runId && available(runId);
          return (
            <button
              type="button"
              key={key}
              className="evidence-chip"
              disabled={!usable}
              title={
                usable
                  ? 'Show this on the plot. Gradara recomputed the number from the stored run.'
                  : 'That run was deleted.'
              }
              onClick={() => onEvidence(runId, evidence, turn.result.window)}
            >
              <BadgeCheck size={11} aria-label="Checked" />
              <b>{evidence.run}</b>
              {signal?.name ?? evidence.signal} · {evidenceText(evidence, signal?.unit ?? '')}
            </button>
          );
        };
        return (
          <section key={index} className="results-turn">
            <p className="results-question">{turn.question}</p>
            <p className="proposal-summary">{answer.explanation}</p>
            {answer.findings.length > 0 && (
              <ul className="results-findings">
                {answer.findings.map((f, i) => (
                  <li key={i}>
                    <span>{f.text}</span>
                    {f.evidence.length > 0 && (
                      <span className="evidence-chips">{f.evidence.map((e, j) => chip(e, `${i}-${j}`))}</span>
                    )}
                  </li>
                ))}
              </ul>
            )}
            {answer.causes.length > 0 && (
              <>
                <h4>Likely causes</h4>
                <ol className="results-causes">
                  {answer.causes.map((c, i) => (
                    <li key={i}>
                      <span className={`cause-kind is-${c.kind}`}>
                        {c.kind === 'measured' ? 'Measured' : 'Hypothesis'}
                      </span>
                      <span>{c.text}</span>
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
                        {c.evidence.map((e, j) => chip(e, `c${i}-${j}`))}
                      </span>
                    </li>
                  ))}
                </ol>
              </>
            )}
            {answer.missing.length > 0 && (
              <p className="results-missing">
                <CircleHelp size={12} />
                Not recorded in this run: {answer.missing.join(' ')}
              </p>
            )}
            {answer.nextSteps.length > 0 && (
              <>
                <h4>Next steps</h4>
                <ul className="diagnosis-steps">
                  {answer.nextSteps.map((s, i) => (
                    <li key={i}>{s}</li>
                  ))}
                </ul>
              </>
            )}
            {answer.changePrompt && (
              <div className="results-change">
                <p>
                  <Wand2 size={12} />
                  {answer.changePrompt}
                </p>
                <button
                  type="button"
                  disabled={!!busy}
                  title={editPrice || 'Propose this change as an edit you can review and apply'}
                  onClick={() => onPropose(answer.changePrompt!, turn.result)}
                >
                  Propose this change
                </button>
              </div>
            )}
            <p className="results-meta">
              {answer.removed > 0 &&
                `Gradara removed ${answer.removed} ${answer.removed === 1 ? 'claim' : 'claims'} whose numbers did not match the data. `}
              Numbers marked <BadgeCheck size={10} aria-label="checked" /> were recomputed from the stored run.
              Not for safety-critical decisions.
              <span className="proposal-provider">
                {turn.result.provider}
                {turn.result.credits !== undefined ? ` · ${turn.result.credits} credits` : ''}
              </span>
            </p>
          </section>
        );
      })}
      {working ? (
        <div className="assistant-working">
          <LoaderCircle size={13} className="spin" />
          <span>{busy?.progress || busy?.label}…</span>
          <button type="button" onClick={onCancel}>
            <Square size={10} />
            Cancel
          </button>
        </div>
      ) : (
        <div className="results-follow-up">
          <textarea
            aria-label="Ask a follow-up question"
            placeholder="Ask a follow-up…"
            rows={1}
            maxLength={2000}
            value={question}
            onChange={(e) => setQuestion(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter' && !e.shiftKey && !e.nativeEvent.isComposing) {
                e.preventDefault();
                send();
              }
            }}
          />
          <button
            type="button"
            className="ask-send"
            aria-label="Send follow-up · Enter"
            disabled={question.trim().length < 3 || !!busy || entry.runIds.some((id) => !available(id))}
            onClick={send}
          >
            <ArrowUp size={13} />
          </button>
          <span className="ask-price">{price}</span>
        </div>
      )}
    </article>
  );
}
