'use client';
import { useState } from 'react';
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
  ArrowRight,
  LoaderCircle,
  Check,
  Copy,
  Cpu,
} from 'lucide-react';
import { api, downloadText, waitForJob, type Job } from '@/lib/gradara/api';
import { notifyAiChanged, useAiLabel } from '@/lib/gradara/ai';
import type { Project } from '@/lib/gradara/model';

type Artifact = {
  id: string;
  blockId: string;
  header: string;
  source: string;
  notes: string;
  compiler: string;
};
type ArtifactFile = 'header' | 'source' | 'notes';

export default function ExportDialog({
  project,
  selectedId,
  onClose,
}: {
  project: Project;
  selectedId?: string;
  onClose: () => void;
}) {
  const aiLabel = useAiLabel('export');
  const [busy, setBusy] = useState('');
  const [error, setError] = useState('');
  const [artifact, setArtifact] = useState<Artifact | null>(null);
  const [file, setFile] = useState<ArtifactFile>('source');
  const [copied, setCopied] = useState(false);
  const controllers = project.blocks.filter((b) => b.definition.controller);
  const [chosenId, setChosenId] = useState(
    () =>
      controllers.find((b) => b.id === selectedId)?.id ?? controllers[0]?.id,
  );
  const controller = controllers.find((b) => b.id === chosenId);
  const shown = artifact
    ? file === 'header'
      ? artifact.header
      : file === 'source'
        ? artifact.source
        : artifact.notes
    : '';
  async function source() {
    setBusy('modelica');
    setError('');
    try {
      const r = await api<{ source: string }>('/source', {
        method: 'POST',
        body: JSON.stringify(project),
      });
      downloadText('Gradara.mo', r.source);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy('');
    }
  }
  async function exportC() {
    if (!controller) return;
    setBusy('c');
    setError('');
    try {
      const j = await api<Job<unknown>>('/exports', {
        method: 'POST',
        body: JSON.stringify({ project, blockId: controller.id, target: 'c' }),
      });
      const r = await waitForJob<Artifact>(j.id);
      setArtifact(r);
      setFile('source');
    } catch (e) {
      setError((e as Error).message);
    } finally {
      notifyAiChanged();
      setBusy('');
    }
  }
  return (
    <Dialog
      open
      onOpenChange={(open) => {
        if (!open && !busy) onClose();
      }}
    >
      <DialogContent
        className={`export-dialog ${artifact ? 'has-artifact' : ''}`}
        showCloseButton={!busy}
      >
        <DialogTitle>Export model</DialogTitle>
        <DialogDescription>
          Save an editable model or generate an implementation of your
          controller.
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
              JSON.stringify(project, null, 2),
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
          <span className="component-category">Controller implementation</span>
          {controllers.length > 1 ? (
            <label className="controller-picker">
              <span>Controller</span>
              <select
                value={chosenId}
                disabled={!!busy}
                onChange={(e) => {
                  setChosenId(e.target.value);
                  setArtifact(null);
                  setError('');
                }}
              >
                {controllers.map((b) => (
                  <option key={b.id} value={b.id}>
                    {b.definition.name} · {b.definition.kind}
                  </option>
                ))}
              </select>
            </label>
          ) : (
            <h3>{controller?.definition.name ?? 'No controller in this model'}</h3>
          )}
          <p>
            {controller
              ? 'Generate C from the saved controller equations, state, and interface. Your physical plant stays in the simulation.'
              : 'Mark a signal block as a controller in the inspector to export it.'}
          </p>
          {artifact ? (
            <>
              <div className="export-artifact">
                <div className="export-artifact-tabs" role="tablist">
                  {(
                    [
                      ['header', 'gradara_controller.h'],
                      ['source', 'gradara_controller.c'],
                      ['notes', 'Notes'],
                    ] as const
                  ).map(([id, label]) => (
                    <button
                      key={id}
                      role="tab"
                      aria-selected={file === id}
                      className={file === id ? 'is-active' : ''}
                      onClick={() => {
                        setFile(id);
                        setCopied(false);
                      }}
                    >
                      {label}
                    </button>
                  ))}
                  <button
                    className="export-copy"
                    onClick={() => {
                      void navigator.clipboard.writeText(shown).then(() =>
                        setCopied(true),
                      );
                    }}
                  >
                    {copied ? <Check size={13} /> : <Copy size={13} />}
                    {copied ? 'Copied' : 'Copy'}
                  </button>
                </div>
                <pre aria-label="Generated controller code">
                  {shown}
                </pre>
              </div>
              <span className="export-success">
                <Check size={14} />
                Compiled with <code>{artifact.compiler}</code>
              </span>
              <a
                className="download-artifact"
                href={`/api/exports/${artifact.id}/download`}
                download
              >
                <Download size={15} />
                Download C package
              </a>
            </>
          ) : (
            <Button
              onClick={() => void exportC()}
              disabled={!!busy || !controller}
            >
              {busy === 'c' ? (
                <>
                  <LoaderCircle className="spin" />
                  Generating & compiling…
                </>
              ) : (
                <>
                  <Cpu />
                  Generate C controller
                  <ArrowRight size={14} />
                </>
              )}
            </Button>
          )}
          {aiLabel && <span className="export-note">Uses {aiLabel}</span>}
          <span className="export-note">
            Verilog and VHDL are planned for a later milestone.
          </span>
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
