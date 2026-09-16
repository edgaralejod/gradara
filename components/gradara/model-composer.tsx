// SPDX-License-Identifier: Apache-2.0
'use client';
import { useEffect, useRef, useState } from 'react';
import { Check, LoaderCircle, Sparkles, X } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Textarea } from '@/components/ui/textarea';
import { api, waitForJob, type Job } from '@/lib/gradara/api';
import { library, domainColors, type Project } from '@/lib/gradara/model';
import {
  defaultBlockSize,
  snapBlockPosition,
} from '@/lib/gradara/block-design';
import { portPoint, sideToPosition } from '@/lib/gradara/ports';
import { pointsToPath, routeBetween } from '@/lib/gradara/routing';
import { refreshGeneratedLibrary } from '@/lib/gradara/generated-library';
import { BlockFace } from './block-face';

type ModelDraft = {
  project: Project;
  assumptions: string[];
  generated: { id: string; libraryId: string; name: string }[];
  reused: string[];
  samples: number;
};

function positionDraft(project: Project): Project {
  const sizes = project.blocks.map((block) =>
    defaultBlockSize(block.definition),
  );
  const pitchX = Math.max(320, ...sizes.map((size) => size.width + 120));
  const pitchY = Math.max(224, ...sizes.map((size) => size.height + 120));
  return {
    ...project,
    blocks: project.blocks.map((block) => {
      const size = defaultBlockSize(block.definition);
      return {
        ...block,
        size,
        position: snapBlockPosition(
          {
            x: (block.position.x / 320) * pitchX + pitchX / 2 - size.width / 2,
            y: (block.position.y / 224) * pitchY + pitchY / 2 - size.height / 2,
          },
          size,
        ),
      };
    }),
  };
}

function DiagramPreview({ project }: { project: Project }) {
  const blocks = new Map(project.blocks.map((block) => [block.id, block]));
  const width =
    Math.max(...project.blocks.map((b) => b.position.x + b.size!.width)) + 80;
  const height =
    Math.max(...project.blocks.map((b) => b.position.y + b.size!.height)) + 80;
  return (
    <svg
      className="model-draft-diagram"
      viewBox={`0 0 ${width} ${height}`}
      aria-label="Generated model diagram"
    >
      {project.wires.map((wire) => {
        const source = blocks.get(wire.source)!,
          target = blocks.get(wire.target)!;
        const a = portPoint(source, wire.sourceHandle)!,
          b = portPoint(target, wire.targetHandle)!;
        const domain = source.definition.ports.find(
          (p) => p.id === wire.sourceHandle,
        )!.domain;
        return (
          <path
            key={wire.id}
            d={pointsToPath(
              routeBetween(
                a,
                b,
                sideToPosition(a.side),
                sideToPosition(b.side),
              ),
            )}
            fill="none"
            stroke={domainColors[domain]}
            strokeWidth={2}
          />
        );
      })}
      {project.blocks.map((block) => (
        <g key={block.id}>
          <foreignObject
            x={block.position.x}
            y={block.position.y}
            width={block.size!.width}
            height={block.size!.height}
          >
            <div
              style={{ position: 'relative', width: '100%', height: '100%' }}
            >
              <BlockFace definition={block.definition} />
            </div>
          </foreignObject>
          <text
            x={block.position.x + block.size!.width / 2}
            y={block.position.y + block.size!.height + 20}
            textAnchor="middle"
            fontSize={14}
          >
            {block.definition.name}
          </text>
        </g>
      ))}
    </svg>
  );
}

