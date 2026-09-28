'use client';
import { useEffect, useMemo, useState } from 'react';
import {
  Dialog,
  DialogContent,
  DialogTitle,
  DialogDescription,
} from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import {
  Code2,
  FileJson,
  Download,
  LoaderCircle,
  Check,
  Copy,
  ShieldCheck,
  TriangleAlert,
  Sparkles,
  Crosshair,
} from 'lucide-react';
import { api, downloadText, waitForJob, type Job } from '@/lib/gradara/api';
import { notifyAiChanged, useAi } from '@/lib/gradara/ai';
import type { CTemplate, Project } from '@/lib/gradara/model';
import { isInstance } from '@/lib/gradara/hierarchy';
import {
  codegenBody,
  defaultPrefix,
  detectController,
  selectionUnit,
  unitBlockIds,
  unitLabel,
  type CodeUnit,
  type CodegenOptions,
  type CodegenResult,
  type VerifyResult,
} from '@/lib/gradara/codegen';

type UnitChoice = { id: string; label: string; unit: CodeUnit };

/**
 * Export: the Modelica source, the project file, and C code for a controller.
 * C code is generated deterministically from per-block templates on the local
 * service; the AI provider is used only for a custom block with no template.
 */
export default function ExportDialog({
  doc,
  path,
  project,
  selectedIds,
  runId,
  onShowBlocks,
  onCommit,
  onOpenSettings,
  onClose,
}: {
  /** Apply an edit to the open sheet as one undo step. */
  onCommit: (change: (view: Project) => Project) => void;
  /** The whole document, subsystems included. */
  doc: Project;
  /** Subsystem instance IDs down to the open sheet. */
  path: string[];
  /** The open sheet. */
  project: Project;
  selectedIds: string[];
  /** The last run of this model, for the software-in-the-loop check. */
  runId?: string;
  onShowBlocks: (ids: string[]) => void;
  /** Open Settings → AI, to sign in or set up a provider. */
  onOpenSettings: () => void;
  onClose: () => void;
}) {
  const ai = useAi('export');
  const [busy, setBusy] = useState('');
  const [error, setError] = useState('');
  const choices = useMemo(() => {
    const list: UnitChoice[] = [];
    const selected = selectionUnit(project, selectedIds);
    if (selected)
      list.push({
        id: 'selection',
        label: `Selection: ${unitLabel(project, selected)}`,
        unit: selected,
      });
    const detected = detectController(project);
    if (detected)
      list.push({
        id: 'detected',
        label: `Detected controller: ${unitLabel(project, detected)}`,
        unit: detected,
      });
    for (const b of project.blocks.filter(isInstance))
      list.push({
        id: `sub:${b.id}`,
        label: `Subsystem: ${b.definition.name}`,
        unit: { kind: 'instance', instanceId: b.id },
      });
    return list;
  }, [project, selectedIds]);
  const [choiceId, setChoiceId] = useState(() => choices[0]?.id ?? '');
  const choice = choices.find((c) => c.id === choiceId) ?? choices[0];
  const [options, setOptions] = useState<CodegenOptions>(() => ({
    method: 'tustin',
    real: 'double',
    prefix: choice ? defaultPrefix(project, choice.unit) : 'controller',
  }));
  const [stepText, setStepText] = useState('');
  const [generated, setGenerated] = useState<CodegenResult | null>(null);
  const [verified, setVerified] = useState<VerifyResult | null>(null);
  const [file, setFile] = useState('');
  const [copied, setCopied] = useState(false);

  const step = Number(stepText);
  const effective: CodegenOptions = {
    ...options,
    ...(stepText.trim() && Number.isFinite(step) && step > 0 ? { step } : {}),
  };
  const request = choice
    ? codegenBody(doc, path, choice.unit, effective, runId)
    : '';

  // Generation is deterministic and fast, so the code follows the options live.
  useEffect(() => {
    if (!request) return;
    let live = true;
    const timer = setTimeout(() => {
      api<CodegenResult>('/codegen', { method: 'POST', body: request })
        .then((r) => {
          if (!live) return;
          setGenerated(r);
          setVerified(null);
          if (r.ok) setFile((f) => (f in r.files ? f : `${options.prefix}.c`));
        })
        .catch((e) => live && setError((e as Error).message));
    }, 150);
    return () => {
      live = false;
      clearTimeout(timer);
    };
  }, [request, options.prefix]);

  async function source() {
    setBusy('modelica');
    setError('');
    try {
      const r = await api<{ source: string }>('/source', {
        method: 'POST',
        body: JSON.stringify(doc),
      });
      downloadText('Gradara.mo', r.source);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy('');
    }
  }

  async function downloadZip() {
    setBusy('zip');
    setError('');
    try {
      const response = await fetch('/api/codegen/archive', {
        method: 'POST',
        body: request,
        headers: {
          'Content-Type': 'application/json',
          'X-Gradara-Client': 'workbench',
        },
      });
      if (!response.ok)
        throw new Error(
          ((await response.json()) as { detail?: string }).detail ??
            'The code could not be packaged.',
        );
      const url = URL.createObjectURL(await response.blob());
      const anchor = document.createElement('a');
      anchor.href = url;
      anchor.download = `${options.prefix}.zip`;
      anchor.click();
      setTimeout(() => URL.revokeObjectURL(url), 2000);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy('');
    }
  }

  async function verify() {
    setBusy('verify');
    setError('');
    try {
      setVerified(
        await api<VerifyResult>('/codegen/verify', {
          method: 'POST',
          body: request,
        }),
      );
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy('');
    }
  }

  // A custom block without a C template can still be written by the AI provider, one block at a time.
  const failed = generated && !generated.ok ? generated : null;
  const customGap =
    failed && /no C template/.test(failed.error) && failed.blockIds.length === 1
      ? project.blocks.find(
          (b) => b.id === failed.blockIds[0] && b.definition.generated,
        )
      : undefined;
  // The AI writes a C template for that one block; it is stored with the block and reused from then on.
  async function writeTemplate() {
    if (!customGap) return;
    setBusy('ai');
    setError('');
    try {
      const j = await api<Job<unknown>>('/codegen/template', {
        method: 'POST',
        body: JSON.stringify({ definition: customGap.definition }),
      });
      const { ctemplate } = await waitForJob<{
        ctemplate: CTemplate;
      }>(j.id);
      const kind = customGap.definition.kind;
      onCommit((view) => ({
        ...view,
        blocks: view.blocks.map((b) =>
          b.definition.generated && b.definition.kind === kind
            ? { ...b, definition: { ...b.definition, ctemplate } }
            : b,
        ),
      }));
    } catch (e) {
      setError((e as Error).message);
    } finally {
      notifyAiChanged();
      setBusy('');
    }
  }

  const files: [string, string][] = generated?.ok
    ? Object.entries(generated.files).sort(([a], [b]) =>
        a.endsWith('.h') ? -1 : b.endsWith('.h') ? 1 : a.localeCompare(b),
      )
    : [];
  const shown = files.find(([name]) => name === file)?.[1] ?? files[0]?.[1];
  const shownName = files.find(([name]) => name === file)?.[0] ?? files[0]?.[0];

  return (
    <Dialog
      open
      onOpenChange={(open) => {
        if (!open && !busy) onClose();
      }}
    >
      <DialogContent
        className={`export-dialog ${files.length ? 'has-artifact' : ''}`}
        showCloseButton={!busy}
      >
        <DialogTitle>Export model</DialogTitle>
        <DialogDescription>
          Save an editable model or generate C code for a controller.
        </DialogDescription>
        <button
          className="export-option"
          onClick={() => void source()}
          disabled={!!busy}
        >
          <span>
            <Code2 />
          </span>
          <div>
            <strong>Modelica source</strong>
            <p>Complete model, equations, parameters, and connections.</p>
          </div>
          {busy === 'modelica' ? (
            <LoaderCircle className="spin" />
          ) : (
            <Download size={17} />
          )}
        </button>
        <button
          className="export-option"
          onClick={() =>
            downloadText(
              'model.gradara.json',
              JSON.stringify(doc, null, 2),
              'application/json',
            )
          }
          disabled={!!busy}
        >
          <span>
            <FileJson />
          </span>
          <div>
            <strong>Gradara project</strong>
            <p>Reopen your diagram with its layout and custom components.</p>
          </div>
          <Download size={17} />
        </button>
        <div className="controller-export">
          <span className="component-category">C code</span>
          {choices.length ? (
            <>
              <label className="controller-picker">
                <span>Unit</span>
                <select
                  value={choice?.id}
                  disabled={!!busy}
                  onChange={(e) => {
                    const next = choices.find((c) => c.id === e.target.value);
                    setChoiceId(e.target.value);
                    if (next)
                      setOptions((o) => ({
                        ...o,
                        prefix: defaultPrefix(project, next.unit),
                      }));
                  }}
                >
                  {choices.map((c) => (
                    <option key={c.id} value={c.id}>
                      {c.label}
                    </option>
                  ))}
                </select>
              </label>
              <div className="codegen-options">
                <label>
                  <span>Discretization</span>
                  <select
                    value={options.method}
                    onChange={(e) =>
                      setOptions((o) => ({
                        ...o,
                        method: e.target.value as CodegenOptions['method'],
                      }))
                    }
                  >
                    <option value="tustin">Tustin</option>
                    <option value="backward">Backward Euler</option>
                    <option value="forward">Forward Euler</option>
                  </select>
                </label>
                <label>
                  <span>Numbers</span>
                  <select
                    value={options.real}
                    onChange={(e) =>
                      setOptions((o) => ({
                        ...o,
                        real: e.target.value as CodegenOptions['real'],
                      }))
                    }
                  >
                    <option value="double">double</option>
                    <option value="float">float</option>
                  </select>
                </label>
                <label>
                  <span>Step (s)</span>
                  <input
                    value={stepText}
                    inputMode="decimal"
                    placeholder={
                      generated?.ok ? `auto · ${generated.step}` : 'auto'
                    }
                    onChange={(e) => setStepText(e.target.value)}
                  />
                </label>
                <label>
                  <span>Name</span>
                  <input
                    value={options.prefix}
                    spellCheck={false}
                    onChange={(e) =>
                      setOptions((o) => ({
                        ...o,
                        prefix:
                          e.target.value.replace(/[^A-Za-z0-9_]/g, '') ||
                          'controller',
                      }))
                    }
                  />
                </label>
              </div>
            </>
          ) : (
            <p>
              No signal blocks to generate code for. Select the controller
              blocks, or a subsystem, and open Export again.
            </p>
          )}
          {failed && !customGap && (
            <div className="codegen-problem" role="alert">
              <TriangleAlert size={14} />
              <span>{failed.error}</span>
              {failed.blockIds.length > 0 && (
                <button onClick={() => onShowBlocks(failed.blockIds)}>
                  <Crosshair size={13} />
                  Show
                </button>
              )}
            </div>
          )}
          {customGap && (
            <div className="codegen-gap" role="alert">
              <TriangleAlert size={14} />
              <div>
                <strong>{customGap.definition.name} has no C code yet.</strong>
                <p>
                  It is a custom block, so there is no built-in template.
                  Gradara can write one with AI; it is checked, saved with the
                  block, and reused for every export after that. Or select the
                  other blocks and export them without it.
                </p>
                <div className="codegen-gap-actions">
                  <Button
                    size="sm"
                    onClick={() => void writeTemplate()}
                    disabled={!!busy || !ai.ready}
                  >
                    {busy === 'ai' ? (
                      <LoaderCircle className="spin" />
                    ) : (
                      <Sparkles />
                    )}
                    Write its C template
                  </Button>
                  <button
                    className="codegen-link"
                    onClick={() => onShowBlocks([customGap.id])}
                  >
                    <Crosshair size={12} />
                    Show block
                  </button>
                </div>
                <p className="codegen-ai">
                  {ai.ready ? (
                    ai.label
                  ) : (
                    <>
                      {ai.label ? 'AI is not set up yet.' : 'AI is turned off.'}{' '}
                      <button className="codegen-link" onClick={onOpenSettings}>
                        Open Settings → AI
                      </button>
                    </>
                  )}
                </p>
              </div>
            </div>
          )}
          {files.length > 0 && (
            <>
              {generated?.ok && (
                <p className="codegen-summary">
                  {generated.blocks.length} block
                  {generated.blocks.length === 1 ? '' : 's'} ·{' '}
                  {generated.inputs.length} input
                  {generated.inputs.length === 1 ? '' : 's'} ·{' '}
                  {generated.outputs.length} output
                  {generated.outputs.length === 1 ? '' : 's'} · step{' '}
                  {generated.step} s
                  {choice && (
                    <button
                      onClick={() => onShowBlocks(unitBlockIds(choice.unit))}
                    >
                      <Crosshair size={12} />
                      Show
                    </button>
                  )}
                </p>
              )}
              <div className="export-artifact">
                <div className="export-artifact-tabs" role="tablist">
                  {files.map(([name]) => (
                    <button
                      key={name}
                      role="tab"
                      aria-selected={shownName === name}
                      className={shownName === name ? 'is-active' : ''}
                      onClick={() => {
                        setFile(name);
                        setCopied(false);
                      }}
                    >
                      {name}
                    </button>
                  ))}
                  <button
                    className="export-copy"
                    onClick={() => {
                      void navigator.clipboard
                        .writeText(shown ?? '')
                        .then(() => setCopied(true));
                    }}
                  >
                    {copied ? <Check size={13} /> : <Copy size={13} />}
                    {copied ? 'Copied' : 'Copy'}
                  </button>
                </div>
                <pre aria-label="Generated controller code">{shown}</pre>
              </div>
              {
                <div className="codegen-actions">
                  <Button onClick={() => void downloadZip()} disabled={!!busy}>
                    {busy === 'zip' ? (
                      <LoaderCircle className="spin" />
                    ) : (
                      <Download />
                    )}
                    Download .zip
                  </Button>
                  <Button
                    variant="outline"
                    onClick={() => void verify()}
                    disabled={!!busy || !runId}
                    title={
                      runId
                        ? 'Compile the code and replay the last run through it'
                        : 'Run the model first'
                    }
                  >
                    {busy === 'verify' ? (
                      <LoaderCircle className="spin" />
                    ) : (
                      <ShieldCheck />
                    )}
                    Verify against last run
                  </Button>
                </div>
              }
              {verified && <VerifyReport result={verified} />}
            </>
          )}
        </div>
        {error && (
          <div className="composer-error" role="alert">
            {error}
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}

function VerifyReport({ result }: { result: VerifyResult }) {
  if ('error' in result)
    return (
      <div className="codegen-problem" role="alert">
        <TriangleAlert size={14} />
        <span>{result.error}</span>
      </div>
    );
  return (
    <div className={`codegen-verify ${result.ok ? 'is-ok' : 'is-bad'}`}>
      <strong>
        {result.ok ? <Check size={14} /> : <TriangleAlert size={14} />}
        {result.ok
          ? `Matches the simulation over ${result.steps} steps`
          : 'The code differs from the simulation'}
      </strong>
      <table>
        <tbody>
          {result.outputs.map((o) => (
            <tr key={o.output}>
              <td>{o.output}</td>
              <td>max error {o.maxError.toPrecision(3)}</td>
              <td>
                {(o.relative * 100).toFixed(o.relative < 0.001 ? 4 : 2)}% of
                range
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
