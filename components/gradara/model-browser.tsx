'use client';
import { useEffect, useRef, useState } from 'react';
import {
  Blocks,
  BookOpen,
  Check,
  ChevronRight,
  CircuitBoard,
  Copy,
  CarFront,
  Crosshair,
  FilePlus2,
  FileText,
  FolderOpen,
  Gauge,
  LoaderCircle,
  Search,
  Thermometer,
  Trash2,
  RotateCcw,
  Upload,
  Zap,
} from 'lucide-react';
import {
  Dialog,
  DialogContent,
  DialogTitle,
  DialogDescription,
} from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { api } from '@/lib/gradara/api';
import { modelTemplates, type TemplateId } from '@/lib/gradara/workspace';
import { blockExamples } from '@/lib/gradara/block-examples';
import { definitionFor } from '@/lib/gradara/model';
import { ExampleGallery, type GalleryEntry } from './example-gallery';
import type { ModelSummary } from '@/lib/gradara/document-store';

export type BrowserSection = 'models' | 'examples' | 'blocks' | 'trash';
const icons = {
  blank: FilePlus2,
  dc: Gauge,
  foc: CircuitBoard,
  buck: Zap,
  flyback: Zap,
  datacenter: Thermometer,
  servo: Crosshair,
  ev: CarFront,
};
/** The complete systems: the curated templates other than the blank model. */
const showcase: GalleryEntry[] = modelTemplates
  .filter((t) => t.id !== 'blank')
  .map((t) => {
    const Icon = icons[t.id];
    return {
      id: t.id,
      title: t.title,
      name: t.name,
      summary: t.description,
      detail: t.detail,
      icon: (
        <span className={`template-icon template-${t.id}`}>
          <Icon size={16} />
        </span>
      ),
    };
  });

const blockName = (kind: string) => definitionFor(kind)?.name ?? kind;
/** One small model per block, grouped by area; the blocks it is about come first. */
const blockGallery: GalleryEntry[] = blockExamples.map((e) => ({
  id: `block-${e.id}` as TemplateId,
  title: e.title,
  name: `Example: ${e.title}`,
  summary: e.summary,
  group: e.area,
  detail: e.about.map(blockName).join(' · '),
  blocks: {
    about: e.about.map(blockName),
    also: e.kinds
      .filter(
        (k) =>
          !e.about.includes(k) &&
          !(k === 'subsystem' && e.about.includes('emptySubsystem')),
      )
      .map(blockName),
  },
}));

const dateLabel = (date: string) => {
  const value = new Date(date);
  return value.getTime() > 0
    ? new Intl.DateTimeFormat(undefined, {
        month: 'short',
        day: 'numeric',
        hour: 'numeric',
        minute: '2-digit',
      }).format(value)
    : 'Earlier model';
};

export type ImportError = { file: string; message: string; detail?: string };

