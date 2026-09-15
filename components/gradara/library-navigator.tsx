'use client';
import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { useGeneratedLibrary } from '@/lib/gradara/generated-library';
import { Search, Sparkles } from 'lucide-react';
import { Input } from '@/components/ui/input';
import {
  library,
  type Definition,
  type LibraryCategoryId,
  type Port,
} from '@/lib/gradara/model';
import {
  categoryOf,
  categoryLabel,
  libraryCategories,
  searchLibrary,
} from '@/lib/gradara/catalog';
import { fuzzyRanges } from '@/lib/gradara/fuzzy';
import { BlockPreview } from './block-face';

function Highlight({ text, query }: { text: string; query: string }) {
  const ranges = fuzzyRanges(query, text);
  if (!ranges.length) return text;
  const parts: ReactNode[] = [];
  let cursor = 0;
  ranges.forEach(([start, end], i) => {
    if (start > cursor) parts.push(text.slice(cursor, start));
    parts.push(<mark key={i}>{text.slice(start, end)}</mark>);
    cursor = end;
  });
  if (cursor < text.length) parts.push(text.slice(cursor));
  return parts;
}

export default function LibraryNavigator({
  variant = 'panel',
  compatibleWith,
  onAdd,
  onAskAgent,
}: {
  variant?: 'panel' | 'popover';
  compatibleWith?: Port;
  onAdd: (definition: Definition) => void;
  onAskAgent?: () => void;
}) {
  const { entries, error, retry } = useGeneratedLibrary();
  const [source, setSource] = useState<'built-in' | 'ai'>('built-in');
  const definitions = useMemo(
    () =>
      source === 'ai' ? entries.map((entry) => entry.definition) : library,
    [source, entries],
  );
  const [query, setQuery] = useState('');
  const [category, setCategory] = useState<LibraryCategoryId | 'all'>('all');
  const [active, setActive] = useState(0);
  const searchRef = useRef<HTMLInputElement>(null);
  const hits = useMemo(
    () =>
      searchLibrary(
        query,
        source === 'ai' || query.trim() ? 'all' : category,
        compatibleWith,
        definitions,
      ),
    [query, category, compatibleWith, definitions, source],
  );
  useEffect(() => {
    if (variant === 'popover') searchRef.current?.focus();
  }, [variant]);

  const grouped = useMemo(() => {
    if (source === 'ai')
      return [{ id: 'ai' as const, label: 'Your AI blocks', items: hits }];
    if (query.trim())
      return [{ id: 'results' as const, label: 'Matches', items: hits }];
    return libraryCategories
      .filter((c) => category === 'all' || c.id === category)
      .map((c) => ({
        id: c.id,
        label: c.label,
        items: hits.filter((h) => categoryOf(h.definition) === c.id),
      }))
      .filter((g) => g.items.length);
  }, [hits, query, category, source]);

  const flat = grouped.flatMap((g) => g.items);
  const highlight = Math.min(active, Math.max(0, flat.length - 1));

  return (
    <div className={`library-navigator is-${variant}`}>
      <header className="library-titleblock">
        <span className="tb-kicker">Library</span>
        <strong>Components</strong>
        <span className="tb-count">{definitions.length}</span>
        <div className="search-field">
          <Search size={12} />
          <Input
            ref={searchRef}
            id={variant === 'panel' ? 'library-search' : undefined}
            value={query}
            onChange={(e) => {
              setQuery(e.target.value);
              setActive(0);
            }}
            placeholder="Find a component…"
            aria-label="Find a component"
            onKeyDown={(e) => {
              if (e.key === 'ArrowDown') {
                e.preventDefault();
                setActive((i) => Math.min(flat.length - 1, i + 1));
              } else if (e.key === 'ArrowUp') {
                e.preventDefault();
                setActive((i) => Math.max(0, i - 1));
              } else if (e.key === 'Enter' && flat[highlight]) {
                e.preventDefault();
                onAdd(flat[highlight].definition);
              }
            }}
          />
        </div>
      </header>
      <div className="library-index" aria-label="Library source">
        <button
          type="button"
          aria-pressed={source === 'built-in'}
          className={source === 'built-in' ? 'is-active' : ''}
          onClick={() => {
            setSource('built-in');
            setActive(0);
          }}
        >
          Built-in
        </button>
        <button
          type="button"
          aria-pressed={source === 'ai'}
          className={source === 'ai' ? 'is-active' : ''}
          onClick={() => {
            setSource('ai');
            setActive(0);
          }}
        >
          AI blocks · {entries.length}
        </button>
      </div>
      {source === 'ai' && (
        <p className="library-ai-note">
          Saved locally. Click or drag to insert an independent copy.
        </p>
      )}
      {source === 'ai' && error && (
        <div role="alert">
          {error}
          <button type="button" onClick={retry}>
            Retry library
          </button>
        </div>
      )}
      {source === 'ai' && !error && !entries.length && (
        <p className="library-ai-note">
          Checked agent generations will appear here automatically.
        </p>
      )}
      {source === 'built-in' && (
        <div className="library-index">
          <button
            type="button"
            className={category === 'all' ? 'is-active' : ''}
            onClick={() => {
              setCategory('all');
              setActive(0);
            }}
          >
            All
          </button>
          {libraryCategories.map((c) => (
            <button
              key={c.id}
              type="button"
              title={c.hint}
              className={category === c.id ? 'is-active' : ''}
              onClick={() => {
                setCategory(c.id);
                setActive(0);
              }}
            >
              {c.label}
            </button>
          ))}
        </div>
      )}
      <div className="library-legend">
        {grouped.map((group) => (
          <section key={group.id}>
            {(category === 'all' || query.trim()) && (
              <div className="library-group-label">{group.label}</div>
            )}
            {group.items.map((hit) => {
              const index = flat.indexOf(hit);
              const drawingOnly =
                !hit.definition.generated &&
                ['mux', 'demux', 'subsystem'].includes(hit.definition.kind);
              return (
                <button
                  key={
                    entries.find((entry) => entry.definition === hit.definition)
                      ?.id ?? hit.definition.kind
                  }
                  type="button"
                  draggable={variant === 'panel'}
                  className={`legend-row ${index === highlight ? 'is-active' : ''}`}
                  title={
                    drawingOnly
                      ? 'Drawing only — simulation is not available for this block yet.'
                      : hit.definition.description
                  }
                  onMouseEnter={() => setActive(index)}
                  onDragStart={(e) => {
                    e.dataTransfer.setData(
                      'application/gradara-component',
                      entries.find(
                        (entry) => entry.definition === hit.definition,
                      )?.id ?? hit.definition.kind,
                    );
                    e.dataTransfer.effectAllowed = 'copy';
                  }}
                  onClick={() => onAdd(hit.definition)}
                >
                  <span className="legend-preview">
                    <BlockPreview definition={hit.definition} miniature />
                  </span>
                  <span className="legend-copy">
                    {source === 'ai' && (
                      <small>
                        {entries.find(
                          (entry) => entry.definition === hit.definition,
                        )?.checked
                          ? 'Modelica checked'
                          : 'From saved model'}
                      </small>
                    )}
                    <span className="legend-name">
                      <Highlight text={hit.definition.name} query={query} />
                    </span>
                    <span className="legend-kind">
                      {drawingOnly
                        ? 'Drawing only · not yet simulated'
                        : hit.definition.description === hit.definition.name
                          ? categoryLabel(categoryOf(hit.definition))
                          : hit.definition.description}
                    </span>
                  </span>
                </button>
              );
            })}
          </section>
        ))}
        {!flat.length && (
          <div className="library-empty">No part under that name.</div>
        )}
      </div>
      {variant === 'panel' && (
        <a
          className="library-catalog-link"
          href="/block-catalog"
          target="_blank"
          rel="noreferrer"
        >
          View block design catalog ↗
        </a>
      )}
      {onAskAgent && (
        <button type="button" className="library-ask" onClick={onAskAgent}>
          <Sparkles size={12} />
          Missing a part
          <kbd>A</kbd>
        </button>
      )}
    </div>
  );
}
