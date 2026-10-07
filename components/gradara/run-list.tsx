'use client';
import { useRef, useState } from 'react';
import { Check, Download, Pencil, Trash2, X } from 'lucide-react';
import { maxOpenRuns, runTitle, type StoredRun } from '@/lib/gradara/run-set';
import { DEFAULTS } from '@/lib/gradara/solver';
import { describeRun } from '@/lib/gradara/solver-docs';

/** The run's solver settings when they are not the defaults. */
function settingsLabel(run: StoredRun): string {
  const s = run.simulation;
  if (!s || (s.solver === DEFAULTS.solver && s.tolerance === DEFAULTS.tolerance && s.points === DEFAULTS.points && !s.maxStep))
    return '';
  return describeRun(s, run.duration);
}

/**
 * The stored runs of the open model, newest first. Tick up to three to show
 * them together; each open run has its own colour. Names and deletions go
 * to the local service, so the list is the same after a restart.
 */
export default function RunList({
  runs,
  error,
  latestId,
  open,
  colorOf,
  onOpen,
  onColor,
  onRename,
  onRemove,
}: {
  runs: StoredRun[] | null;
  error: string;
  latestId: string;
  open: string[];
  colorOf: (id: string) => string;
  onOpen: (id: string, on: boolean) => void;
  onColor: (id: string, color: string) => void;
  onRename: (id: string, name: string) => Promise<void>;
  onRemove: (id: string) => Promise<void>;
}) {
  const [editing, setEditing] = useState<string | null>(null);
  const [draft, setDraft] = useState('');
  const [confirming, setConfirming] = useState<string | null>(null);
  const [problem, setProblem] = useState('');
  // Enter and Escape end the edit themselves; the blur that follows must not save again.
  const finished = useRef(false);
  const full = open.length >= maxOpenRuns;
  const act = (job: Promise<void>) =>
    job.then(
      () => setProblem(''),
      (e) => setProblem(e.message),
    );
  if (error)
    return (
      <p role="alert" className="di-runs-note">
        The stored runs could not be listed. {error}
      </p>
    );
  if (!runs) return <p className="di-runs-note">Loading runs…</p>;
  if (!runs.length)
    return (
      <p className="di-runs-note">
        Each run you finish is kept here, so you can come back to it later.
      </p>
    );
  const save = (id: string) => {
    if (finished.current) return;
    finished.current = true;
    void act(onRename(id, draft));
    setEditing(null);
  };
  return (
    <>
      <ul className="di-runs" aria-label="Stored runs">
        {runs.map((run) => {
          const isOpen = open.includes(run.id);
          const title = runTitle(run);
          return (
            <li key={run.id} className={`di-run${isOpen ? ' is-open' : ''}`}>
              <input
                type="checkbox"
                checked={isOpen}
                disabled={!isOpen && full}
                title={
                  !isOpen && full
                    ? `${maxOpenRuns} runs are shown; hide one to show this one.`
                    : undefined
                }
                aria-label={`Show ${title}`}
                onChange={(e) => onOpen(run.id, e.target.checked)}
              />
              {isOpen && open.length > 1 ? (
                <input
                  type="color"
                  className="di-run-color"
                  aria-label={`Colour of ${title}`}
                  title="Colour of this run on the plots"
                  value={colorOf(run.id)}
                  onChange={(e) => onColor(run.id, e.target.value)}
                />
              ) : (
                <span className="di-run-color-space" aria-hidden="true" />
              )}
              <div className="di-run-text">
                {editing === run.id ? (
                  <input
                    className="di-run-name"
                    aria-label="Run name"
                    placeholder="Name this run"
                    maxLength={80}
                    // The field exists because the user asked to rename.
                    // eslint-disable-next-line jsx-a11y/no-autofocus
                    autoFocus
                    value={draft}
                    onChange={(e) => setDraft(e.target.value)}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter') save(run.id);
                      if (e.key === 'Escape') {
                        finished.current = true;
                        setEditing(null);
                      }
                    }}
                    onBlur={() => save(run.id)}
                  />
                ) : (
                  <strong title={title}>{title}</strong>
                )}
                <small>
                  {run.id === latestId ? 'Latest · ' : ''}
                  {run.duration} s · {run.signals} signals · rev{' '}
                  {run.projectRevision}
                  {settingsLabel(run) && (
                    <span className="di-run-solver" title={settingsLabel(run)}>
                      {settingsLabel(run)}
                    </span>
                  )}
                </small>
              </div>
              <span className="di-run-actions">
                {confirming === run.id ? (
                  <>
                    <button
                      type="button"
                      className="is-danger"
                      aria-label={`Delete ${title} for good`}
                      title="Delete this run and its data for good"
                      onClick={() => {
                        setConfirming(null);
                        void act(onRemove(run.id));
                      }}
                    >
                      <Check size={12} aria-hidden="true" /> Delete
                    </button>
                    <button
                      type="button"
                      aria-label="Keep this run"
                      onClick={() => setConfirming(null)}
                    >
                      <X size={12} aria-hidden="true" />
                    </button>
                  </>
                ) : (
                  <>
                    <button
                      type="button"
                      aria-label={`Rename ${title}`}
                      title="Rename"
                      onMouseDown={(e) => e.preventDefault()}
                      onClick={() => {
                        finished.current = false;
                        setDraft(run.name);
                        setEditing(run.id);
                      }}
                    >
                      <Pencil size={12} aria-hidden="true" />
                    </button>
                    <a
                      href={`/api/results/${run.id}/csv`}
                      download
                      aria-label={`Export ${title} as CSV`}
                      title="Export this run as CSV"
                    >
                      <Download size={12} aria-hidden="true" />
                    </a>
                    <button
                      type="button"
                      aria-label={`Delete ${title}`}
                      title={
                        run.id === latestId
                          ? 'The latest run cannot be deleted while it is shown; run again first.'
                          : 'Delete'
                      }
                      disabled={run.id === latestId}
                      onClick={() => setConfirming(run.id)}
                    >
                      <Trash2 size={12} aria-hidden="true" />
                    </button>
                  </>
                )}
              </span>
            </li>
          );
        })}
      </ul>
      {problem && (
        <p role="alert" className="di-runs-note">
          {problem}
        </p>
      )}
    </>
  );
}