export default function ModelComposer({
  onClose,
  onBlockMode,
  onInsert,
}: {
  onClose: () => void;
  onBlockMode: () => void;
  onInsert: (project: Project) => Promise<void>;
}) {
  const [prompt, setPrompt] = useState('');
  const [busy, setBusy] = useState(false);
  const [opening, setOpening] = useState(false);
  const [progress, setProgress] = useState('');
  const [error, setError] = useState('');
  const [draft, setDraft] = useState<ModelDraft | null>(null);
  const controller = useRef<AbortController | null>(null);
  const jobId = useRef('');
  useEffect(
    () => () => {
      controller.current?.abort();
      if (jobId.current)
        void api(`/jobs/${jobId.current}`, { method: 'DELETE' }).catch(
          () => {},
        );
    },
    [],
  );
  async function generate() {
    if (busy || prompt.trim().length < 3) return;
    setBusy(true);
    setError('');
    setDraft(null);
    setProgress('Starting model builder');
    const abort = new AbortController();
    controller.current = abort;
    try {
      // Keep the response so a close during POST can still cancel the queued job.
      const job = await api<Job<ModelDraft>>('/models/generate', {
        method: 'POST',
        body: JSON.stringify({ prompt, catalog: library }),
      });
      jobId.current = job.id;
      if (abort.signal.aborted) {
        await api(`/jobs/${job.id}`, { method: 'DELETE' });
        return;
      }
      const result = await waitForJob<ModelDraft>(
        job.id,
        abort.signal,
        setProgress,
      );
      setDraft({ ...result, project: positionDraft(result.project) });
    } catch (e) {
      if ((e as Error).name !== 'AbortError') setError((e as Error).message);
    } finally {
      jobId.current = '';
      setBusy(false);
      refreshGeneratedLibrary();
    }
  }
  async function open() {
    if (!draft || opening) return;
    setOpening(true);
    setError('');
    try {
      await onInsert(draft.project);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setOpening(false);
    }
  }
  return (
    <section
      className="agent-composer model-composer nodrag nopan nowheel"
      aria-label="Create a model with an agent"
    >
      <div className="composer-heading">
        <span className="agent-orb">
          <Sparkles size={16} />
        </span>
        <div>
          <strong>Create a model</strong>
          <span>
            Reuse the library. Create what’s missing. Connect and simulate.
          </span>
        </div>
        <Button
          size="icon-sm"
          variant="ghost"
          disabled={opening}
          onClick={onClose}
          aria-label="Close model creator"
        >
          <X />
        </Button>
      </div>
      <div className="model-composer-body">
        <div className="model-mode-switch">
          <Button
            variant="ghost"
            disabled={busy || opening}
            onClick={onBlockMode}
          >
            Single block
          </Button>
          <span>Full model / circuit</span>
        </div>
        {draft ? (
          <>
            <span className="preview-checked">
              <Check size={12} />
              Simulation completed · {draft.samples.toLocaleString()} samples
            </span>
            <h3>{draft.project.name}</h3>
            <p>{draft.project.description}</p>
            <DiagramPreview project={draft.project} />
            <p>
              {draft.project.blocks.length} blocks ·{' '}
              {draft.project.wires.length} connections ·{' '}
              {draft.project.duration} s
            </p>
            <details>
              <summary>Library choices and assumptions</summary>
              <p>
                <strong>Reused:</strong> {draft.reused.join(', ') || 'None'}
              </p>
              <p>
                <strong>Created in AI blocks:</strong>{' '}
                {draft.generated.map((b) => b.name).join(', ') || 'None needed'}
              </p>
              <ul>
                {draft.assumptions.map((item, i) => (
                  <li key={i}>{item}</li>
                ))}
              </ul>
            </details>
            <div className="preview-actions">
              <Button
                variant="ghost"
                disabled={opening}
                onClick={() => setDraft(null)}
              >
                Revise request
              </Button>
              <Button disabled={opening} onClick={() => void open()}>
                {opening ? 'Opening…' : 'Open as new model'}
              </Button>
            </div>
          </>
        ) : (
          <>
            <Textarea
              aria-label="Describe model or circuit"
              value={prompt}
              maxLength={8000}
              onChange={(e) => setPrompt(e.target.value)}
              disabled={busy}
              placeholder="Build a 24 V to 12 V buck converter with an ideal switch, PWM control, LC filter, load, and output voltage sensor…"
              className="composer-input"
            />
            {!prompt && (
              <div className="prompt-suggestions">
                {[
                  'An RC low-pass circuit driven by a 5 V step. Plot the capacitor voltage.',
                  'A closed-loop motor speed controller with a step reference and PI control.',
                  'A transformer circuit: 24 V AC input, 2:1 turns ratio, resistive load, and voltage/current sensors.',
                ].map((text) => (
                  <button key={text} onClick={() => setPrompt(text)}>
                    {text}
                  </button>
                ))}
              </div>
            )}
            <p className="model-creation-note">
              Creates a separate model. Missing blocks are checked and saved to
              your AI library before assembly. Complex requests may take several
              minutes.
            </p>
            <div className="composer-footer">
              <output>
                {busy ? (
                  <>
                    <LoaderCircle size={14} className="spin" />
                    {progress}
                  </>
                ) : (
                  'Codex · Uses your local sign-in'
                )}
              </output>
              <Button
                disabled={busy || prompt.trim().length < 3}
                onClick={() => void generate()}
              >
                Build model
              </Button>
            </div>
          </>
        )}
        {error && (
          <div className="composer-error" role="alert">
            {error}
          </div>
        )}
      </div>
    </section>
  );
}
