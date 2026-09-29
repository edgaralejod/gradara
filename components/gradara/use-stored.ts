'use client';
import { useCallback, useSyncExternalStore } from 'react';

/**
 * A string remembered in this browser's localStorage, read without a hydration
 * mismatch: the server render and the first client render see `null`, and the stored
 * value arrives right after. Storage can be blocked (private windows, policies); the
 * value then lives in memory for the session. Other tabs' changes arrive through the
 * `storage` event.
 */
const memory = new Map<string, string | null>();
const listeners = new Map<string, Set<() => void>>();

function read(key: string) {
  try {
    return localStorage.getItem(key);
  } catch {
    return memory.get(key) ?? null;
  }
}

export function writeStored(key: string, value: string | null) {
  memory.set(key, value);
  try {
    if (value === null) localStorage.removeItem(key);
    else localStorage.setItem(key, value);
  } catch {
    /* Kept in memory only. */
  }
  for (const listener of listeners.get(key) ?? []) listener();
}

export function useStored(key: string) {
  const subscribe = useCallback(
    (listener: () => void) => {
      const set = listeners.get(key) ?? new Set();
      set.add(listener);
      listeners.set(key, set);
      const other = (e: StorageEvent) => {
        if (e.key === key || e.key === null) listener();
      };
      window.addEventListener('storage', other);
      return () => {
        set.delete(listener);
        window.removeEventListener('storage', other);
      };
    },
    [key],
  );
  const value = useSyncExternalStore(
    subscribe,
    () => read(key),
    () => null,
  );
  const write = useCallback(
    (next: string | null) => writeStored(key, next),
    [key],
  );
  return [value, write] as const;
}