export default function ModelBrowser({
  section: initialSection,
  activeId,
  onClose,
  onOpen,
  onCreate,
  onImport,
  importError,
  onDismissImportError,
  onCopy,
}: {
  section: BrowserSection;
  activeId?: string;
  onClose: () => void;
  onOpen: (id: string) => Promise<void>;
  onCreate: (name: string, template: TemplateId) => Promise<void>;
  onImport: () => void;
  /** Why the last Import file failed; shown here, where the user is, until dismissed. */
  importError?: ImportError | null;
  onDismissImportError?: () => void;
  onCopy: () => void;
}) {
  const [section, setSection] = useState(initialSection);
  const [query, setQuery] = useState('');
  const [models, setModels] = useState<ModelSummary[]>([]);
  const [trash, setTrash] = useState<ModelSummary[]>([]);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState('');
  const [error, setError] = useState('');
  const [refresh, setRefresh] = useState(0);
  const search = useRef<HTMLInputElement>(null);
  useEffect(() => {
    let alive = true;
    Promise.all([
      api<{ models: ModelSummary[] }>('/models'),
      api<{ models: ModelSummary[] }>('/models?trashed=true'),
    ])
      .then(([data, archived]) => {
        if (alive) {
          setModels(data.models);
          setTrash(archived.models);
          setLoading(false);
        }
      })
      .catch((e) => {
        if (alive) {
          setError(e.message);
          setLoading(false);
        }
      });
    return () => {
      alive = false;
    };
  }, [refresh]);
  const perform = async (key: string, operation: () => Promise<void>) => {
    if (busy) return;
    setBusy(key);
    setError('');
    try {
      await operation();
      onClose();
    } catch (e) {
      setError((e as Error).message);
      setBusy('');
    }
  };
  const move = async (id: string, action: 'trash' | 'restore') => {
    if (busy) return;
    setBusy(id);
    setError('');
    try {
      await api(`/models/${id}/${action}`, { method: 'POST' });
      setRefresh((n) => n + 1);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy('');
    }
  };
  const filtered = (section === 'trash' ? trash : models).filter((model) =>
    model.name.toLowerCase().includes(query.toLowerCase()),
  );
  const q = query.trim().toLowerCase();
  const examples: GalleryEntry[] = showcase.filter((e) =>
    `${e.title} ${e.summary} ${e.detail}`.toLowerCase().includes(q),
  );
  // A block example is found by the blocks in it too: "zener" finds the clamp.
  const blockEntries: GalleryEntry[] = blockGallery.filter((e) =>
    `${e.title} ${e.summary} ${e.group} ${[...e.blocks!.about, ...e.blocks!.also].join(' ')}`
      .toLowerCase()
      .includes(q),
  );
  return (
    <Dialog
      open
      onOpenChange={(open) => {
        if (!open && !busy) onClose();
      }}
    >
      <DialogContent
        className="model-browser"
        initialFocus={search}
        showCloseButton={!busy}
      >
        <div className="model-browser-heading">
          <DialogTitle>Model browser</DialogTitle>
          <DialogDescription>
            Open a saved model or start from an example.
          </DialogDescription>
        </div>
        <div className="model-browser-layout">
          <nav className="model-browser-nav" aria-label="Model locations">
            <button
              disabled={!!busy}
              aria-current={section === 'models' ? 'page' : undefined}
              onClick={() => {
                setSection('models');
                setQuery('');
              }}
            >
              <FolderOpen size={17} />
              My models<span>{models.length}</span>
            </button>
            <button
              disabled={!!busy}
              aria-current={section === 'examples' ? 'page' : undefined}
              onClick={() => {
                setSection('examples');
                setQuery('');
              }}
            >
              <BookOpen size={17} />
              Examples
              <span>{showcase.length}</span>
            </button>
            <button
              disabled={!!busy}
              aria-current={section === 'blocks' ? 'page' : undefined}
              onClick={() => {
                setSection('blocks');
                setQuery('');
              }}
            >
              <Blocks size={17} />
              Block examples
              <span>{blockGallery.length}</span>
            </button>
            <button
              disabled={!!busy}
              aria-current={section === 'trash' ? 'page' : undefined}
              onClick={() => {
                setSection('trash');
                setQuery('');
              }}
            >
              <Trash2 size={17} />
              Trash<span>{trash.length}</span>
            </button>
            <p>Stored on this computer</p>
            <button disabled={!!busy} onClick={onImport}>
              <Upload size={16} />
              Import file…
            </button>
            <button disabled={!!busy || !activeId} onClick={onCopy}>
              <Copy size={16} />
              Save a copy…
            </button>
          </nav>
          <section
            className="model-browser-main"
            aria-label={
              section === 'models'
                ? 'My models'
                : section === 'trash'
                  ? 'Trash'
                  : section === 'blocks'
                    ? 'Block examples'
                    : 'Examples'
            }
          >
            <div className="model-browser-tools">
              <label className="model-search" htmlFor="model-browser-search">
                <Search size={16} />
                <Input
                  ref={search}
                  id="model-browser-search"
                  aria-label="Search models"
                  placeholder={
                    section === 'models'
                      ? 'Search your models…'
                      : section === 'trash'
                        ? 'Search trash…'
                        : section === 'blocks'
                          ? 'Search by example or block name…'
                          : 'Search examples…'
                  }
                  value={query}
                  onChange={(e) => setQuery(e.target.value)}
                />
              </label>
              <Button
                disabled={!!busy}
                onClick={() =>
                  void perform('blank', () =>
                    onCreate('Untitled model', 'blank'),
                  )
                }
              >
                <FilePlus2 size={15} />
                New model
              </Button>
            </div>
            {importError && (
              <div className="model-browser-error import-error" role="alert">
                <strong>{importError.file}</strong> was not imported: {importError.message}{' '}
                Your models are unchanged.
                {importError.detail && (
                  <details>
                    <summary>Technical details</summary>
                    <pre>{importError.detail}</pre>
                  </details>
                )}
                <span className="import-error-actions">
                  <button onClick={onImport}>Try another file</button>
                  <button onClick={onDismissImportError}>Dismiss</button>
                </span>
              </div>
            )}
            {error && (
              <div className="model-browser-error" role="alert">
                {error}
                <button
                  onClick={() => {
                    setError('');
                    setLoading(true);
                    setRefresh((n) => n + 1);
                  }}
                >
                  Refresh list
                </button>
              </div>
            )}
            <div className="model-browser-content">
              {section !== 'examples' && section !== 'blocks' ? (
                <>
                  <div className="model-list-heading">
                    <span>Name</span>
                    <span>
                      {section === 'trash' ? 'Moved to Trash' : 'Last saved'}
                    </span>
                  </div>
                  {loading ? (
                    <div className="model-list-empty">
                      <LoaderCircle className="spin" size={20} />
                      Loading models…
                    </div>
                  ) : filtered.length ? (
                    filtered.map((model) => (
                      <div key={model.id} className="model-file-entry">
                        <button
                          className="model-file-row"
                          disabled={!!busy}
                          aria-label={`${section === 'trash' ? 'Restore' : 'Open'} ${model.name}`}
                          onClick={() =>
                            section === 'trash'
                              ? void move(model.id, 'restore')
                              : void perform(model.id, () => onOpen(model.id))
                          }
                        >
                          <span className="model-file-icon">
                            {busy === model.id ? (
                              <LoaderCircle className="spin" size={22} />
                            ) : (
                              <FileText size={22} />
                            )}
                          </span>
                          <span className="model-file-info">
                            <strong>
                              {model.name}
                              {model.id === activeId && (
                                <small>
                                  <Check size={11} />
                                  Open
                                </small>
                              )}
                            </strong>
                            <span>
                              {model.blocks === 0
                                ? 'Empty model'
                                : `${model.blocks} ${model.blocks === 1 ? 'block' : 'blocks'}`}
                              {model.exampleId &&
                                ` · From ${modelTemplates.find((t) => t.id === model.exampleId)?.title ?? model.exampleId}`}
                            </span>
                          </span>
                          <time dateTime={model.updatedAt}>
                            {dateLabel(model.updatedAt)}
                          </time>
                          {section === 'trash' ? (
                            <RotateCcw size={15} />
                          ) : (
                            <ChevronRight size={15} />
                          )}
                        </button>
                        {section === 'models' && (
                          <button
                            className="model-trash-button"
                            aria-label={`Move ${model.name} to Trash`}
                            title={
                              model.id === activeId
                                ? 'Open another model before moving this one to Trash'
                                : 'Move to Trash'
                            }
                            disabled={!!busy || model.id === activeId}
                            onClick={() => void move(model.id, 'trash')}
                          >
                            <Trash2 size={14} />
                          </button>
                        )}
                      </div>
                    ))
                  ) : (
                    <div className="model-list-empty">
                      <FolderOpen size={30} />
                      <strong>
                        {query
                          ? 'No matching models'
                          : section === 'trash'
                            ? 'Trash is empty'
                            : 'Your models live here'}
                      </strong>
                      <p>
                        {query
                          ? 'Try another name.'
                          : section === 'trash'
                            ? 'Models moved here can be restored.'
                            : 'Create a blank model or make a copy of an example.'}
                      </p>
                    </div>
                  )}
                </>
              ) : (
                <ExampleGallery
                  key={section}
                  entries={section === 'blocks' ? blockEntries : examples}
                  busy={busy}
                  empty="No matching examples."
                  onUse={(entry) =>
                    void perform(entry.id, () => onCreate(entry.name, entry.id))
                  }
                />
              )}
            </div>
          </section>
        </div>
        <div className="model-browser-footer">
          <span>
            {section === 'models'
              ? 'Autosaved locally · Click the model title to rename'
              : section === 'trash'
                ? 'Click a model to restore it · Nothing here is permanently deleted'
                : section === 'blocks'
                  ? 'One small runnable model per block · A block’s Help opens its example'
                  : 'Complete systems to start from · Original files stay unchanged'}
          </span>
          <Button variant="outline" disabled={!!busy} onClick={onClose}>
            Close
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
