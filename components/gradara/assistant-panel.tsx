'use client';
import { useCallback, useEffect, useRef, useState } from 'react';
import {
  ArrowUp,
  CircleAlert,
  LoaderCircle,
  Settings,
  Sparkles,
  Square,
  Stethoscope,
} from 'lucide-react';
import { api, waitForJob, type Job } from '@/lib/gradara/api';
import { notifyAiChanged, useAiLabel, type AiOperation } from '@/lib/gradara/ai';
import { domainColors, type Project } from '@/lib/gradara/model';
import type { EditProposal } from '@/lib/gradara/proposal';
import ProposalCard, { type ProposalStatus } from './proposal-card';

export type Diagnosis = {
  summary: string;
  causes: { diagnosticIds: string[]; blockIds: string[]; explanation: string }[];
  fixable: boolean;
  manualSteps: string[];
};
export type DiagnoseResult = {
  diagnosis: Diagnosis;
  proposal: EditProposal | null;
  provider: string;
  credits?: number;
  /** Set when a fix was requested but the edit could not be built. */
  fixError?: string;
};

type Entry =
  | { id: string; kind: 'request'; text: string; scope: string }
  | { id: string; kind: 'error'; text: string }
  | { id: string; kind: 'diagnosis'; result: DiagnoseResult }
  | {
      id: string;
      kind: 'proposal';
      proposal: EditProposal;
      baseRevision: number;
      status: ProposalStatus;
    };

let counter = 0;
const nextId = () => `e${++counter}`;

/** The Assistant thread for the open model: local, cleared on model switch, never saved. */
export function useAssistant(
  modelId: string | undefined,
  getProject: () => Project,
) {
  const key = modelId ?? 'workspace';
  const [threads, setThreads] = useState<Record<string, Entry[]>>({});
  const [busy, setBusy] = useState<{ label: string; progress: string } | null>(
    null,
  );
  const controller = useRef<AbortController | null>(null);
  const jobId = useRef('');
  const entries = threads[key] ?? [];
  const add = useCallback(
    (...items: Entry[]) =>
      setThreads((all) => ({ [key]: [...(all[key] ?? []), ...items] })),
    [key],
  );
  const setStatus = useCallback(
    (id: string, status: ProposalStatus) =>
      setThreads((all) => ({
        [key]: (all[key] ?? []).map((e) =>
          e.id === id && e.kind === 'proposal' ? { ...e, status } : e,
        ),
      })),
    [key],
  );

  const run = useCallback(
    async <T,>(
      path: string,
      body: unknown,
      label: string,
      request: { text: string; scope: string },
      done: (result: T, baseRevision: number) => Entry[],
    ) => {
      if (controller.current) return;
      const abort = new AbortController();
      controller.current = abort;
      const baseRevision = getProject().revision;
      add({ id: nextId(), kind: 'request', ...request });
      setBusy({ label, progress: '' });
      try {
        const job = await api<Job<T>>(path, {
          method: 'POST',
          body: JSON.stringify(body),
        });
        jobId.current = job.id;
        const result = await waitForJob<T>(job.id, abort.signal, (progress) =>
          setBusy({ label, progress }),
        );
        add(...done(result, baseRevision));
      } catch (e) {
        if ((e as Error).name !== 'AbortError')
          add({ id: nextId(), kind: 'error', text: (e as Error).message });
      } finally {
        notifyAiChanged();
        controller.current = null;
        jobId.current = '';
        setBusy(null);
      }
    },
    [add, getProject],
  );

  const cancel = useCallback(() => {
    controller.current?.abort();
    if (jobId.current)
      void api(`/jobs/${jobId.current}`, { method: 'DELETE' }).catch(() => {});
  }, []);

  const edit = useCallback(
    (prompt: string, body: Record<string, unknown>, scope: string) =>
      run<EditProposal>(
        '/models/edit',
        { prompt, ...body },
        'Editing the model',
        { text: prompt, scope },
        (proposal, baseRevision) => [
          {
            id: nextId(),
            kind: 'proposal',
            proposal,
            baseRevision,
            status: 'pending',
          },
        ],
      ),
    [run],
  );

  const diagnose = useCallback(
    (body: Record<string, unknown>, text: string, scope: string) =>
      run<DiagnoseResult>(
        '/diagnose',
        body,
        body.proposeFix ? 'Finding a fix' : 'Explaining the problem',
        { text, scope },
        (result, baseRevision) => [
          { id: nextId(), kind: 'diagnosis', result },
          ...(result.proposal
            ? [
                {
                  id: nextId(),
                  kind: 'proposal' as const,
                  proposal: result.proposal,
                  baseRevision,
                  status: 'pending' as const,
                },
              ]
            : []),
        ],
      ),
    [run],
  );

  return { entries, busy, edit, diagnose, cancel, setStatus };
}

export type Assistant = ReturnType<typeof useAssistant>;

const SUGGESTIONS = [
  'Add a scope on the measured output and connect it',
  'Increase the controller gain by 20%',
  'Replace the step reference with a ramp',
];

