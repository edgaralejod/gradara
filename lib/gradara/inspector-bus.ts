// SPDX-License-Identifier: Apache-2.0
/**
 * How the rest of the workbench talks to the Data Inspector without owning its
 * state: commands (show this evidence, compare these runs) wait until an
 * inspector for that model takes them, and the inspector publishes what it
 * shows so the Ask bar can offer it as context.
 */
import type { RunContext } from './ask';

export type InspectorCommand =
  | {
      type: 'focus';
      modelId: string;
      runId: string;
      key: string;
      /** Zoom to this window; with only `at`, a window around that time. */
      window?: [number, number];
      at?: number;
    }
  | {
      type: 'compare';
      modelId: string;
      /** The new run first, then the run it is compared with. */
      runIds: string[];
      baseline: string;
      signals: string[];
    };

let pending: InspectorCommand | null = null;
const commandListeners = new Set<() => void>();

/** Queue a command; the inspector of that model picks it up now or when it opens. */
export function sendInspectorCommand(command: InspectorCommand) {
  pending = command;
  commandListeners.forEach((listener) => listener());
}

/** Take the queued command for `modelId`, if there is one. */
export function takeInspectorCommand(modelId: string): InspectorCommand | null {
  if (!pending || pending.modelId !== modelId) return null;
  const command = pending;
  pending = null;
  return command;
}

export function onInspectorCommand(listener: () => void) {
  commandListeners.add(listener);
  return () => {
    commandListeners.delete(listener);
  };
}

let shown: RunContext | null = null;
const contextListeners = new Set<() => void>();

/** What the open Data Inspector shows; null when none is open or nothing is shown. */
export function publishInspectorContext(context: RunContext | null) {
  if (JSON.stringify(context) === JSON.stringify(shown)) return;
  shown = context;
  contextListeners.forEach((listener) => listener());
}

export function inspectorContext(): RunContext | null {
  return shown;
}

export function onInspectorContext(listener: () => void) {
  contextListeners.add(listener);
  return () => {
    contextListeners.delete(listener);
  };
}

/** A window around `at` that shows a few percent of the run on each side. */
export function windowAround(
  at: number,
  duration: number,
  share = 0.08,
): [number, number] {
  const half = Math.max(duration * share, 1e-12) / 2;
  let start = Math.max(0, at - half);
  let end = Math.min(duration, at + half);
  if (end - start < 2 * half) {
    if (start === 0) end = Math.min(duration, 2 * half);
    else start = Math.max(0, end - 2 * half);
  }
  return [start, end];
}

/** A window widened slightly so its edges are visible on the plot. */
export function padWindow(
  window: [number, number],
  duration: number,
): [number, number] {
  const span = Math.max(window[1] - window[0], duration * 0.02);
  const pad = span * 0.1;
  return [Math.max(0, window[0] - pad), Math.min(duration, window[1] + pad)];
}

const askListeners = new Set<(context: RunContext) => void>();

/** "Ask about this run": open the Ask bar with the runs on show. */
export function askAboutRuns(context: RunContext) {
  askListeners.forEach((listener) => listener(context));
}

export function onAskAboutRuns(listener: (context: RunContext) => void) {
  askListeners.add(listener);
  return () => {
    askListeners.delete(listener);
  };
}

const deletedListeners = new Set<(runId: string) => void>();

/** A stored run was deleted: its discussions go with it. */
export function notifyRunDeleted(runId: string) {
  deletedListeners.forEach((listener) => listener(runId));
}

export function onRunDeleted(listener: (runId: string) => void) {
  deletedListeners.add(listener);
  return () => {
    deletedListeners.delete(listener);
  };
}
