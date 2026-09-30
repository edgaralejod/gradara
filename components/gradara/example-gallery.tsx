'use client';
import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import type { ReactNode } from 'react';
import { Copy, LoaderCircle } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { api } from '@/lib/gradara/api';
import type { Project } from '@/lib/gradara/model';
import type { TemplateId } from '@/lib/gradara/workspace';
import { ExampleDiagram, sheetBounds } from './example-diagram';

export type GalleryEntry = {
  id: TemplateId;
  title: string;
  /** The name a model made from it gets. */
  name: string;
  summary: string;
  /** A heading the list groups entries under (an area), or none. */
  group?: string;
  /** A short line above the title: domains, or the blocks it is about. */
  detail?: string;
  icon?: ReactNode;
  /** Block names shown as chips in the preview. */
  blocks?: { about: string[]; also: string[] };
};

/** The documents behind the previews, fetched once per session. */
const cache = new Map<string, Promise<Project>>();
function loadExample(id: string) {
  let found = cache.get(id);
  if (!found) {
    found = api<{ project: Project }>(`/examples/${id}`).then((r) => r.project);
    found.catch(() => cache.delete(id));
    cache.set(id, found);
  }
  return found;
}

/**
 * A list of examples beside a preview of the selected one: its diagram as the
 * canvas draws it, its description, and Use. Arrow keys move through the list.
 */
export function ExampleGallery({
  entries,
  busy,
  empty,
  onUse,
}: {
  entries: GalleryEntry[];
  busy: string;
  empty: string;
  onUse: (entry: GalleryEntry) => void;
}) {
  const [selected, setSelected] = useState<string>(entries[0]?.id ?? '');
  const current = entries.find((e) => e.id === selected) ?? entries[0];
  const list = useRef<HTMLDivElement>(null);
  const groups = [...new Set(entries.map((e) => e.group ?? ''))];
  const move = (by: number) => {
    if (!current) return;
    const i = entries.indexOf(current);
    const next = entries[Math.max(0, Math.min(entries.length - 1, i + by))];
    setSelected(next.id);
    list.current
      ?.querySelector<HTMLButtonElement>(`[data-example="${next.id}"]`)
      ?.focus();
  };
  if (!entries.length) return <p className="model-list-empty">{empty}</p>;
  return (
    <div className="example-gallery">
      <div
        ref={list}
        className="example-gallery-list"
        role="listbox"
        aria-label="Examples"
        onKeyDown={(e) => {
          if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
            e.preventDefault();
            move(e.key === 'ArrowDown' ? 1 : -1);
          } else if (e.key === 'Enter' && current && !busy) {
            e.preventDefault();
            onUse(current);
          }
        }}
      >
        {groups.map((group) => (
          <section key={group || 'all'}>
            {group && <h4>{group}</h4>}
            {entries
              .filter((e) => (e.group ?? '') === group)
              .map((e) => (
                <button
                  key={e.id}
                  type="button"
                  role="option"
                  data-example={e.id}
                  aria-selected={e.id === current?.id}
                  tabIndex={e.id === current?.id ? 0 : -1}
                  onClick={() => setSelected(e.id)}
                  onDoubleClick={() => !busy && onUse(e)}
                >
                  {e.icon}
                  <span>
                    <strong>{e.title}</strong>
                    {e.detail && <small>{e.detail}</small>}
                  </span>
                </button>
              ))}
          </section>
        ))}
      </div>
      {current && (
        <ExamplePreview
          key={current.id}
          entry={current}
          busy={busy}
          onUse={() => onUse(current)}
        />
      )}
    </div>
  );
}

function ExamplePreview({
  entry,
  busy,
  onUse,
}: {
  entry: GalleryEntry;
  busy: string;
  onUse: () => void;
}) {
  const [project, setProject] = useState<Project | null>(null);
  const [failed, setFailed] = useState(false);
  useEffect(() => {
    let alive = true;
    loadExample(entry.id)
      .then((p) => alive && setProject(p))
      .catch(() => alive && setFailed(true));
    return () => {
      alive = false;
    };
  }, [entry.id]);
  return (
    <article className="example-preview" aria-label={`Preview: ${entry.title}`}>
      <FittedDiagram project={project} failed={failed} />
      <div className="example-preview-copy">
        {entry.detail && <small>{entry.detail}</small>}
        <h3>{entry.title}</h3>
        <p>{project?.description || entry.summary}</p>
        {entry.blocks && (
          <div className="example-preview-blocks">
            {entry.blocks.about.map((name) => (
              <span key={name} className="is-about">
                {name}
              </span>
            ))}
            {entry.blocks.also.map((name) => (
              <span key={name}>{name}</span>
            ))}
          </div>
        )}
      </div>
      <div className="example-preview-actions">
        <span>Opens as a new model in My models.</span>
        <Button disabled={!!busy} onClick={onUse}>
          {busy === entry.id ? (
            <LoaderCircle className="spin" size={14} />
          ) : (
            <Copy size={14} />
          )}
          Use example
        </Button>
      </div>
    </article>
  );
}

/** The example's top sheet, scaled to fit its box (never enlarged past 100%). */
function FittedDiagram({
  project,
  failed,
}: {
  project: Project | null;
  failed: boolean;
}) {
  const box = useRef<HTMLDivElement>(null);
  const [room, setRoom] = useState({ width: 0, height: 0 });
  useLayoutEffect(() => {
    const el = box.current;
    if (!el) return;
    const measure = () =>
      setRoom({ width: el.clientWidth, height: el.clientHeight });
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(el);
    return () => observer.disconnect();
  }, []);
  const bounds = project?.blocks.length ? sheetBounds(project) : null;
  const scale = bounds
    ? Math.min(
        1,
        (room.width - 16) / bounds.width,
        (room.height - 16) / bounds.height,
      )
    : 1;
  return (
    <div ref={box} className="example-preview-canvas" aria-hidden="true">
      {failed ? (
        <span className="example-preview-status">Preview unavailable</span>
      ) : !project ? (
        <LoaderCircle className="spin example-preview-status" size={16} />
      ) : bounds && room.width > 0 ? (
        <div
          className="example-preview-sheet"
          style={{
            width: bounds.width * scale,
            height: bounds.height * scale,
          }}
        >
          <div
            style={{
              transform: `scale(${scale})`,
              transformOrigin: '0 0',
            }}
          >
            <ExampleDiagram project={project} />
          </div>
        </div>
      ) : null}
    </div>
  );
}
