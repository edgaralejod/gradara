'use client';
import { useEffect, useState } from 'react';
import { ArrowUpRight } from 'lucide-react';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogTitle,
} from '@/components/ui/dialog';
import { library, type Definition } from '@/lib/gradara/model';
import type { BlockDoc } from '@/lib/gradara/block-docs/types';
import {
  blockReference,
  codeSpans,
  type ReferencePort,
} from '@/lib/gradara/block-reference';

/** Text with `code` spans. */
function Rich({ text }: { text: string }) {
  return (
    <>
      {codeSpans(text).map((part, i) =>
        i % 2 ? <code key={i}>{part}</code> : part,
      )}
    </>
  );
}

function Ports({ title, ports }: { title: string; ports: ReferencePort[] }) {
  if (!ports.length) return null;
  return (
    <>
      <h4>{title}</h4>
      <dl className="help-entries">
        {ports.map((p) => (
          <div key={p.id}>
            <dt>
              <strong>{p.name}</strong>
              {p.name !== p.id && <code>{p.id}</code>}
              <span>
                {p.domain}
                {p.unit ? ` · ${p.unit}` : ''}
              </span>
            </dt>
            {p.description && (
              <dd>
                <Rich text={p.description} />
              </dd>
            )}
          </div>
        ))}
      </dl>
    </>
  );
}

let docsCache: Record<string, BlockDoc> | undefined;

/**
 * A block's reference page, like Simulink's block Help: what it does, its ports and
 * parameters, the equations, what it leaves out, and related blocks. Works offline;
 * the same page is on gradara.app. Blocks written by the AI have no authored page, so
 * they show what their definition says.
 */
export default function BlockHelpDialog({
  definition,
  onClose,
}: {
  definition: Definition;
  onClose: () => void;
}) {
  // A library block's page shows the library block (its defaults, its name), not
  // this instance's edits; custom blocks written by the AI show themselves.
  const base =
    (!definition.generated &&
      library.find((d) => d.kind === definition.kind)) ||
    definition;
  const [docs, setDocs] = useState(docsCache);
  const [shown, setShown] = useState(base);
  useEffect(() => {
    if (docsCache) return;
    void import('@/lib/gradara/block-docs').then((m) => {
      docsCache = m.blockDocs;
      setDocs(m.blockDocs);
    });
  }, []);
  const doc = shown.generated ? undefined : docs?.[shown.kind];
  const page = blockReference(shown, doc, library);
  const published =
    !shown.generated && library.some((d) => d.kind === shown.kind);
  return (
    <Dialog
      open
      onOpenChange={(open) => {
        if (!open) onClose();
      }}
    >
      <DialogContent className="source-dialog block-help-dialog">
        <DialogTitle>{page.title}</DialogTitle>
        <DialogDescription>
          {page.category} ·{' '}
          {shown.generated ? 'custom block' : 'Gradara block reference'}
        </DialogDescription>
        <article className="block-help" aria-busy={!docs}>
          <section>
            <h3>Description</h3>
            {page.description.map((p, i) => (
              <p key={i}>
                <Rich text={p} />
              </p>
            ))}
          </section>
          {(page.inputs.length > 0 ||
            page.outputs.length > 0 ||
            page.terminals.length > 0) && (
            <section>
              <h3>Ports</h3>
              <Ports title="Inputs" ports={page.inputs} />
              <Ports title="Outputs" ports={page.outputs} />
              <Ports title="Conserving terminals" ports={page.terminals} />
            </section>
          )}
          {page.parameters.length > 0 && (
            <section>
              <h3>Parameters</h3>
              <dl className="help-entries">
                {page.parameters.map((p) => (
                  <div key={p.id}>
                    <dt>
                      <strong>{p.name}</strong>
                      <code>{p.id}</code>
                      <span>
                        Default {p.value}
                        {p.unit ? ` ${p.unit}` : ''}
                        {p.range ? ` · ${p.range}` : ''}
                      </span>
                    </dt>
                    {p.description && (
                      <dd>
                        <Rich text={p.description} />
                      </dd>
                    )}
                  </div>
                ))}
              </dl>
            </section>
          )}
          {page.equations.length > 0 && (
            <section>
              <h3>Equations</h3>
              <pre className="help-equations">{page.equations.join('\n')}</pre>
            </section>
          )}
          {(page.msl || page.source) && (
            <section>
              <h3>Implementation</h3>
              {page.msl ? (
                <p>
                  Instantiates <code>{page.msl.className}</code> from the
                  Modelica Standard Library 4.1.0.{' '}
                  <a href={page.msl.url} target="_blank" rel="noreferrer">
                    MSL documentation <ArrowUpRight size={12} />
                  </a>
                </p>
              ) : (
                <pre className="help-source">{page.source}</pre>
              )}
            </section>
          )}
          {page.limitations.length > 0 && (
            <section>
              <h3>Assumptions and limitations</h3>
              <ul>
                {page.limitations.map((l, i) => (
                  <li key={i}>
                    <Rich text={l} />
                  </li>
                ))}
              </ul>
            </section>
          )}
          {page.tips.length > 0 && (
            <section>
              <h3>Tips</h3>
              <ul>
                {page.tips.map((l, i) => (
                  <li key={i}>
                    <Rich text={l} />
                  </li>
                ))}
              </ul>
            </section>
          )}
          {page.seeAlso.length > 0 && (
            <section>
              <h3>See also</h3>
              <p className="help-see-also">
                {page.seeAlso.map((s) => (
                  <button
                    key={s.kind}
                    type="button"
                    onClick={() =>
                      setShown(library.find((d) => d.kind === s.kind)!)
                    }
                  >
                    {s.title}
                  </button>
                ))}
              </p>
            </section>
          )}
        </article>
        <div className="dialog-actions">
          {shown !== base && (
            <button
              type="button"
              className="help-back"
              onClick={() => setShown(base)}
            >
              Back to {base.name}
            </button>
          )}
          {published && (
            <a href={page.url} target="_blank" rel="noreferrer">
              Open on gradara.app <ArrowUpRight size={13} />
            </a>
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
}
