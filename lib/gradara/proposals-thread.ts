// SPDX-License-Identifier: Apache-2.0
/**
 * The Proposals tab: one thread per model of everything the AI answered, kept
 * on this computer (GET/PUT /api/proposals/{modelId}). Every answer is a card
 * you can inspect and act on; a thread is the history of those cards.
 */
import type { Diagnostic } from './api';
import type { AskAction, RunContext } from './ask';
import type { BlockType } from './block-creation';
import type { Definition, Project } from './model';
import type { EditProposal } from './proposal';
import type { ResultsTurn } from './results-discussion';

export type ProposalStatus = 'pending' | 'applied' | 'discarded' | 'superseded';

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

export type ModelDraft = {
  project: Project;
  assumptions: string[];
  generated: { id: string; libraryId: string; name: string }[];
  reused: string[];
  samples: number;
};

/** Where a created block goes when the user adds it. */
export type Placement = {
  position: { x: number; y: number };
  connection?: { blockId: string; portId: string };
  /** The sheet it was asked on (subsystem path); empty for the top level. */
  sheet: string[];
};

/** The results discussion a proposal came from: after Apply and Run, the new run is compared with it. */
export type ProposalOrigin = { runId: string; signals: string[] };

export type Entry =
  | { id: string; at: number; kind: 'request'; text: string; scope: string; action?: AskAction }
  | { id: string; at: number; kind: 'error'; text: string }
  | { id: string; at: number; kind: 'diagnosis'; result: DiagnoseResult }
  | {
      id: string;
      at: number;
      kind: 'proposal';
      /** What the user asked for; Refine sends it back with the proposal. */
      request: string;
      proposal: EditProposal;
      baseRevision: number;
      status: ProposalStatus;
      origin?: ProposalOrigin;
    }
  | {
      id: string;
      at: number;
      kind: 'block';
      request: string;
      blockType: BlockType;
      definition: Definition;
      /** Set when refining a block on the sheet. */
      refines?: string;
      placement?: Placement;
      provider: string;
      credits?: number;
      status: 'pending' | 'applied' | 'discarded';
    }
  | {
      id: string;
      at: number;
      kind: 'model';
      request: string;
      draft: ModelDraft;
      status: 'pending' | 'applied' | 'discarded';
    }
  | {
      id: string;
      at: number;
      kind: 'results';
      runIds: string[];
      context: RunContext;
      turns: ResultsTurn[];
    }
  | {
      id: string;
      at: number;
      kind: 'unsupported';
      request: string;
      reason: string;
    };

export type EntryKind = Entry['kind'];

const KINDS = new Set<EntryKind>([
  'request',
  'error',
  'diagnosis',
  'proposal',
  'block',
  'model',
  'results',
  'unsupported',
]);

let counter = 0;
/** A fresh entry ID, unique across sessions (threads are saved). */
export function entryId(): string {
  counter += 1;
  return `e${Date.now().toString(36)}${counter.toString(36)}${Math.random().toString(36).slice(2, 6)}`;
}

/** Entries read back from disk: unknown kinds and malformed rows are dropped, never trusted. */
export function sanitizeEntries(raw: unknown): Entry[] {
  if (!Array.isArray(raw)) return [];
  return raw.filter((item): item is Entry => {
    if (!item || typeof item !== 'object') return false;
    const e = item as Partial<Entry>;
    if (typeof e.id !== 'string' || !KINDS.has(e.kind as EntryKind)) return false;
    switch (e.kind) {
      case 'proposal':
        return !!(e as { proposal?: unknown }).proposal;
      case 'block':
        return !!(e as { definition?: unknown }).definition;
      case 'model':
        return !!(e as { draft?: { project?: unknown } }).draft?.project;
      case 'results':
        return (
          Array.isArray((e as { turns?: unknown }).turns) &&
          Array.isArray((e as { runIds?: unknown }).runIds)
        );
      case 'diagnosis':
        return !!(e as { result?: unknown }).result;
      default:
        return true;
    }
  });
}

/** Change one entry by ID. */
export function updateEntry(
  entries: Entry[],
  id: string,
  change: (entry: Entry) => Entry,
): Entry[] {
  return entries.map((e) => (e.id === id ? change(e) : e));
}

/** Set the status of a proposal, block or model card. */
export function withStatus(entries: Entry[], id: string, status: string): Entry[] {
  return updateEntry(entries, id, (e) =>
    e.kind === 'proposal' || e.kind === 'block' || e.kind === 'model'
      ? ({ ...e, status } as Entry)
      : e,
  );
}

/** Problems a diagnosis was about, kept small enough to save. */
export function problemSummary(diagnostics: Diagnostic[]): string {
  return diagnostics.length === 1
    ? diagnostics[0].message
    : `${diagnostics.length} problems`;
}
