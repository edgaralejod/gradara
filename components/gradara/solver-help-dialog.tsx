'use client';
import { useEffect, useRef } from 'react';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogTitle,
} from '@/components/ui/dialog';
import { SOLVER_IDS, isFixed } from '@/lib/gradara/solver';
import {
  FIELDS,
  LIMITS_TEXT,
  SOLVERS,
  SOLVER_LINE,
  SYMPTOMS,
} from '@/lib/gradara/solver-docs';

/**
 * The simulation settings guide: the same text as docs/SOLVER.md. Opened from
 * the Simulation group in the inspector and from problems that settings can
 * fix, in which case `topic` marks the matching symptom.
 */
export default function SolverHelpDialog({
  topic,
  onClose,
}: {
  topic?: string;
  onClose: () => void;
}) {
  const marked = useRef<HTMLTableRowElement | null>(null);
  useEffect(() => {
    marked.current?.scrollIntoView({ block: 'center' });
  }, [topic]);
  return (
    <Dialog
      open
      onOpenChange={(open) => {
        if (!open) onClose();
      }}
    >
      <DialogContent className="source-dialog block-help-dialog solver-help-dialog" resizeKey="solver-help">
        <DialogTitle>Simulation settings</DialogTitle>
        <DialogDescription>
          The defaults suit most models. Change a setting when you see one of the symptoms below.
        </DialogDescription>
        <article className="block-help">
          <section>
            <h3>When something looks wrong</h3>
            <table className="solver-table">
              <thead>
                <tr>
                  <th>Symptom</th>
                  <th>What to change</th>
                </tr>
              </thead>
              <tbody>
                {SYMPTOMS.map((s) => (
                  <tr
                    key={s.id}
                    ref={s.id === topic ? marked : undefined}
                    className={s.id === topic ? 'is-marked' : undefined}
                  >
                    <td>{s.symptom}</td>
                    <td>{s.change}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </section>
          <section>
            <h3>Solvers</h3>
            <p>{SOLVER_LINE}</p>
            <dl className="help-entries">
              {SOLVER_IDS.map((id) => (
                <div key={id}>
                  <dt>
                    <strong>{SOLVERS[id].name}</strong>
                    <span>{isFixed(id) ? 'Fixed step' : 'Variable step'}</span>
                  </dt>
                  <dd>
                    {SOLVERS[id].whenToUse} {SOLVERS[id].detail}
                  </dd>
                </div>
              ))}
            </dl>
          </section>
          <section>
            <h3>Settings</h3>
            <dl className="help-entries">
              {Object.values(FIELDS).map((f) => (
                <div key={f.label}>
                  <dt>
                    <strong>{f.label}</strong>
                    <span>
                      {f.appliesTo === 'variable' ? 'Variable step' : 'Fixed step'} · default {f.defaultText}
                    </span>
                  </dt>
                  <dd>{f.help.join(' ')}</dd>
                </div>
              ))}
            </dl>
          </section>
          <section>
            <h3>Limits</h3>
            <p>{LIMITS_TEXT}</p>
          </section>
        </article>
      </DialogContent>
    </Dialog>
  );
}
