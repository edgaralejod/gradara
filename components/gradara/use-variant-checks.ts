'use client';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { api, waitForJob, type Diagnostic, type Job } from '@/lib/gradara/api';
import type { Project } from '@/lib/gradara/model';
import { variantInstances } from '@/lib/gradara/variants';

export type VariantCheck = {
  key: string;
  sheetId: string;
  blockId: string;
  variantId: string;
  variant: string;
  name: string;
  ok: boolean;
  message: string;
};

const SETTING = 'gradara.variantChecks';

function readEnabled() {
  try {
    return localStorage.getItem(SETTING) !== 'off';
  } catch {
    return true;
  }
}

/**
 * Compile every inactive variant with the engine after edits settle, one at a
 * time on the local service, so a broken alternative shows in Problems before
 * anyone switches to it. Runs only when the model has variants, the engine is
 * ready, and no simulation is running; it can be turned off.
 */
export function useVariantChecks({
  doc,
  signature,
  engineReady,
  busy,
}: {
  doc: Project;
  signature: string;
  engineReady: boolean;
  busy: boolean;
}) {
  const [enabled, setEnabledState] = useState(readEnabled);
  const [state, setState] = useState<{
    signature: string;
    results: VariantCheck[];
    error: string;
  }>({ signature: '', results: [], error: '' });
  const [running, setRunning] = useState(false);
  const docRef = useRef(doc);
  const signatureRef = useRef(signature);
  useEffect(() => {
    docRef.current = doc;
    signatureRef.current = signature;
  }, [doc, signature]);
  const hasVariants = variantInstances(doc).length > 0;

  const run = useCallback(async () => {
    const snapshot = docRef.current;
    const at = signatureRef.current;
    if (!variantInstances(snapshot).length) return;
    setRunning(true);
    try {
      const job = await api<Job<unknown>>('/variants/check', {
        method: 'POST',
        body: JSON.stringify(snapshot),
      });
      const result = await waitForJob<{ variants: VariantCheck[] }>(job.id);
      setState({ signature: at, results: result.variants, error: '' });
    } catch (e) {
      setState({ signature: at, results: [], error: (e as Error).message });
    } finally {
      setRunning(false);
    }
  }, []);

  useEffect(() => {
    if (!enabled || !engineReady || busy || running || !hasVariants) return;
    if (state.signature === signature) return;
    // Wait until editing pauses; engine time is only spent on a settled model.
    const timer = setTimeout(() => void run(), 8000);
    return () => clearTimeout(timer);
  }, [
    enabled,
    engineReady,
    busy,
    running,
    hasVariants,
    signature,
    state.signature,
    run,
  ]);

  const setEnabled = useCallback((value: boolean) => {
    setEnabledState(value);
    try {
      localStorage.setItem(SETTING, value ? 'on' : 'off');
    } catch {
      // The choice then lasts for this session only.
    }
  }, []);

  const stale = state.signature !== signature;
  const problems = useMemo<Diagnostic[]>(
    () =>
      stale
        ? []
        : state.results
            .filter((r) => !r.ok)
            .map((r) => ({
              id: `variant-compile-${r.key}-${r.variantId}`,
              severity: 'warning' as const,
              source: 'compiler' as const,
              message: `Inactive variant ${r.name} does not compile: ${r.message.split('\n')[0]}`,
              detail: r.message,
              blockIds: r.sheetId ? [] : [r.blockId],
              ports: [],
              netIds: [],
              wireIds: [],
              hint: 'Switch to this variant and fix it, or remove the variant.',
            })),
    [stale, state.results],
  );
  return {
    enabled,
    setEnabled,
    running,
    stale,
    results: stale ? [] : state.results,
    error: stale ? '' : state.error,
    problems,
    run,
  };
}
