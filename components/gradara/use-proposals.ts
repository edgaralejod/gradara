'use client';
// SPDX-License-Identifier: Apache-2.0
import { useCallback, useEffect, useRef, useState } from 'react';
import { notifyAiChanged } from '@/lib/gradara/ai';
import { api, waitForJob, type Job } from '@/lib/gradara/api';
import { arrangeBlocks } from '@/lib/gradara/arrange';
import { onRunDeleted } from '@/lib/gradara/inspector-bus';
import { layoutProject } from '@/lib/gradara/auto-layout';
import type { AskAction, RunContext } from '@/lib/gradara/ask';
import type { BlockType } from '@/lib/gradara/block-creation';
import { refreshGeneratedLibrary } from '@/lib/gradara/generated-library';
import { library, type Definition, type Project } from '@/lib/gradara/model';
import type { EditProposal, PreviousProposal } from '@/lib/gradara/proposal';
import {
  entryId,
  sanitizeEntries,
  updateEntry,
  withStatus,
  type DiagnoseResult,
  type Entry,
  type ModelDraft,
  type Placement,
  type ProposalOrigin,
} from '@/lib/gradara/proposals-thread';
import {
  answerText,
  type ExplainResult,
} from '@/lib/gradara/results-discussion';

/** A Refine request: the proposal being revised and what to send back about it. */
export type Revision = { entryId: string; previous: PreviousProposal };

export type Busy = {
  label: string;
  progress: string;
  /** The card a follow-up belongs to; the working line shows inside it. */
  entryId?: string;
};

/** The request line a card answers. */
const request = (text: string, scope: string, action: AskAction) => ({
  id: entryId(),
  at: Date.now(),
  kind: 'request' as const,
  text,
  scope,
  action,
});

/** Generated models get the house-style layout before they are shown. */
const positionDraft = (project: Project): Project =>
  arrangeBlocks(layoutProject(project));

/**
 * The Proposals threads, one per model, saved on this computer. One AI
 * operation runs at a time; its answer lands as a card in the thread of the
 * model it was asked in, even if another model is open by then.
 */
