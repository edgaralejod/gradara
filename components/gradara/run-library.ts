'use client';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { notifyRunDeleted } from '@/lib/gradara/inspector-bus';
import { api, type SimulationResult } from '@/lib/gradara/api';
import {
  freeColor,
  maxOpenRuns,
  openRuns,
  type StoredRun,
} from '@/lib/gradara/run-set';

type Loaded = { data?: SimulationResult; error?: string };
type Saved = { chosen: string[]; colors: Record<string, string> };

function savedState(key: string): Saved {
  try {
    const value = JSON.parse(localStorage.getItem(key) ?? 'null') as Saved | null;
    if (
      value &&
      Array.isArray(value.chosen) &&
      value.chosen.every((id) => typeof id === 'string') &&
      value.colors &&
      typeof value.colors === 'object' &&
      Object.values(value.colors).every(
        (c) => typeof c === 'string' && /^#[0-9a-f]{6}$/i.test(c),
      )
    )
      return value;
  } catch {
    /* Run colours are a convenience; start fresh when storage is unavailable. */
  }
  return { chosen: [], colors: {} };
}

/**
 * The stored runs of one model as a library: which are open beside the latest
 * run, the colour each is drawn in, and each open run's full-resolution data.
 * Runs live on disk, so the library outlasts the session; only what is open
 * and the chosen colours are remembered by the browser.
 */
export function useRunLibrary({
  modelId,
  latestId,
  preview,
  enabled,
}: {
  modelId: string | undefined;
  latestId: string;
  /** The latest run as the page holds it: preview samples until the full data arrives. */
  preview: SimulationResult;
  enabled: boolean;
}) {
  const storageKey = `gradara-runs:${modelId ?? 'workspace'}`;
  const [runs, setRuns] = useState<StoredRun[] | null>(null);
  const [listError, setListError] = useState('');
  const [saved, setSaved] = useState<Saved>(() => savedState(storageKey));
  // Hiding the latest run lasts until the next run finishes.
  const [hidden, setHidden] = useState<string | null>(null);
  const [loaded, setLoaded] = useState<Record<string, Loaded>>({});
  const requested = useRef(new Set<string>());
  const [reload, setReload] = useState(0);

  const refresh = useCallback(() => {
    if (!enabled || !modelId) return () => {};
    const abort = new AbortController();
    void api<{ runs: StoredRun[] }>(
      `/results?model=${encodeURIComponent(modelId)}&limit=50`,
      { signal: abort.signal },
    )
      .then(({ runs: list }) => {
        setRuns(list);
        setListError('');
      })
      .catch((e) => {
        if (e.name !== 'AbortError') setListError(e.message);
      });
    return () => abort.abort();
  }, [enabled, modelId]);
  useEffect(() => refresh(), [refresh, latestId]);

  const known = useMemo(() => runs?.map((r) => r.id) ?? null, [runs]);
  const open = useMemo(
    () =>
      enabled
        ? openRuns(latestId, hidden === latestId, saved.chosen, known ?? saved.chosen)
        : [latestId],
    [enabled, latestId, hidden, saved.chosen, known],
  );

  useEffect(() => {
    if (!enabled) return;
    try {
      localStorage.setItem(storageKey, JSON.stringify(saved));
    } catch {
      /* Remembering colours is a convenience. */
    }
  }, [saved, storageKey, enabled]);

  // Each open run's full data is fetched once and kept while the inspector is open.
  useEffect(() => {
    if (!enabled) return;
    for (const id of open) {
      if (requested.current.has(id)) continue;
      requested.current.add(id);
      void api<SimulationResult>(`/results/${id}/data`)
        .then((data) => setLoaded((all) => ({ ...all, [id]: { data } })))
        .catch((e) =>
          setLoaded((all) => ({ ...all, [id]: { error: e.message } })),
        );
    }
  }, [open, enabled, reload]);

  const dataOf = (id: string): SimulationResult | undefined =>
    loaded[id]?.data ?? (id === latestId ? preview : undefined);
  const isFull = (id: string) => !!loaded[id]?.data;
  const errors = open.flatMap((id) =>
    loaded[id]?.error ? [loaded[id].error!] : [],
  );
  const full = open.length >= maxOpenRuns;
  // A run keeps the colour it was given; until then it takes one the other shown runs do not use.
  const colorOf = (id: string) =>
    saved.colors[id] ??
    freeColor(open.filter((o) => o !== id).map((o) => saved.colors[o]).filter(Boolean));

  return {
    runs,
    listError,
    open,
    full,
    errors,
    dataOf,
    isFull,
    colorOf,
    setColor: (id: string, color: string) =>
      setSaved((s) => ({ ...s, colors: { ...s.colors, [id]: color } })),
    setOpen: (id: string, on: boolean) => {
      if (id === latestId) setHidden(on ? null : latestId);
      else
        setSaved((s) => ({
          ...s,
          chosen: on
            ? [...new Set([id, ...s.chosen])]
            : s.chosen.filter((x) => x !== id),
          // Opening a run fixes its colour, so it does not change as other runs come and go.
          colors:
            on && !s.colors[id]
              ? {
                  ...s.colors,
                  [id]: freeColor(open.map(colorOf)),
                }
              : s.colors,
        }));
    },
    retry: () => {
      for (const id of open)
        if (loaded[id]?.error) requested.current.delete(id);
      setLoaded((all) =>
        Object.fromEntries(Object.entries(all).filter(([, v]) => !v.error)),
      );
      setReload((n) => n + 1);
    },
    rename: async (id: string, name: string) => {
      await api(`/results/${id}`, {
        method: 'PATCH',
        body: JSON.stringify({ name }),
      });
      refresh();
    },
    remove: async (id: string) => {
      await api(`/results/${id}`, { method: 'DELETE' });
      notifyRunDeleted(id);
      requested.current.delete(id);
      setSaved((s) => ({ ...s, chosen: s.chosen.filter((x) => x !== id) }));
      setLoaded((all) =>
        Object.fromEntries(Object.entries(all).filter(([k]) => k !== id)),
      );
      refresh();
    },
  };
}
