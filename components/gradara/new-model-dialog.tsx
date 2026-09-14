'use client';
import { useRef, useState } from 'react';
import {
  FilePlus2,
  CircuitBoard,
  Gauge,
  Zap,
  Check,
  LoaderCircle,
} from 'lucide-react';
import {
  Dialog,
  DialogContent,
  DialogTitle,
  DialogDescription,
} from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { modelTemplates, type TemplateId } from '@/lib/gradara/workspace';
const icons = { blank: FilePlus2, dc: Gauge, foc: CircuitBoard, buck: Zap };
export default function NewModelDialog({
  onClose,
  onCreate,
}: {
  onClose: () => void;
  onCreate: (name: string, template: TemplateId) => Promise<void>;
}) {
  const nameRef = useRef<HTMLInputElement>(null);
  const [template, setTemplate] = useState<TemplateId>('blank');
  const [name, setName] = useState('Untitled model');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const create = async () => {
    if (!name.trim() || busy) return;
    setBusy(true);
    setError('');
    try {
      await onCreate(name.trim(), template);
    } catch (e) {
      setError((e as Error).message);
      setBusy(false);
    }
  };
  return (
    <Dialog
      open
      onOpenChange={(open) => {
        if (!open && !busy) onClose();
      }}
    >
      <DialogContent
        className="new-model-dialog"
        showCloseButton={!busy}
        initialFocus={nameRef}
      >
        <div>
          <DialogTitle>New model</DialogTitle>
          <DialogDescription>
            Choose a starting point. Your current model is saved automatically.
          </DialogDescription>
        </div>
        <fieldset
          className="model-template-grid"
          aria-label="Model starting point"
        >
          {modelTemplates.map((item) => {
            const Icon = icons[item.id];
            return (
              <button
                key={item.id}
                type="button"
                className={`model-template ${template === item.id ? 'is-selected' : ''}`}
                aria-pressed={template === item.id}
                disabled={busy}
                onClick={() => {
                  const previous = modelTemplates.find(
                    (t) => t.id === template,
                  )!;
                  if (name === previous.name) setName(item.name);
                  setTemplate(item.id);
                }}
              >
                <span className={`template-icon template-${item.id}`}>
                  <Icon size={22} />
                </span>
                <strong>{item.title}</strong>
                <p>{item.description}</p>
                <small>{item.detail}</small>
                {template === item.id && (
                  <Check className="template-check" size={16} />
                )}
              </button>
            );
          })}
        </fieldset>
        <form
          onSubmit={(e) => {
            e.preventDefault();
            void create();
          }}
        >
          <label className="new-model-name" htmlFor="new-model-name">
            Model name
            <Input
              id="new-model-name"
              ref={nameRef}
              value={name}
              maxLength={100}
              disabled={busy}
              onChange={(e) => setName(e.target.value)}
            />
          </label>
          {error && (
            <p className="model-create-error" role="alert">
              {error}
            </p>
          )}
          <div className="dialog-actions">
            <Button
              type="button"
              variant="outline"
              disabled={busy}
              onClick={onClose}
            >
              Cancel
            </Button>
            <Button type="submit" disabled={busy || !name.trim()}>
              {busy ? (
                <LoaderCircle className="spin" size={15} />
              ) : (
                <FilePlus2 size={15} />
              )}{' '}
              {busy ? 'Creating…' : 'Create model'}
            </Button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  );
}
