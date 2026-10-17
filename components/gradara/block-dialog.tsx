'use client';
import { isBusBlock } from '@/lib/gradara/buses';
import { useEffect, useRef, useState } from 'react';
import {
  Dialog,
  DialogContent,
  DialogTitle,
  DialogDescription,
} from '@/components/ui/dialog';
import { Tabs, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Button } from '@/components/ui/button';
import {
  domainColors,
  library,
  type Block,
  type Definition,
} from '@/lib/gradara/model';
import type { BlockEdits } from '@/lib/gradara/project';
import type { ComponentType } from 'react';
import { Input } from '@/components/ui/input';
import ParameterList from './parameter-list';
import BlockHelpDialog from './block-help-dialog';
import { BusSignalsPanel } from './bus-signals-panel';
import { PhysicalBusPanel } from './physical-bus-panel';
import { isPhysicalBus } from '@/lib/gradara/physical-bus';
import { isTagKind, TAG_PATTERN, type TagKind } from '@/lib/gradara/tag-blocks';
import type { Domain, Project } from '@/lib/gradara/model';
import { TagTypeSelect } from './tag-properties';
import {
  breakAtDots,
  modelicaClassOnly,
  portKindLabel,
} from '@/lib/gradara/inspector-sections';

export type BlockDialogTab = 'properties' | 'equations' | 'declarations';

type Draft = {
  name: string;
  tag: string;
  tagDomain: Domain;
  values: Record<string, number>;
  equations: string;
  declarations: string;
};

function initialDraft(definition: Definition): Draft {
  return {
    name: definition.name,
    tag: definition.tag ?? '',
    tagDomain: definition.ports[0]?.domain ?? 'signal',
    values: Object.fromEntries(
      definition.parameters.map((p) => [p.id, p.value]),
    ),
    equations: definition.equations,
    declarations: definition.declarations ?? '',
  };
}

function isDirty(definition: Definition, draft: Draft, readonly: boolean) {
  return (
    draft.name.trim() !== definition.name ||
    (isTagKind(definition.kind) &&
      (draft.tag !== (definition.tag ?? '') ||
        draft.tagDomain !== definition.ports[0]?.domain)) ||
    definition.parameters.some((p) => draft.values[p.id] !== p.value) ||
    (!readonly &&
      (draft.equations !== definition.equations ||
        draft.declarations !== (definition.declarations ?? '')))
  );
}

function libraryDefaults(definition: Definition) {
  if (definition.generated) return undefined;
  const source = library.find((d) => d.kind === definition.kind);
  if (!source) return undefined;
  return Object.fromEntries(source.parameters.map((p) => [p.id, p.value]));
}

