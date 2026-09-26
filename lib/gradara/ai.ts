// SPDX-License-Identifier: Apache-2.0
'use client';
import { useEffect, useState } from 'react';
import { api } from './api';

export type EngineStatus = {
  backend: 'native' | 'docker';
  preference: 'auto' | 'native' | 'docker';
  recommended: 'native' | 'docker';
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
      prices: { component: number; model: number; export: number };
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

/** Short footer text for AI composers, e.g. "Gradara AI · 2 credits · 38 left". */
export function useAiLabel(kind: 'component' | 'model' | 'export') {
  const [label, setLabel] = useState('');
  useEffect(() => {
    let alive = true;
    const load = async () => {
      try {
        const ai = await api<AiStatus>('/ai');
        if (ai.provider !== 'gradara') {
          if (alive)
            setLabel(
              ai.ready ? ai.label : `${ai.label} · finish setup in Settings`,
            );
          return;
        }
        const account = await api<Account>('/account').catch(
          () => ({ signedIn: false }) as Account,
        );
        if (!alive) return;
        if (!account.signedIn) setLabel('Gradara AI · Sign in from Settings');
        else
          setLabel(
            `Gradara AI · ${account.prices[kind]} credits · ${account.balance} left`,
          );
      } catch {
        if (alive) setLabel('');
      }
    };
    void load();
    window.addEventListener(AI_CHANGED, load);
    return () => {
      alive = false;
      window.removeEventListener(AI_CHANGED, load);
    };
  }, [kind]);
  return label;
}

export function openExternal(url: string) {
  // Electron routes window.open to the system browser; browsers open a tab.
  window.open(url, '_blank', 'noopener,noreferrer');
}
