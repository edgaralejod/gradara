'use client';
import { useEffect, useMemo, useState } from 'react';
import { createPortal } from 'react-dom';
import {
  Dialog,
  DialogContent,
  DialogTitle,
  DialogDescription,
} from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { FileDown, LoaderCircle, Printer } from 'lucide-react';
import { fileSlug } from '@/lib/gradara/api';
import type { Project } from '@/lib/gradara/model';
import {
  DEFAULT_PRINT_OPTIONS,
  PAPER,
  pageBox,
  parameterRows,
  printPages,
  unprinted,
  type PaperSize,
  type PrintOptions,
} from '@/lib/gradara/print';
import PrintDocument, { SheetPage } from './print-document';

type PdfBridge = {
  pdf(request: { paper: PaperSize; name: string }): Promise<{ saved: boolean; file?: string } | null>;
};
declare global {
  interface GradaraDesktopBridge {
    print?: PdfBridge;
  }
}

const STORAGE = 'gradara-print';
/** Width of a preview thumbnail, in CSS pixels. */
const THUMB = 300;

function savedOptions(): PrintOptions {
  try {
    const value = JSON.parse(localStorage.getItem(STORAGE) ?? 'null') as Partial<PrintOptions> | null;
    if (value && (value.paper === 'letter' || value.paper === 'a4') && typeof value.parameters === 'boolean')
      return { paper: value.paper, parameters: value.parameters };
  } catch {
    /* Remembering the paper is a convenience. */
  }
  // Letter where it is the norm, A4 elsewhere.
  const region = typeof navigator === 'undefined' ? '' : (navigator.language.split('-')[1] ?? '');
  return { ...DEFAULT_PRINT_OPTIONS, paper: ['US', 'CA', 'MX', 'PH'].includes(region) ? 'letter' : 'a4' };
}

/**
 * Print the design: every sheet (the top level and each subsystem) as a page,
 * previewed here as it will print. Print uses the system dialog (which can also
 * save a PDF in a browser); the desktop app saves a PDF directly.
 */
export default function PrintDialog({
  doc,
  onDone,
  onClose,
}: {
  /** The whole document, subsystems included. */
  doc: Project;
  /** A message for the status line, such as where the PDF went. */
  onDone: (message: string) => void;
  onClose: () => void;
}) {
  const [options, setOptions] = useState<PrintOptions>(savedOptions);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [printed] = useState(() => new Date());
  const pages = useMemo(() => printPages(doc), [doc]);
  const hidden = useMemo(() => unprinted(doc, pages).length, [doc, pages]);
  const rows = useMemo(
    () => (options.parameters ? pages.reduce((n, p) => n + parameterRows(p.sheet).length, 0) : 0),
    [pages, options.parameters],
  );
  const pdf = typeof window !== 'undefined' ? window.gradaraDesktop?.print : undefined;
  useEffect(() => {
    try {
      localStorage.setItem(STORAGE, JSON.stringify(options));
    } catch {
      /* As above. */
    }
  }, [options]);
  const box = pageBox(options.paper);
  const scale = THUMB / box.width;

  async function savePdf() {
    if (!pdf) return;
    setBusy(true);
    setError('');
    try {
      const r = await pdf.pdf({ paper: options.paper, name: fileSlug(doc.name) });
      if (r?.saved) {
        onDone(`Saved ${r.file ?? 'the PDF'}.`);
        onClose();
      }
    } catch (e) {
      setError((e as Error).message || 'The PDF could not be saved.');
    } finally {
      setBusy(false);
    }
  }

  return (
    <>
      <Dialog
        open
        onOpenChange={(open) => {
          if (!open && !busy) onClose();
        }}
      >
        <DialogContent className="print-dialog" resizeKey="print" showCloseButton={!busy}>
          <DialogTitle>Print</DialogTitle>
          <DialogDescription>
            {pages.length === 1
              ? 'The diagram on one page.'
              : `The top level and ${pages.length - 1} subsystem${pages.length === 2 ? '' : 's'}, a page each.`}
            {options.parameters && rows > 0 ? ` Each is followed by its parameters (${rows} in all).` : ''}
          </DialogDescription>
          <div className="print-options">
            <label>
              <span>Paper</span>
              <select
                value={options.paper}
                onChange={(e) => setOptions((o) => ({ ...o, paper: e.target.value as PaperSize }))}
              >
                {(Object.keys(PAPER) as PaperSize[]).map((p) => (
                  <option key={p} value={p}>
                    {PAPER[p].label}, landscape
                  </option>
                ))}
              </select>
            </label>
            <label className="print-check">
              <input
                type="checkbox"
                checked={options.parameters}
                onChange={(e) => setOptions((o) => ({ ...o, parameters: e.target.checked }))}
              />
              <span>Parameter tables</span>
            </label>
          </div>
          <div className="print-preview" aria-label="Pages to print">
            {pages.map((page, i) => (
              <figure key={page.key}>
                <div
                  className="print-thumb"
                  style={{ width: box.width * scale, height: box.height * scale }}
                >
                  <div style={{ transform: `scale(${scale})`, transformOrigin: '0 0' }}>
                    <SheetPage
                      doc={doc}
                      page={page}
                      index={i}
                      count={pages.length}
                      options={options}
                      printed={printed}
                    />
                  </div>
                </div>
                <figcaption>
                  <strong>{page.title}</strong>
                  <span>{page.where || 'Top level'}</span>
                </figcaption>
              </figure>
            ))}
          </div>
          {hidden > 0 && (
            <p className="print-note">
              Subsystems print their active variant. {hidden} other variant
              {hidden === 1 ? '' : 's'} {hidden === 1 ? 'is' : 'are'} left out; switch
              the configuration to print {hidden === 1 ? 'it' : 'them'}.
            </p>
          )}
          {error && (
            <div className="composer-error" role="alert">
              {error}
            </div>
          )}
          <div className="dialog-actions">
            <Button variant="ghost" onClick={onClose} disabled={busy}>
              Cancel
            </Button>
            {pdf && (
              <Button variant="outline" onClick={() => void savePdf()} disabled={busy}>
                {busy ? <LoaderCircle className="spin" /> : <FileDown />}
                Save PDF…
              </Button>
            )}
            <Button onClick={() => window.print()} disabled={busy}>
              <Printer />
              Print…
            </Button>
          </div>
        </DialogContent>
      </Dialog>
      {typeof document !== 'undefined' &&
        createPortal(
          <div className="print-root" aria-hidden="true">
            <PrintDocument doc={doc} pages={pages} options={options} printed={printed} />
          </div>,
          document.body,
        )}
    </>
  );
}
