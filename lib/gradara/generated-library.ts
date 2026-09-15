'use client';
import { useEffect, useState } from 'react';
import { api } from './api';
import type { Definition } from './model';
export type GeneratedEntry = {
  id: string;
  definition: Definition;
  checked: boolean;
  createdAt: string;
};
const event = 'gradara-component-library-changed';
export function refreshGeneratedLibrary() {
  window.dispatchEvent(new Event(event));
}
export function useGeneratedLibrary() {
  const [entries, setEntries] = useState<GeneratedEntry[]>([]);
  const [error, setError] = useState('');
  useEffect(() => {
    let alive = true;
    let request = 0;
    const refresh = () => {
      const current = ++request;
      void api<{ components: GeneratedEntry[] }>('/components/library')
        .then((data) => {
          if (alive && current === request) {
            setEntries(data.components);
            setError('');
          }
        })
        .catch((e) => {
          if (alive && current === request) setError((e as Error).message);
        });
    };
    refresh();
    window.addEventListener(event, refresh);
    window.addEventListener('focus', refresh);
    return () => {
      alive = false;
      window.removeEventListener(event, refresh);
      window.removeEventListener('focus', refresh);
    };
  }, []);
  return { entries, error, retry: refreshGeneratedLibrary };
}
