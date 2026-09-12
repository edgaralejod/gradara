'use client';
import { useEffect, useState } from 'react';
import {
  Dialog,
  DialogContent,
  DialogTitle,
  DialogDescription,
} from '@/components/ui/dialog';
import { Tabs, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Button } from '@/components/ui/button';
import type { Definition } from '@/lib/gradara/model';
import type { ComponentType } from 'react';
export default function EquationEditor({
  definition,
  onClose,
  onApply,
}: {
  definition: Definition;
  onClose: () => void;
  onApply: (definition: Definition) => void;
}) {
  const [equations, setEquations] = useState(definition.equations);
  const [declarations, setDeclarations] = useState(
    definition.declarations ?? '',
  );
  const [tab, setTab] = useState('equations');
  const [Editor, setEditor] = useState<ComponentType<any> | null>(null);
  const readonly = !definition.generated && definition.domain !== 'signal';
  useEffect(() => {
    let mounted = true;
    Promise.all([
      import('@monaco-editor/react'),
      import('monaco-editor'),
      import('monaco-editor/editor/editor.worker?worker'),
    ])
      .then(([module, monaco, worker]) => {
        if (!mounted) return;
        (globalThis as any).MonacoEnvironment = {
          getWorker: () => new worker.default(),
        };
        module.loader.config({ monaco });
        monaco.languages.register({ id: 'modelica' });
        monaco.languages.setMonarchTokensProvider('modelica', {
          tokenizer: {
            root: [
              [
                /\b(der|pre|sample|when|then|else|if|end|Real|Integer|Boolean|discrete|parameter|equation|initial)\b/,
                'keyword',
              ],
              [/\b\d+(\.\d+)?\b/, 'number'],
              [/\/\/.*$/, 'comment'],
            ],
          },
        });
        setEditor(() => module.default);
      })
      .catch(() => {});
    return () => {
      mounted = false;
    };
  }, []);
  return (
    <Dialog
      open
      onOpenChange={(open) => {
        if (!open) onClose();
      }}
    >
      <DialogContent className="source-dialog">
        <DialogTitle>{definition.name}</DialogTitle>
        <DialogDescription>
          {readonly
            ? 'Physical component equations are shown for inspection. Parameters remain editable in the inspector.'
            : 'Edit the component definition. Changes become part of your saved model.'}
        </DialogDescription>
        <Tabs value={tab} onValueChange={(v) => setTab(String(v))}>
          <TabsList variant="line">
            <TabsTrigger value="equations">Equations</TabsTrigger>
            <TabsTrigger value="declarations">State & declarations</TabsTrigger>
          </TabsList>
        </Tabs>
        <div className="monaco-container">
          {Editor ? (
            <Editor
              height="100%"
              language="modelica"
              theme="vs"
              value={tab === 'equations' ? equations : declarations}
              onChange={(value: string | undefined) =>
                tab === 'equations'
                  ? setEquations(value ?? '')
                  : setDeclarations(value ?? '')
              }
              options={{
                readOnly: readonly,
                fontSize: 14,
                minimap: { enabled: false },
                scrollBeyondLastLine: false,
                padding: { top: 16 },
                lineNumbers: 'on',
                automaticLayout: true,
                wordWrap: 'on',
              }}
            />
          ) : (
            <textarea
              aria-label="Component equations"
              readOnly={readonly}
              value={tab === 'equations' ? equations : declarations}
              onChange={(e) =>
                tab === 'equations'
                  ? setEquations(e.target.value)
                  : setDeclarations(e.target.value)
              }
            />
          )}
        </div>
        <div className="dialog-actions">
          <Button variant="outline" onClick={onClose}>
            Close
          </Button>
          {!readonly && (
            <Button
              onClick={() =>
                onApply({ ...definition, equations, declarations })
              }
            >
              Apply changes
            </Button>
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
}
