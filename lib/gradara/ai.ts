// SPDX-License-Identifier: Apache-2.0
'use client';
import { useEffect, useState } from 'react';
import { api } from './api';

export type EngineStatus = {
  /** bundled: the engine shipped inside the desktop installers. */
  backend: 'bundled' | 'native' | 'docker';
  preference: 'auto' | 'bundled' | 'native' | 'docker';
  recommended: 'bundled' | 'native' | 'docker';
  /** Whether this build carries a built-in engine. */
  bundled: boolean;
  platform: string;
  ready: boolean;
  label: string;
  detail: string;
  actions: string[];
  version: string;
};

export type AiProvider = 'gradara' | 'openai' | 'anthropic' | 'codex' | 'off';

export type AiStatus = {
  provider: AiProvider;
  label: string;
  ready: boolean;
  keys: { openai: boolean; anthropic: boolean };
  models: { openai: string; anthropic: string };
  defaultModels: { openai: string; anthropic: string };
  signedIn: boolean;
  codexAvailable: boolean;
  gateway: string;
  credentialStorage: string;
};

export type CreditPack = {
  id: string;
  credits: number;
  amount: number;
  currency: string;
  label: string;
};

export type Account =
  | { signedIn: false }
  | {
      signedIn: true;
      email: string;
      balance: number;
      prices: {
        component: number;
        model: number;
        export: number;
        edit?: number;
        diagnose?: number;
      };
      /** Extra credits per priced part of a job, e.g. each generated block of an edit. */
      surcharges?: { edit?: { block?: number } };
      packs: CreditPack[];
      freeCredits: number;
      last30Days?: { creditsUsed: number; calls: Record<string, number> };
    };

export const AI_CHANGED = 'gradara:ai-changed';

export function notifyAiChanged() {
  window.dispatchEvent(new Event(AI_CHANGED));
}

export function formatPrice(pack: CreditPack) {
  return new Intl.NumberFormat(undefined, {
    style: 'currency',
    currency: pack.currency.toUpperCase(),
  }).format(pack.amount / 100);
}

export type AiOperation =
  'component' | 'model' | 'export' | 'edit' | 'diagnose' | 'fix';

/** The price part of an AI label, or '' when the service did not report one. */
export function priceText(
  account: Extract<Account, { signedIn: true }>,
  kind: AiOperation,
) {
  const block = account.surcharges?.edit?.block;
  const edit =
    account.prices.edit === undefined
      ? ''
      : `${account.prices.edit} credits${block ? `, +${block} per new or rewritten block` : ''}`;
  if (kind === 'edit') return edit;
  if (kind === 'fix')
    return account.prices.diagnose === undefined || !edit
      ? ''
      : `${account.prices.diagnose} credits + edit (${edit})`;
  const price = account.prices[kind];
  return price === undefined ? '' : `${price} credits`;
}

/** Short footer text for AI composers, e.g. "Gradara AI · 2 credits · 38 left". */
/** The AI status for one operation: a short label, and whether a request can be made now. */
export function useAi(kind: AiOperation) {
  const [label, setLabel] = useState('');
  const [ready, setReady] = useState(false);
  useEffect(() => {
    let alive = true;
    const load = async () => {
      try {
        const ai = await api<AiStatus>('/ai');
        if (ai.provider !== 'gradara') {
          if (alive) {
            setReady(!!ai.ready);
            setLabel(
              ai.ready ? ai.label : `${ai.label} · finish setup in Settings`,
            );
          }
          return;
        }
        const account = await api<Account>('/account').catch(
          () => ({ signedIn: false }) as Account,
        );
        if (!alive) return;
        setReady(account.signedIn);
        if (!account.signedIn) setLabel('Gradara AI · Sign in from Settings');
        else {
          const price = priceText(account, kind);
          setLabel(
            price
              ? `Gradara AI · ${price} · ${account.balance} left`
              : `Gradara AI · ${account.balance} credits left`,
          );
        }
      } catch {
        if (alive) {
          setLabel('');
          setReady(false);
        }
      }
    };
    void load();
    window.addEventListener(AI_CHANGED, load);
    return () => {
      alive = false;
      window.removeEventListener(AI_CHANGED, load);
    };
  }, [kind]);
  return { label, ready };
}

export function useAiLabel(kind: AiOperation) {
  return useAi(kind).label;
}

export function openExternal(url: string) {
  // Electron routes window.open to the system browser; browsers open a tab.
  window.open(url, '_blank', 'noopener,noreferrer');
}
