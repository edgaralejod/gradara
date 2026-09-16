'use client';
import { useRef, useState } from 'react';
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
  Cpu,
} from 'lucide-react';
import { api, downloadText, waitForJob, type Job } from '@/lib/gradara/api';
import type { Project } from '@/lib/gradara/model';
export default function ExportDialog({
  project,
  selectedId,
  onClose,
}: {
  project: Project;
  selectedId?: string;
  onClose: () => void;
}) {
  const [busy, setBusy] = useState('');
  const [error, setError] = useState('');
  const [artifact, setArtifact] = useState<{
    id: string;
    header: string;
    source: string;
  } | null>(null);
  const controller =
    project.blocks.find(
      (b) => b.id === selectedId && b.definition.controller,
    ) ?? project.blocks.find((b) => b.definition.controller);
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
      const r = await waitForJob<{
        id: string;
        header: string;
        source: string;
      }>(j.id);
      setArtifact(r);
    } catch (e) {
      setError((e as Error).message);
    } finally {
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
      <DialogContent className="export-dialog" showCloseButton={!busy}>
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
          <h3>{controller?.definition.name ?? 'No controller selected'}</h3>
          <p>
            {controller
              ? 'Generate C from the saved controller equations, state, and interface. Your physical plant stays in the simulation.'
              : 'Mark a signal component as a controller in its inspector to export it.'}
          </p>
          {artifact ? (
            <>
              <span className="export-success">
                <Check size={14} />
                Generated and compiled
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