export function useProposals(
  modelId: string | undefined,
  getProject: () => Project,
) {
  const key = modelId ?? '';
  const [threads, setThreads] = useState<Record<string, Entry[]>>({});
  const [busy, setBusy] = useState<Busy | null>(null);
  const [loadError, setLoadError] = useState('');
  const loaded = useRef(new Set<string>());
  const dirty = useRef(new Set<string>());
  const controller = useRef<AbortController | null>(null);
  const jobId = useRef('');
  const entries = threads[key] ?? [];

  useEffect(() => {
    if (!modelId || loaded.current.has(modelId)) return;
    let alive = true;
    api<{ entries: unknown }>(`/proposals/${encodeURIComponent(modelId)}`)
      .then((data) => {
        if (!alive) return;
        loaded.current.add(modelId);
        setLoadError('');
        setThreads((all) => ({
          ...all,
          // Cards that arrived while loading stay after the saved ones.
          [modelId]: [...sanitizeEntries(data.entries), ...(all[modelId] ?? [])],
        }));
      })
      .catch((e: Error) => {
        if (!alive) return;
        loaded.current.add(modelId);
        setLoadError(`Earlier proposals could not be read: ${e.message}`);
      });
    return () => {
      alive = false;
    };
  }, [modelId]);

  // A deleted run takes its discussions with it (the service removes them from disk too).
  useEffect(
    () =>
      onRunDeleted((runId) =>
        setThreads((all) =>
          Object.fromEntries(
            Object.entries(all).map(([model, list]) => [
              model,
              list.filter((e) => !(e.kind === 'results' && e.runIds.includes(runId))),
            ]),
          ),
        ),
      ),
    [],
  );

  // Save changed threads shortly after they change.
  useEffect(() => {
    const models = [...dirty.current].filter((id) => loaded.current.has(id));
    if (!models.length) return;
    const timer = setTimeout(() => {
      for (const id of models) {
        dirty.current.delete(id);
        void api(`/proposals/${encodeURIComponent(id)}`, {
          method: 'PUT',
          body: JSON.stringify({ entries: threads[id] ?? [] }),
        }).catch((e: Error) =>
          setLoadError(`Proposals could not be saved: ${e.message}`),
        );
      }
    }, 400);
    return () => clearTimeout(timer);
  }, [threads]);

  const change = useCallback(
    (model: string, next: (list: Entry[]) => Entry[]) => {
      if (model) dirty.current.add(model);
      setThreads((all) => ({ ...all, [model]: next(all[model] ?? []) }));
    },
    [],
  );
  const add = useCallback(
    (model: string, ...items: Entry[]) =>
      change(model, (list) => [...list, ...items]),
    [change],
  );
  const setStatus = useCallback(
    (id: string, status: string) =>
      change(key, (list) => withStatus(list, id, status)),
    [change, key],
  );
  const discardAll = useCallback(() => change(key, () => []), [change, key]);

  /** Run one AI job; `done` turns its result into cards for the thread it was asked in. */
  const run = useCallback(
    async <T,>(
      path: string,
      body: unknown,
      label: string,
      request: Extract<Entry, { kind: 'request' }> | null,
      done: (result: T, baseRevision: number, model: string) => void,
      target?: string,
    ) => {
      if (controller.current) return;
      const model = key;
      const abort = new AbortController();
      controller.current = abort;
      const baseRevision = getProject().revision;
      if (request) add(model, request);
      setBusy({ label, progress: '', entryId: target });
      try {
        const job = await api<Job<T>>(path, {
          method: 'POST',
          body: JSON.stringify(body),
        });
        jobId.current = job.id;
        const result = await waitForJob<T>(job.id, abort.signal, (progress) =>
          setBusy({ label, progress, entryId: target }),
        );
        done(result, baseRevision, model);
      } catch (e) {
        if ((e as Error).name !== 'AbortError')
          add(model, {
            id: entryId(),
            at: Date.now(),
            kind: 'error',
            text: (e as Error).message,
          });
      } finally {
        notifyAiChanged();
        controller.current = null;
        jobId.current = '';
        setBusy(null);
      }
    },
    [add, getProject, key],
  );

  const cancel = useCallback(() => {
    controller.current?.abort();
    if (jobId.current)
      void api(`/jobs/${jobId.current}`, { method: 'DELETE' }).catch(() => {});
  }, []);

  const edit = useCallback(
    (
      prompt: string,
      body: Record<string, unknown>,
      scope: string,
      revision?: Revision,
      origin?: ProposalOrigin,
    ) =>
      run<EditProposal | { unsupported: string }>(
        '/models/edit',
        { prompt, ...body, previous: revision?.previous },
        revision ? 'Revising the proposal' : 'Editing the model',
        request(prompt, scope, 'edit'),
        (result, baseRevision, model) => {
          if ('unsupported' in result) {
            add(model, {
              id: entryId(),
              at: Date.now(),
              kind: 'unsupported',
              request: revision
                ? `${revision.previous.prompt}\nRevised: ${prompt}`
                : prompt,
              reason: result.unsupported,
            });
            return;
          }
          // The revision replaces the proposal it was made from.
          if (revision)
            change(model, (list) => withStatus(list, revision.entryId, 'superseded'));
          add(model, {
            id: entryId(),
            at: Date.now(),
            kind: 'proposal',
            // A later Refine restates the whole intent, not only the last revision.
            request: revision
              ? `${revision.previous.prompt}\nRevised: ${prompt}`.slice(0, 4000)
              : prompt,
            proposal: result,
            baseRevision,
            status: 'pending',
            ...(origin ? { origin } : {}),
          });
        },
      ),
    [run, add, change],
  );

  const diagnose = useCallback(
    (body: Record<string, unknown>, text: string, scope: string) =>
      run<DiagnoseResult>(
        '/diagnose',
        body,
        body.proposeFix ? 'Finding a fix' : 'Explaining the problem',
        request(text, scope, body.proposeFix ? 'fix' : 'explain'),
        (result, baseRevision, model) => {
          add(model, { id: entryId(), at: Date.now(), kind: 'diagnosis', result });
          if (result.proposal)
            add(model, {
              id: entryId(),
              at: Date.now(),
              kind: 'proposal',
              request: text,
              proposal: result.proposal,
              baseRevision,
              status: 'pending',
            });
        },
      ),
    [run, add],
  );

  const createBlock = useCallback(
    (
      prompt: string,
      blockType: BlockType,
      scope: string,
      existing?: { id: string; definition: Definition },
      placement?: Placement,
    ) =>
      run<{ definition: Definition; provider: string; credits?: number }>(
        '/components/generate',
        { prompt, blockType, existing: existing?.definition },
        existing ? 'Refining the block' : 'Creating the block',
        request(prompt, scope, existing ? 'refine-block' : 'block'),
        (result, _revision, model) => {
          refreshGeneratedLibrary();
          add(model, {
            id: entryId(),
            at: Date.now(),
            kind: 'block',
            request: prompt,
            blockType,
            definition: result.definition,
            ...(existing ? { refines: existing.id } : {}),
            ...(placement ? { placement } : {}),
            provider: result.provider,
            ...(result.credits !== undefined ? { credits: result.credits } : {}),
            status: 'pending',
          });
        },
      ),
    [run, add],
  );

  const buildModel = useCallback(
    (prompt: string) =>
      run<ModelDraft>(
        '/models/generate',
        { prompt, catalog: library },
        'Building the model',
        request(prompt, 'Build model · opens as a new model', 'model'),
        (result, _revision, model) => {
          refreshGeneratedLibrary();
          add(model, {
            id: entryId(),
            at: Date.now(),
            kind: 'model',
            request: prompt,
            draft: { ...result, project: positionDraft(result.project) },
            status: 'pending',
          });
        },
      ),
    [run, add],
  );

  /** Ask about runs; with `followUp`, the question continues that card's discussion. */
  const explainResults = (context: RunContext, question: string, followUp?: string) => {
      const card = followUp
        ? entries.find((e) => e.id === followUp && e.kind === 'results')
        : undefined;
      const turns = card?.kind === 'results' ? card.turns : [];
      const ctx = card?.kind === 'results' ? card.context : context;
      return run<ExplainResult>(
        '/results/explain',
        {
          modelId: ctx.modelId,
          runIds: ctx.runIds,
          baseline: ctx.baseline ?? null,
          signals: ctx.signals,
          window: ctx.window ?? null,
          question,
          thread: turns.slice(-4).map((t) => ({
            question: t.question,
            answer: answerText(t.result.answer),
          })),
        },
        followUp ? 'Answering the follow-up' : 'Explaining the results',
        null,
        (result, _revision, model) => {
          if (card)
            change(model, (list) =>
              updateEntry(list, card.id, (e) =>
                e.kind === 'results'
                  ? { ...e, turns: [...e.turns, { question, result }] }
                  : e,
              ),
            );
          else
            add(model, {
              id: entryId(),
              at: Date.now(),
              kind: 'results',
              runIds: ctx.runIds,
              context: ctx,
              turns: [{ question, result }],
            });
        },
        followUp,
      );
  };

  return {
    entries,
    busy,
    loadError,
    edit,
    diagnose,
    createBlock,
    buildModel,
    explainResults,
    cancel,
    setStatus,
    discardAll,
  };
}

export type Proposals = ReturnType<typeof useProposals>;
