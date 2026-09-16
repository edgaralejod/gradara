'use client';
import { useEffect, useRef, useState } from 'react';
import {
  BookOpen,
  Check,
  ChevronRight,
  CircuitBoard,
  Copy,
  FilePlus2,
  FileText,
  FolderOpen,
  Gauge,
  LoaderCircle,
  Search,
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
import type { ModelSummary } from '@/lib/gradara/document-store';

export type BrowserSection = 'models' | 'examples' | 'trash';
const icons = { blank: FilePlus2, dc: Gauge, foc: CircuitBoard, buck: Zap, flyback: Zap };
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

export default function ModelBrowser({
  section: initialSection,
  activeId,
  onClose,
  onOpen,
  onCreate,
  onImport,
  onCopy,
}: {
  section: BrowserSection;
  activeId?: string;
  onClose: () => void;
  onOpen: (id: string) => Promise<void>;
  onCreate: (name: string, template: TemplateId) => Promise<void>;
  onImport: () => void;
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
  const examples = modelTemplates.filter(
    (item) =>
      item.id !== 'blank' &&
      `${item.title} ${item.description}`
        .toLowerCase()
        .includes(query.toLowerCase()),
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
              Examples<span>{modelTemplates.filter((template) => template.id !== 'blank').length}</span>
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
              {section !== 'examples' ? (
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
                <>
                  <p className="examples-explanation">
                    Examples are starting points. Using one creates a separate
                    model in <strong>My models</strong>.
                  </p>
                  <div className="example-file-list">
                    {examples.map((item) => {
                      const Icon = icons[item.id];
                      return (
                        <article key={item.id} className="example-file">
                          <span className={`template-icon template-${item.id}`}>
                            <Icon size={24} />
                          </span>
                          <div>
                            <small>{item.detail}</small>
                            <h3>{item.title}</h3>
                            <p>{item.description}</p>
                            <Button
                              variant="outline"
                              disabled={!!busy}
                              onClick={() =>
                                void perform(item.id, () =>
                                  onCreate(item.name, item.id),
                                )
                              }
                            >
                              {busy === item.id ? (
                                <LoaderCircle className="spin" size={14} />
                              ) : (
                                <Copy size={14} />
                              )}
                              Use example
                            </Button>
                          </div>
                        </article>
                      );
                    })}
                  </div>
                  {!examples.length && (
                    <p className="model-list-empty">No matching examples.</p>
                  )}
                </>
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
                : 'Built-in examples · Original files stay unchanged'}
          </span>
          <Button variant="outline" disabled={!!busy} onClick={onClose}>
            Close
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
