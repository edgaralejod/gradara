// SPDX-License-Identifier: Apache-2.0
// Personal features: the workshop (server/workshop.py) builds them, the desktop
// shell (desktop/layers.cjs) checks and loads them. The workbench shows both.
import { api } from './api';

export type LayerFeature = { id: string; title: string; commit?: string };

export type ActiveLayer = {
  id: string;
  base: string;
  dir: string;
  repository: string;
  features: LayerFeature[];
  installedAt: string;
};

export type LayerSnapshot = {
  available: boolean;
  version: string;
  /** The layer this window's service and workbench came from. */
  running: { id: string; features: LayerFeature[] } | null;
  state: {
    active: ActiveLayer | null;
    off: boolean;
    faulty: { id: string; reason: string; at: string } | null;
  };
  /** Why layers are switched off at this launch, if they are. */
  notice: string;
  trusted: { id: string; repository: string }[];
};

export type LayerBridge = {
  getState(): Promise<LayerSnapshot | null>;
  install(request: {
    repository: string;
    archiveUrl: string;
    signatureUrl: string;
  }): Promise<{ ok: boolean; error?: string; active?: ActiveLayer }>;
  switchOn(on: boolean): Promise<LayerSnapshot | null>;
  remove(): Promise<LayerSnapshot | null>;
  trust(request: { repository: string; publicKey: string }): Promise<{ ok: boolean; error?: string }>;
  restart(): Promise<boolean>;
};

declare global {
  interface GradaraDesktopBridge {
    layers?: LayerBridge;
  }
}

export function layerBridge(): LayerBridge | null {
  if (typeof window === 'undefined') return null;
  return window.gradaraDesktop?.layers ?? null;
}

export type WorkshopStatus = {
  repository: string;
  defaultRepository: string;
  tokenSaved: boolean;
  login: string;
  problem: string;
};

export type ScopeAnswer = {
  buildable: boolean;
  personal: boolean;
  summary: string;
  will: string[];
  wont: string[];
  risk: 'low' | 'medium' | 'high';
  estimate: 'small' | 'medium' | 'large';
  reason: string;
  cost: { usd: number };
};

export type WorkshopProgress = {
  requestId: string;
  runId?: number;
  url?: string;
  status: 'queued' | 'in_progress' | 'completed' | 'waiting' | 'requested' | 'pending';
  conclusion?: 'success' | 'failure' | 'cancelled' | 'timed_out' | null;
  stage: string;
  report?: { stage: string; message: string };
  scope?: ScopeAnswer | null;
  cost?: { totalUsd: number; runs: Record<string, { usd: number; turns: number; outcome: string }> } | null;
  review?: { approve: boolean; summary: string } | null;
  layer?: { id: string; base: string } | null;
};

export type PublishedLayer = {
  tag: string;
  id: string;
  title: string;
  published: string;
  archiveUrl: string;
  signatureUrl: string;
  url: string;
  features: LayerFeature[];
};

/** A request the workshop is working on, remembered across restarts in this browser. */
export type TrackedRequest = {
  requestId: string;
  mode: 'scope' | 'build' | 'rebuild';
  request: string;
  title: string;
  budget: number;
  at: number;
};

const TRACKED = 'gradara:workshop-requests';

export function trackedRequests(): TrackedRequest[] {
  try {
    const value = JSON.parse(localStorage.getItem(TRACKED) ?? '[]');
    return Array.isArray(value) ? value.filter((r) => r && typeof r.requestId === 'string') : [];
  } catch {
    return [];
  }
}

export function saveTracked(requests: TrackedRequest[]) {
  try {
    localStorage.setItem(TRACKED, JSON.stringify(requests.slice(-20)));
  } catch {
    /* tracking is a convenience: the runs stay on GitHub */
  }
}

export function startWorkshop(body: {
  mode: 'scope' | 'build' | 'rebuild';
  request?: string;
  title?: string;
  budget?: number;
  stack?: LayerFeature[];
}) {
  return api<{ requestId: string }>('/workshop/requests', {
    method: 'POST',
    body: JSON.stringify(body),
  });
}

/** Whether a finished request published a layer. */
export function succeeded(progress: WorkshopProgress) {
  return progress.status === 'completed' && progress.conclusion === 'success';
}

/** A one-line description of where a request is. */
export function progressText(progress: WorkshopProgress): string {
  if (progress.status !== 'completed') return `${progress.stage}…`;
  if (progress.conclusion === 'success') return progress.report?.stage === 'published' ? 'Ready' : 'Done';
  if (progress.conclusion === 'cancelled') return 'Cancelled';
  return progress.report?.message || 'Failed. Open the run on GitHub for the details.';
}

/** "$2.37" */
export function dollars(value: number | undefined) {
  return `$${(value ?? 0).toFixed(2)}`;
}
