'use client';
// SPDX-License-Identifier: Apache-2.0
import { useEffect, useRef, useState, type ReactNode } from 'react';
import {
  Activity,
  ArrowUp,
  Boxes,
  CircleAlert,
  Eye,
  LoaderCircle,
  MousePointerSquareDashed,
  Plug,
  Sparkles,
  X,
} from 'lucide-react';
import { useAi } from '@/lib/gradara/ai';
import {
  actionInfo,
  availableActions,
  canSend,
  guessBlockType,
  nextAction,
  portBlockType,
  resolveAction,
  type AskAction,
  type AskContext,
} from '@/lib/gradara/ask';
import { blockTypes, inferBlockType, type BlockType } from '@/lib/gradara/block-creation';
import { formatPlotTime } from '@/lib/gradara/results';

export type AskSubmit = {
  action: AskAction;
  text: string;
  context: AskContext;
  blockType: BlockType;
};

/**
 * The one place to ask the AI. Where it opens decides what it does: the chips
 * show what will be sent and can be removed, the action and its price show
 * before sending, Tab moves to the next action, Enter sends, Shift+Enter adds
 * a line and Escape closes.
 */
export default function AskBar({
  variant,
  context,
  onContextChange,
  action: chosen,
  onAction,
  busy,
  revising,
  portDomain,
  names,
  onSubmit,
  onClose,
  onPreview,
  focusOnOpen,
  initialText,
}: {
  variant: 'floating' | 'docked';
  context: AskContext;
  onContextChange: (context: AskContext) => void;
  action?: AskAction;
  onAction: (action: AskAction) => void;
  busy: boolean;
  /** Set while the bar revises a proposal. */
  revising?: { summary: string; onStop: () => void };
  /** The domain of the open port a new block attaches to. */
  portDomain?: string;
  /** Block names by ID, for the selection chip. */
  names: (id: string) => string | undefined;
  onSubmit: (request: AskSubmit) => void;
  onClose?: () => void;
  /** Exactly what Explain results would send, for "Show what will be sent". */
  onPreview?: (context: AskContext, question: string) => Promise<string>;
  focusOnOpen?: boolean;
  /** Text to start with, such as a suggestion the user picked. */
  initialText?: string;
}) {
  const action = resolveAction(context, revising ? 'edit' : chosen);
  const info = actionInfo[action];
  const { label: price } = useAi(info.operation);
  const [text, setText] = useState(initialText ?? '');
  const [typeChoice, setTypeChoice] = useState<BlockType | null>(null);
  const [shown, setPreview] = useState<{ key: string; text: string; error: string } | null>(null);
  const [previewing, setPreviewing] = useState(false);
  const input = useRef<HTMLTextAreaElement>(null);
  useEffect(() => {
    if (focusOnOpen) input.current?.focus();
  }, [focusOnOpen]);
  // A preview belongs to the runs it was made for; other chips need a new one.
  const previewKey = JSON.stringify([context.runs, action]);
  const preview = shown?.key === previewKey ? shown : null;
  const blockType: BlockType =
    typeChoice ??
    (context.existing
      ? inferBlockType(context.existing.definition)
      : (portBlockType(portDomain) ?? guessBlockType(text)));
  const actions = revising ? (['edit'] as AskAction[]) : availableActions(context);
  const sendable = !busy && canSend(action, text);
  const submit = () => {
    if (!sendable) return;
    onSubmit({ action, text: text.trim(), context, blockType });
    setText('');
    setTypeChoice(null);
    setPreview(null);
  };
  const runs = context.runs;
  const chips: { key: string; icon: ReactNode; text: string; title?: string; remove?: () => void }[] = [];
  if (context.existing)
    chips.push({ key: 'existing', icon: <Boxes size={11} />, text: context.existing.definition.name });
  if (context.connection)
    chips.push({
      key: 'port',
      icon: <Plug size={11} />,
      text: `${names(context.connection.blockId) ?? 'Block'} · ${context.connection.portId}`,
      title: 'The new block connects to this port',
    });
  if (context.selection.length && (action === 'edit' || revising))
    chips.push({
      key: 'selection',
      icon: <MousePointerSquareDashed size={11} />,
      text: `Selection · ${context.selection.length} ${context.selection.length === 1 ? 'block' : 'blocks'}`,
      title: context.selection.map(names).filter(Boolean).join(', '),
      remove: () => onContextChange({ ...context, selection: [] }),
    });
  if (context.problems?.length)
    chips.push({
      key: 'problems',
      icon: <CircleAlert size={11} />,
      text:
        context.problems.length === 1
          ? context.problems[0].message
          : `${context.problems.length} problems`,
      remove: () => onContextChange({ ...context, problems: undefined }),
    });
  if (runs && action === 'results') {
    runs.runIds.forEach((id, i) =>
      chips.push({
        key: `run-${id}`,
        icon: <Activity size={11} />,
        text: `${'ABC'[i]} · ${runs.titles[id] ?? 'Run'}`,
        title: i === 0 ? 'The run the question is about' : 'Compared with run A',
        remove:
          runs.runIds.length > 1
            ? () =>
                onContextChange({
                  ...context,
                  runs: {
                    ...runs,
                    runIds: runs.runIds.filter((r) => r !== id),
                    baseline: runs.baseline === id ? undefined : runs.baseline,
                  },
                })
            : () => onContextChange({ ...context, runs: undefined }),
      }),
    );
    if (runs.signals.length)
      chips.push({
        key: 'signals',
        icon: <Activity size={11} />,
        text:
          runs.signals.length === 1
            ? (runs.signalNames[runs.signals[0]] ?? runs.signals[0])
            : `${runs.signals.length} plotted signals`,
        title: runs.signals.map((k) => runs.signalNames[k] ?? k).join(', '),
        remove: () => onContextChange({ ...context, runs: { ...runs, signals: [] } }),
      });
    if (runs.window) {
      const [t0, t1] = runs.window;
      chips.push({
        key: 'window',
        icon: <Activity size={11} />,
        text: `${formatPlotTime(t0, t1, t1 - t0)} – ${formatPlotTime(t1, t1, t1 - t0)}`,
        title: 'The zoomed time window of the active plot',
        remove: () => onContextChange({ ...context, runs: { ...runs, window: undefined } }),
      });
    }
  }
  if (context.inSubsystem && (action === 'edit' || action === 'explain' || action === 'fix'))
    chips.push({
      key: 'scope',
      icon: <CircleAlert size={11} />,
      text: 'Top level only',
      title: 'The AI edits and explains the top level of the model for now.',
    });
  const showPreview = async () => {
    if (!onPreview || previewing) return;
    if (preview) {
      setPreview(null);
      return;
    }
    setPreviewing(true);
    try {
      setPreview({ key: previewKey, text: await onPreview(context, text.trim() || '(your question)'), error: '' });
    } catch (e) {
      setPreview({ key: previewKey, text: '', error: (e as Error).message });
    } finally {
      setPreviewing(false);
    }
  };
  const chipRow = (chips.length > 0 || revising) && (
    <div className="ask-chips">
      {revising && (
        <span className="ask-chip is-revising" title={revising.summary}>
          Revising: {revising.summary}
          <button type="button" aria-label="Stop revising" onClick={revising.onStop}>
            <X size={10} />
          </button>
        </span>
      )}
      {chips.map((chip) => (
        <span key={chip.key} className="ask-chip" title={chip.title ?? chip.text}>
          {chip.icon}
          <span>{chip.text}</span>
          {chip.remove && (
            <button type="button" aria-label={`Remove ${chip.text}`} onClick={chip.remove}>
              <X size={10} />
            </button>
          )}
        </span>
      ))}
    </div>
  );
  return (
    <section className={`ask-bar is-${variant} nodrag nopan nowheel`} aria-label="Ask the AI">
      <header className="ask-heading">
        <Sparkles size={14} aria-hidden="true" />
        {actions.length > 1 ? (
          <label className="ask-action">
            <span className="sr-only">Action</span>
            <select
              aria-label="Action · Tab switches"
              title="Tab in the text box switches to the next action"
              value={action}
              disabled={busy}
              onChange={(e) => onAction(e.target.value as AskAction)}
            >
              {actions.map((a) => (
                <option key={a} value={a}>
                  {actionInfo[a].label}
                </option>
              ))}
            </select>
          </label>
        ) : (
          <strong className="ask-action-fixed">{revising ? 'Revise proposal' : info.label}</strong>
        )}
        {variant === 'docked' && chipRow}
        {(action === 'block' || action === 'refine-block') && (
          <label className="ask-type">
            <span>Type</span>
            <select
              aria-label="Block type"
              value={blockType}
              disabled={busy || action === 'refine-block'}
              title={blockTypes[blockType].description}
              onChange={(e) => setTypeChoice(e.target.value as BlockType)}
            >
              {Object.entries(blockTypes).map(([value, t]) => (
                <option key={value} value={value}>
                  {t.label}
                </option>
              ))}
            </select>
          </label>
        )}
        {onClose && (
          <button type="button" className="ask-close" aria-label="Close · Escape" title="Close · Escape" onClick={onClose}>
            <X size={13} />
          </button>
        )}
      </header>
      {variant === 'floating' && chipRow}
      <div className="ask-input">
        <textarea
          ref={input}
          aria-label={info.placeholder}
          placeholder={revising ? 'Describe what to change in the proposal…' : info.placeholder}
          value={text}
          maxLength={action === 'model' ? 8000 : action === 'results' ? 2000 : 4000}
          rows={variant === 'floating' ? 3 : 1}
          onChange={(e) => setText(e.target.value)}
          onKeyDown={(e) => {
            if (e.nativeEvent.isComposing) return;
            if (e.key === 'Escape' && onClose) {
              e.preventDefault();
              e.stopPropagation();
              onClose();
            } else if (e.key === 'Enter' && !e.shiftKey) {
              e.preventDefault();
              submit();
            } else if (e.key === 'Tab' && !e.shiftKey && actions.length > 1 && !revising) {
              e.preventDefault();
              onAction(nextAction(context, action));
            }
          }}
        />
        <button
          type="button"
          className="ask-send"
          aria-label={`${info.send} · Enter`}
          title={`${info.send} · Enter (Shift+Enter adds a line)`}
          disabled={!sendable}
          onClick={submit}
        >
          {busy ? <LoaderCircle size={14} className="spin" /> : <ArrowUp size={14} />}
        </button>
      </div>
      <footer className="ask-footer">
        <span className="ask-price">{price || 'AI'}</span>
        {action === 'results' && onPreview && (
          <button type="button" className="ask-link" aria-expanded={!!preview} onClick={() => void showPreview()}>
            <Eye size={11} />
            {previewing ? 'Preparing…' : preview ? 'Hide what will be sent' : 'Show what will be sent'}
          </button>
        )}
        {action === 'model' && <span className="ask-note">Opens as a new model; may take minutes.</span>}
      </footer>
      {preview && (
        <section className="ask-preview" aria-label="What will be sent">
          {preview.error ? (
            <p className="ask-preview-error">{preview.error}</p>
          ) : (
            <>
              <p>
                The question, a digest of the runs computed on this computer, the model without layout, and
                the earlier questions and answers of this discussion. The samples themselves are not sent.{' '}
                {preview.text.length.toLocaleString()} characters.
              </p>
              <pre>{preview.text}</pre>
            </>
          )}
        </section>
      )}
    </section>
  );
}