export default function AssistantPanel({
  assistant,
  project,
  selectedIds,
  onEdit,
  onApply,
  onSelect,
  onOpenSettings,
}: {
  assistant: Assistant;
  project: Project;
  selectedIds: string[];
  onEdit: (prompt: string, selection: string[]) => void;
  onApply: (proposal: EditProposal, baseRevision: number) => boolean;
  onSelect: (blockIds: string[]) => void;
  onOpenSettings: () => void;
}) {
  const [prompt, setPrompt] = useState('');
  const [useSelection, setUseSelection] = useState(true);
  const input = useRef<HTMLTextAreaElement>(null);
  const thread = useRef<HTMLDivElement>(null);
  const latest = assistant.entries.length + (assistant.busy ? 1 : 0);
  useEffect(() => {
    // Keep the newest answer in view as the thread grows.
    thread.current?.scrollTo({ top: thread.current.scrollHeight, behavior: 'smooth' });
  }, [latest]);
  const editLabel = useAiLabel('edit');
  const busyOperation: AiOperation = assistant.busy?.label.startsWith('Explain')
    ? 'diagnose'
    : assistant.busy?.label.startsWith('Finding')
      ? 'fix'
      : 'edit';
  const busyLabel = useAiLabel(busyOperation);
  const selection = useSelection ? selectedIds : [];
  const blocks = new Map(project.blocks.map((b) => [b.id, b]));
  const submit = () => {
    const text = prompt.trim();
    if (text.length < 3 || assistant.busy) return;
    onEdit(text, selection);
    setPrompt('');
  };

  return (
    <div className="assistant-panel">
      <div className="assistant-thread" aria-live="polite" ref={thread}>
        {!assistant.entries.length && (
          <div className="assistant-intro">
            <Sparkles size={15} />
            <div>
              <strong>Ask for a change to this model.</strong>
              <p>
                The assistant proposes edits to blocks, parameters, and
                connections, checks them in OpenModelica, and waits for you to
                apply them. Nothing changes until you choose Apply.
              </p>
              <div className="assistant-suggestions">
                {SUGGESTIONS.map((s) => (
                  <button
                    type="button"
                    key={s}
                    onClick={() => {
                      setPrompt(s);
                      input.current?.focus();
                    }}
                  >
                    {s}
                  </button>
                ))}
              </div>
            </div>
          </div>
        )}
        {assistant.entries.map((entry) => {
          if (entry.kind === 'request')
            return (
              <div key={entry.id} className="assistant-request">
                <span>{entry.text}</span>
                <em>{entry.scope}</em>
              </div>
            );
          if (entry.kind === 'error')
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
          if (entry.kind === 'diagnosis')
            return (
              <DiagnosisCard
                key={entry.id}
                result={entry.result}
                project={project}
                onSelect={onSelect}
              />
            );
          return (
            <ProposalCard
              key={entry.id}
              proposal={entry.proposal}
              current={project}
              status={entry.status}
              stale={project.revision !== entry.baseRevision}
              onApply={() => {
                if (onApply(entry.proposal, entry.baseRevision))
                  assistant.setStatus(entry.id, 'applied');
              }}
              onDiscard={() => assistant.setStatus(entry.id, 'discarded')}
              onRefine={() => {
                setPrompt(`Revise the proposal: `);
                input.current?.focus();
              }}
              onSelect={onSelect}
            />
          );
        })}
        {assistant.busy && (
          <div className="assistant-working">
            <LoaderCircle size={13} className="spin" />
            <span>
              {assistant.busy.progress || assistant.busy.label}…
            </span>
            <button type="button" onClick={assistant.cancel}>
              <Square size={10} />
              Cancel
            </button>
          </div>
        )}
      </div>
      <div className="assistant-composer">
        <div className="assistant-context">
          <button
            type="button"
            className={!selection.length ? 'is-active' : ''}
            onClick={() => setUseSelection(false)}
          >
            Whole model
          </button>
          {selectedIds.length > 0 && (
            <button
              type="button"
              className={selection.length ? 'is-active' : ''}
              onClick={() => setUseSelection(true)}
              title={selectedIds
                .map((id) => blocks.get(id)?.definition.name)
                .filter(Boolean)
                .join(', ')}
            >
              Selection · {selectedIds.length}{' '}
              {selectedIds.length === 1 ? 'block' : 'blocks'}
            </button>
          )}
        </div>
        <div className="assistant-input">
          <textarea
            ref={input}
            aria-label="Describe a change to this model"
            placeholder="Describe a change to this model…"
            value={prompt}
            maxLength={4000}
            rows={2}
            onChange={(e) => setPrompt(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) {
                e.preventDefault();
                submit();
              }
            }}
          />
          <button
            type="button"
            className="assistant-send"
            aria-label="Send · ⌘Enter"
            title="Send · ⌘Enter"
            disabled={prompt.trim().length < 3 || !!assistant.busy}
            onClick={submit}
          >
            <ArrowUp size={14} />
          </button>
        </div>
        <span className="assistant-footer">
          {assistant.busy ? busyLabel : editLabel}
        </span>
      </div>
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
                    <button
                      type="button"
                      key={id}
                      className="problem-chip"
                      onClick={() => onSelect([id])}
                    >
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
        <p className="diagnosis-note">
          The assistant did not find a safe automatic fix for this problem.
        </p>
      )}
      {result.fixError && (
        <p className="diagnosis-note is-error">
          A fix was not proposed: {result.fixError}
        </p>
      )}
    </article>
  );
}

