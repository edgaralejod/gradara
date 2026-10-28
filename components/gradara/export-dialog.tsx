'use client';
import { useState } from 'react';
import {
  Dialog,
  DialogContent,
  DialogTitle,
  DialogDescription,
} from '@/components/ui/dialog';
import { Code2, FileJson, Download, LoaderCircle, Cpu, ArrowRight, Printer } from 'lucide-react';
import { api, downloadText, fileSlug } from '@/lib/gradara/api';
import type { Project } from '@/lib/gradara/model';

/**
 * Export: the Modelica source and the project file. C code for a controller
 * has its own flow (codegen-dialog.tsx), reached from here or the toolbar.
 */
export default function ExportDialog({
  doc,
  onCodegen,
  onPrint,
  onClose,
}: {
  /** The whole document, subsystems included. */
  doc: Project;
  /** Open Generate C code in place of this dialog. */
  onCodegen: () => void;
  /** Open Print in place of this dialog. */
  onPrint: () => void;
  onClose: () => void;
}) {
  const [busy, setBusy] = useState('');
  const [error, setError] = useState('');

  async function source() {
    setBusy('modelica');
    setError('');
    try {
      const r = await api<{ source: string }>('/source', {
        method: 'POST',
        body: JSON.stringify(doc),
      });
      downloadText(`${fileSlug(doc.name)}.mo`, r.source);
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
      <DialogContent
        className="export-dialog"
        resizeKey="export"
        showCloseButton={!busy}
      >
        <DialogTitle>Export model</DialogTitle>
        <DialogDescription>
          Save an editable model, or go on to C code for a controller.
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
              `${fileSlug(doc.name)}.gradara.json`,
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
        <button className="export-option" onClick={onPrint} disabled={!!busy}>
          <span>
            <Printer />
          </span>
          <div>
            <strong>Print or PDF</strong>
            <p>The diagram and every subsystem, a page each.</p>
          </div>
          <ArrowRight size={17} />
        </button>
        <button className="export-option" onClick={onCodegen} disabled={!!busy}>
          <span>
            <Cpu />
          </span>
          <div>
            <strong>C code for a controller</strong>
            <p>
              Deterministic C at the model&apos;s fixed step, verified against
              your last run.
            </p>
          </div>
          <ArrowRight size={17} />
        </button>
        {error && (
          <div className="composer-error" role="alert">
            {error}
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}
