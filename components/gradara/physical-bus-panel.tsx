'use client';
import { ArrowDown, ArrowUp, Plus, X } from 'lucide-react';
import { useState } from 'react';
import {
  domainColors,
  domainTitle,
  type Block,
  type Project,
} from '@/lib/gradara/model';
import {
  ELEMENT_DOMAINS,
  ELEMENT_PATTERN,
  elementsError,
  elementsOf,
  freeElementName,
  setElements,
  wiredElements,
  type Element,
} from '@/lib/gradara/physical-bus';

/**
 * The Elements section of a Physical bus: the named connections it bundles, each of
 * any physical type. Elements with one name on the bus blocks of one bus line are
 * joined. Every change is one undoable edit; a wired element keeps its wire's type.
 */
export function PhysicalBusPanel({
  view,
  block,
  onCommit,
}: {
  /** The open sheet, to know which elements have wires. */
  view: Project;
  block: Block;
  onCommit: (change: (p: Project) => Project) => void;
}) {
  const elements = elementsOf(block);
  const wired = wiredElements(view, block.id);
  const [error, setError] = useState<string>();
  const apply = (next: Element[]) => {
    const problem = elementsError(next);
    setError(problem);
    if (!problem) onCommit((p) => setElements(p, block.id, next));
  };
  const move = (i: number, by: number) => {
    const next = [...elements];
    [next[i], next[i + by]] = [next[i + by], next[i]];
    apply(next);
  };
  return (
    <div className="inspector-section bus-section physical-bus-section">
      <div className="section-label">Elements</div>
      <ol className="bus-list physical-bus-list">
        {elements.map((e, i) => (
          <li key={e.id}>
            <span
              className="physical-bus-dot"
              style={{ background: domainColors[e.domain] }}
              aria-hidden
            />
            <input
              key={e.name}
              aria-label={`Name of element ${i + 1}`}
              defaultValue={e.name}
              spellCheck={false}
              maxLength={32}
              onBlur={(ev) => {
                const name = ev.target.value.trim();
                if (name === e.name) return;
                if (!ELEMENT_PATTERN.test(name)) {
                  setError(
                    `“${name}” is not a valid name: a letter, then letters, digits, or _.`,
                  );
                  ev.target.value = e.name;
                  return;
                }
                apply(elements.map((x, k) => (k === i ? { ...x, name } : x)));
              }}
              onKeyDown={(ev) => {
                if (ev.key === 'Enter') ev.currentTarget.blur();
                if (ev.key === 'Escape') {
                  ev.currentTarget.value = e.name;
                  ev.currentTarget.blur();
                }
              }}
            />
            <select
              aria-label={`Type of ${e.name}`}
              value={e.domain}
              disabled={wired.has(e.id!)}
              title={
                wired.has(e.id!)
                  ? 'Set by its wire. Remove its wires to choose another type.'
                  : undefined
              }
              onChange={(ev) =>
                apply(
                  elements.map((x, k) =>
                    k === i
                      ? { ...x, domain: ev.target.value as Element['domain'] }
                      : x,
                  ),
                )
              }
            >
              {ELEMENT_DOMAINS.map((d) => (
                <option key={d} value={d}>
                  {domainTitle(d)}
                </option>
              ))}
            </select>
            <span className="instance-port-tools">
              <button
                type="button"
                aria-label={`Move ${e.name} up`}
                disabled={i === 0}
                onClick={() => move(i, -1)}
              >
                <ArrowUp size={11} />
              </button>
              <button
                type="button"
                aria-label={`Move ${e.name} down`}
                disabled={i === elements.length - 1}
                onClick={() => move(i, 1)}
              >
                <ArrowDown size={11} />
              </button>
              <button
                type="button"
                aria-label={`Remove ${e.name}`}
                disabled={elements.length <= 1}
                onClick={() => apply(elements.filter((_, k) => k !== i))}
              >
                <X size={11} />
              </button>
            </span>
          </li>
        ))}
      </ol>
      <div className="instance-ports-add">
        <button
          type="button"
          onClick={() =>
            apply([
              ...elements,
              { name: freeElementName(elements), domain: 'electrical' },
            ])
          }
        >
          <Plus size={11} /> Element
        </button>
      </div>
      {error && <p className="size-hint is-error">{error}</p>}
      <p className="size-hint">
        Wire this block’s bus terminal to another Physical bus, directly or
        through a subsystem’s physical bus port: elements with the same name on
        both ends are joined. An unwired element takes the type of the first
        terminal you connect. Removing an element removes its wires.
      </p>
    </div>
  );
}
