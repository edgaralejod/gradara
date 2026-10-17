'use client';
import { useCallback, useEffect, useRef } from 'react';
import { api, waitForJob } from '@/lib/gradara/api';
import { useAi } from '@/lib/gradara/ai';
import { refreshGeneratedLibrary } from '@/lib/gradara/generated-library';
import type { SymbolGlyph } from '@/lib/gradara/glyph';
import type { Block, Definition } from '@/lib/gradara/model';
import { SymbolEditor } from './symbol-editor';
import type { SymbolEditorProps } from './symbol-editor-types';

/**
 * The symbol editor as the workbench opens it: the AI drawing runs as an ordinary
 * `component` job (POST /api/components/symbol, priced like creating a block), and an
 * AI block's new look can be saved to Library → AI blocks in place of its old entry
 * (POST /api/components/library). Closing the editor cancels a drawing in progress.
 */
export function SymbolEditorHost({
  block,
  standard,
  onApply,
  onClose,
}: {
  block: Block;
  standard?: Definition;
  onApply: SymbolEditorProps['onApply'];
  onClose: () => void;
}) {
  const ai = useAi('component');
  const running = useRef<{ controller: AbortController; job?: string } | null>(
    null,
  );
  const cancel = useCallback(() => {
    const run = running.current;
    running.current = null;
    if (!run) return;
    run.controller.abort();
    if (run.job)
      void api(`/jobs/${run.job}`, { method: 'DELETE' }).catch(() => {});
  }, []);
  useEffect(() => cancel, [cancel]);
  const original = block.definition;
  const askAi = async (description: string, definition: Definition) => {
    cancel();
    const run = { controller: new AbortController() } as {
      controller: AbortController;
      job?: string;
    };
    running.current = run;
    const { id } = await api<{ id: string }>('/components/symbol', {
      method: 'POST',
      body: JSON.stringify({ description, definition }),
      signal: run.controller.signal,
    });
    run.job = id;
    try {
      const result = await waitForJob<{ glyph: SymbolGlyph }>(
        id,
        run.controller.signal,
      );
      return result.glyph;
    } finally {
      if (running.current === run) running.current = null;
    }
  };
  const saveToLibrary = async (definition: Definition) => {
    await api('/components/library', {
      method: 'POST',
      body: JSON.stringify({ definition, original }),
    });
    refreshGeneratedLibrary();
  };
  return (
    <SymbolEditor
      block={block}
      standard={standard}
      onApply={onApply}
      onSaveToLibrary={original.generated ? saveToLibrary : undefined}
      onAskAi={ai.ready ? askAi : undefined}
      aiPrice={ai.label}
      onClose={() => {
        cancel();
        onClose();
      }}
    />
  );
}