export default function BlockDialog({
  block,
  initialTab = 'properties',
  onClose,
  onApply,
  onCommit,
  wired = false,
  view,
}: {
  block: Block;
  /** The open sheet (a Physical bus needs to know which of its elements are wired). */
  view?: Project;
  /** A tag block with wires takes its type from them, so its Type is not chosen here. */
  wired?: boolean;
  initialTab?: BlockDialogTab;
  onClose: () => void;
  onApply: (edits: BlockEdits) => void;
  /** Applies a whole-project change at once (a bus block's Signals). */
  onCommit?: (change: (p: Project) => Project) => void;
}) {
  const definition = block.definition;
  const [helpOpen, setHelpOpen] = useState(false);
  // Mirrored in a ref so Enter can apply edits committed by the same keystroke.
  const [draft, setDraftState] = useState<Draft>(() =>
    initialDraft(definition),
  );
  const draftRef = useRef<Draft>(draft);
  const setDraft = (update: Partial<Draft>) => {
    draftRef.current = { ...draftRef.current, ...update };
    setDraftState(draftRef.current);
  };
  const [tab, setTab] = useState<BlockDialogTab>(initialTab);
  const [Editor, setEditor] = useState<ComponentType<any> | null>(null);
  const firstParameter = useRef<HTMLInputElement>(null);
  // A bus block's equations follow its Signals (buses.ts), so they are shown, not edited.
  const bus = isBusBlock(definition);
  const physicalBus = isPhysicalBus(definition);
  const tagged = isTagKind(definition.kind);
  const readonly =
    !definition.generated &&
    (definition.domain !== 'signal' ||
      !!definition.modelica ||
      bus ||
      tagged ||
      physicalBus);
  const readOnlyMessage = bus
    ? 'These equations follow the Signals on the Properties tab.'
    : 'Built-in equations are shown for inspection and cannot be edited.';
  const defaults = libraryDefaults(definition);
  // Show only what this block has: code tabs for blocks defined by equations you
  // can read or edit, and a Parameters section only when there are parameters.
  // A tag block has no equations: tags are joined when the model is emitted.
  const showEquations =
    !tagged &&
    !physicalBus &&
    !modelicaClassOnly(definition) &&
    !definition.subsystem &&
    (!readonly || !!definition.equations?.trim());
  const showDeclarations =
    !tagged &&
    !physicalBus &&
    !definition.subsystem &&
    (!readonly || !!definition.declarations?.trim());
  const tagValid = !tagged || TAG_PATTERN.test(draft.tag);
  const activeTab: BlockDialogTab =
    (tab === 'equations' && !showEquations) ||
    (tab === 'declarations' && !showDeclarations)
      ? 'properties'
      : tab;
  const dirty = isDirty(definition, draft, readonly);

  const apply = () => {
    const current = draftRef.current;
    if (!isDirty(definition, current, readonly)) return;
    if (tagged && !TAG_PATTERN.test(current.tag)) return;
    onApply({
      name: current.name,
      ...(tagged
        ? {
            tag: current.tag,
            ...(wired ? {} : { tagDomain: current.tagDomain }),
          }
        : {}),
      parameters: current.values,
      ...(readonly
        ? {}
        : { equations: current.equations, declarations: current.declarations }),
    });
  };

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

  // Read-only code is the definition's own (a bus block's equations follow its
  // Signals, which change while this dialog is open); editable code is the draft's.
  const code = readonly
    ? activeTab === 'equations'
      ? definition.equations
      : (definition.declarations ?? '')
    : activeTab === 'equations'
      ? draft.equations
      : draft.declarations;
  const setCode = (value: string) =>
    setDraft(
      activeTab === 'equations'
        ? { equations: value }
        : { declarations: value },
    );

  return (
    <Dialog
      open
      onOpenChange={(open) => {
        if (!open) onClose();
      }}
    >
      <DialogContent
        className="source-dialog block-dialog"
        resizeKey="block"
        initialFocus={
          initialTab === 'properties' && definition.parameters.length
            ? firstParameter
            : undefined
        }
      >
        <DialogTitle>{definition.name}</DialogTitle>
        <DialogDescription>
          {activeTab === 'properties'
            ? tagged
              ? 'Edit the name, tag, and type of this block. Apply saves all changes as one undo step.'
              : definition.parameters.length
                ? 'Edit the name and parameters of this block. Apply saves all changes as one undo step.'
                : 'Edit the name of this block. It has no parameters.'
            : readonly
              ? 'Built-in physical equations are shown for inspection. Parameters stay editable on the Properties tab.'
              : 'Edit the component definition. Changes become part of your saved model.'}
        </DialogDescription>
        {(showEquations || showDeclarations) && (
          <Tabs
            value={activeTab}
            onValueChange={(v) => setTab(v as BlockDialogTab)}
          >
            <TabsList variant="line">
              <TabsTrigger value="properties">Properties</TabsTrigger>
              {showEquations && (
                <TabsTrigger value="equations">Equations</TabsTrigger>
              )}
              {showDeclarations && (
                <TabsTrigger value="declarations">
                  State & declarations
                </TabsTrigger>
              )}
            </TabsList>
          </Tabs>
        )}
        {activeTab === 'properties' ? (
          <div className="block-dialog-properties">
            <section>
              <div className="section-label">Name</div>
              <Input
                className="block-dialog-name"
                aria-label="Component name"
                maxLength={100}
                value={draft.name}
                onChange={(e) => setDraft({ name: e.target.value })}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') apply();
                }}
              />
              {tagged && (
                <>
                  <div className="section-label block-dialog-tag-label">
                    Tag
                  </div>
                  <Input
                    className="block-dialog-tag"
                    aria-label="Tag"
                    aria-invalid={!tagValid}
                    maxLength={32}
                    spellCheck={false}
                    value={draft.tag}
                    onChange={(e) => setDraft({ tag: e.target.value })}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter') apply();
                    }}
                  />
                  <p className={`size-hint${tagValid ? '' : ' is-error'}`}>
                    {tagValid
                      ? definition.kind === 'goto'
                        ? 'Every From with this tag, on this sheet or inside a subsystem on it, gives this signal back.'
                        : definition.kind === 'from'
                          ? 'Reads the Goto with this tag on this sheet or the nearest sheet above.'
                          : 'Joins every label with this tag here, above, and inside the subsystems on this sheet.'
                      : 'A letter, then letters, digits, or _ (up to 32).'}
                  </p>
                  <div className="section-label block-dialog-tag-label">
                    Type
                  </div>
                  <TagTypeSelect
                    kind={definition.kind as TagKind}
                    value={draft.tagDomain}
                    wired={wired}
                    className="block-dialog-type"
                    onChange={(tagDomain) => setDraft({ tagDomain })}
                  />
                </>
              )}
              {definition.description && (
                <p className="block-dialog-description">
                  {definition.description}
                </p>
              )}
              <p className="block-dialog-identity">
                {definition.modelica?.class && (
                  <code className="block-dialog-class">
                    {breakAtDots(definition.modelica.class)}
                  </code>
                )}
                <span>
                  Block ID <code>{block.id}</code>
                </span>
              </p>
            </section>
            {physicalBus && onCommit && view && (
              <section className="block-dialog-signals">
                <PhysicalBusPanel
                  view={view}
                  block={block}
                  onCommit={onCommit}
                />
                <p className="size-hint">
                  Changes to the elements apply at once, each as one undo step.
                </p>
              </section>
            )}
            {bus && onCommit && (
              <section className="block-dialog-signals">
                <BusSignalsPanel
                  block={block}
                  view={view}
                  onCommit={onCommit}
                />
                <p className="size-hint">
                  Changes to the signals apply at once, each as one undo step.
                </p>
              </section>
            )}
            {definition.parameters.length > 0 && (
              <section>
                <div className="section-label">
                  Parameters<span>{definition.parameters.length}</span>
                </div>
                <ParameterList
                  blockId={block.id}
                  parameters={definition.parameters.map((p) => ({
                    ...p,
                    value: draft.values[p.id],
                  }))}
                  defaults={defaults}
                  firstInputRef={firstParameter}
                  live
                  onEnter={apply}
                  onChange={(id, value) =>
                    setDraft({
                      values: { ...draftRef.current.values, [id]: value },
                    })
                  }
                />
              </section>
            )}
            <section>
              <div className="section-label">Interface</div>
              {definition.ports.map((p) => (
                <div key={p.id} className="interface-row">
                  <span
                    className="port-dot"
                    style={{ background: domainColors[p.domain] }}
                  />
                  <span>{p.name}</span>
                  <code>{portKindLabel(p)}</code>
                </div>
              ))}
            </section>
          </div>
        ) : (
          <div className="monaco-container">
            {Editor ? (
              <Editor
                height="100%"
                language="modelica"
                theme="vs"
                value={code}
                onChange={(value: string | undefined) => setCode(value ?? '')}
                options={{
                  readOnly: readonly,
                  readOnlyMessage: { value: readOnlyMessage },
                  // Widgets (this message, hovers) may extend past the editor's
                  // box; the dialog clips overflow, so they are positioned on the page.
                  fixedOverflowWidgets: true,
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
                aria-label={
                  activeTab === 'equations'
                    ? 'Component equations'
                    : 'Component declarations'
                }
                readOnly={readonly}
                value={code}
                onChange={(e) => setCode(e.target.value)}
              />
            )}
          </div>
        )}
        <div className="dialog-actions">
          <Button
            variant="ghost"
            className="dialog-help"
            onClick={() => setHelpOpen(true)}
          >
            Help
          </Button>
          {helpOpen && (
            <BlockHelpDialog
              definition={definition}
              onClose={() => setHelpOpen(false)}
            />
          )}
          {dirty && (
            <output className="block-dialog-dirty">
              <i />
              Unapplied changes
            </output>
          )}
          <Button variant="outline" onClick={onClose}>
            {dirty ? 'Cancel' : 'Close'}
          </Button>
          <Button disabled={!dirty || !tagValid} onClick={apply}>
            Apply
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
