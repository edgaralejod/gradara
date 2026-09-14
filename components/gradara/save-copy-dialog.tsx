'use client';
import { useRef, useState } from 'react';
import { Copy, LoaderCircle } from 'lucide-react';
import {
  Dialog,
  DialogContent,
  DialogTitle,
  DialogDescription,
} from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
export default function SaveCopyDialog({
  name,
  onClose,
  onSave,
}: {
  name: string;
  onClose: () => void;
  onSave: (name: string) => Promise<void>;
}) {
  const [value, setValue] = useState(`${name.slice(0, 95)} copy`);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const input = useRef<HTMLInputElement>(null);
  return (
    <Dialog
      open
      onOpenChange={(open) => {
        if (!open && !busy) onClose();
      }}
    >
      <DialogContent
        className="save-copy-dialog"
        initialFocus={input}
        showCloseButton={!busy}
      >
        <DialogTitle>Save a copy</DialogTitle>
        <DialogDescription>
          Create a separate model with your current edits.
        </DialogDescription>
        <form
          onSubmit={async (e) => {
            e.preventDefault();
            if (busy || !value.trim()) return;
            setBusy(true);
            setError('');
            try {
              await onSave(value.trim());
              onClose();
            } catch (err) {
              setError((err as Error).message);
              setBusy(false);
            }
          }}
        >
          <label className="new-model-name" htmlFor="copy-model-name">
            Model name
            <Input
              ref={input}
              id="copy-model-name"
              value={value}
              maxLength={100}
              disabled={busy}
              onChange={(e) => setValue(e.target.value)}
            />
          </label>
          {error && (
            <p role="alert" className="model-create-error">
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
            <Button type="submit" disabled={busy || !value.trim()}>
              {busy ? (
                <LoaderCircle size={15} className="spin" />
              ) : (
                <Copy size={15} />
              )}
              Save copy
            </Button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  );
}
