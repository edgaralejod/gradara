'use client';
import { useEffect, useRef, useState } from 'react';
import {
  Sparkles,
  ArrowUp,
  X,
  Check,
  LoaderCircle,
  ArrowRight,
  RotateCcw,
  Plus,
  ChevronRight,
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Textarea } from '@/components/ui/textarea';
import { api, waitForJob, type Job } from '@/lib/gradara/api';
import type { Definition } from '@/lib/gradara/model';
export type ComposerContext = {
  position: { x: number; y: number };
  existing?: { id: string; definition: Definition };
  connection?: { blockId: string; portId: string };
};
export default function AgentComposer({
  context,
  onClose,
  onInsert,
  onBusy,
}: {
  context: ComposerContext;
  onClose: () => void;
  onInsert: (definition: Definition) => void;
  onBusy?: (busy: boolean) => void;
}) {
  const [prompt, setPrompt] = useState('');
  const [busy, setBusy] = useState(false);
  const [preview, setPreview] = useState<Definition | null>(null);
  const [error, setError] = useState('');
  const [seconds, setSeconds] = useState(0);
  const controller = useRef<AbortController | null>(null);
  const jobId = useRef('');
  const promptRef = useRef<HTMLTextAreaElement>(null);
  useEffect(() => {
    promptRef.current?.focus();
    return () => {
      controller.current?.abort();
      if (jobId.current)
        void api(`/jobs/${jobId.current}`, { method: 'DELETE' }).catch(
          () => {},
        );
    };
  }, []);
  useEffect(() => {
    if (!busy) return;
    const t = setInterval(() => setSeconds((s) => s + 1), 1000);
    return () => clearInterval(t);
  }, [busy]);
  async function generate() {
    if (prompt.trim().length < 3 || busy) return;
    setSeconds(0);
    setBusy(true);
    onBusy?.(true);
    setError('');
    setPreview(null);
    controller.current = new AbortController();
    try {
      const job = await api<Job<unknown>>('/components/generate', {
        method: 'POST',
        body: JSON.stringify({
          prompt,
          existing: context.existing?.definition,
        }),
        signal: controller.current.signal,
      });
      jobId.current = job.id;
      const result = await waitForJob<{ definition: Definition }>(
        job.id,
        controller.current.signal,
      );
      setPreview(result.definition);
    } catch (e) {
      if ((e as Error).name !== 'AbortError') setError((e as Error).message);
    } finally {
      setBusy(false);
      onBusy?.(false);
      jobId.current = '';
    }
  }
  return (
    <section
      className="agent-composer nodrag nopan nowheel"
      aria-label="Create a component with an agent"
    >
      <div className="composer-heading">
        <span className="agent-orb">
          <Sparkles size={16} />
        </span>
        <div>
          <strong>
            {context.existing ? 'Refine component' : 'Create a component'}
          </strong>
          <span>
            {context.existing
              ? context.existing.definition.name
              : 'Describe the behavior. We’ll make the block.'}
          </span>
        </div>
        <Button
          size="icon-sm"
          variant="ghost"
          onClick={onClose}
          aria-label="Close component creator"
        >
          <X />
        </Button>
      </div>
      {preview ? (
        <div className="component-preview">
          <span className="preview-checked">
            <Check size={12} />
            Ready to connect
          </span>
          <div className="preview-block">
            <span>{preview.symbol}</span>
            <div>
              <strong>{preview.name}</strong>
              <p>{preview.description}</p>
            </div>
          </div>
          <div className="preview-ports">
            <span>
              {preview.ports
                .filter((p) => p.direction === 'input')
                .map((p) => p.name)
                .join(', ') || 'No inputs'}
            </span>
            <ArrowRight size={14} />
            <span>
              {preview.ports
                .filter((p) => p.direction === 'output')
                .map((p) => p.name)
                .join(', ')}
            </span>
          </div>
          <pre>{preview.equations}</pre>
          <div className="preview-actions">
            <Button variant="ghost" onClick={() => setPreview(null)}>
              <RotateCcw size={13} />
              Revise prompt
            </Button>
            <Button onClick={() => onInsert(preview)}>
              <Plus size={13} />
              {context.existing ? 'Apply changes' : 'Add to model'}
            </Button>
          </div>
        </div>
      ) : (
        <>
          <Textarea
            aria-label="Describe component behavior"
            ref={promptRef}
            value={prompt}
            onChange={(e) => setPrompt(e.target.value)}
            placeholder={
              context.existing
                ? '“Add a rate limit to the output…”'
                : '“A low-pass filter with a 50 ms time constant…”'
            }
            className="composer-input"
            disabled={busy}
            onKeyDown={(e) => {
              if (e.key === 'Enter' && !e.shiftKey) {
                e.preventDefault();
                void generate();
              }
              if (e.key === 'Escape' && !busy) onClose();
            }}
          />
          {!busy && !prompt && (
            <div className="prompt-suggestions">
              {(context.existing
                ? ['Add output saturation', 'Make it run at 1 kHz']
                : ['Low-pass filter', 'Deadband of ±0.1', 'Sine wave at 2 Hz']
              ).map((s) => (
                <button
                  key={s}
                  onClick={() => {
                    setPrompt(s);
                    promptRef.current?.focus();
                  }}
                >
                  {s}
                  <ChevronRight size={11} />
                </button>
              ))}
            </div>
          )}
          {error && (
            <div className="composer-error" role="alert">
              {error}
            </div>
          )}
          <div className="composer-footer">
            <span>
              {busy ? (
                <>
                  <LoaderCircle size={12} className="spin" />
                  {seconds < 8
                    ? 'Writing equations'
                    : seconds < 25
                      ? 'Building your component'
                      : 'Checking the component'}{' '}
                  · {seconds}s
                </>
              ) : (
                <>
                  Codex
                  <span className="tiny-dot" />
                  Uses your local sign-in
                </>
              )}
            </span>
            <Button
              size="icon"
              disabled={busy || prompt.trim().length < 3}
              onClick={() => void generate()}
              aria-label="Generate component"
            >
              {busy ? <LoaderCircle className="spin" /> : <ArrowUp />}
            </Button>
          </div>
        </>
      )}
    </section>
  );
}
