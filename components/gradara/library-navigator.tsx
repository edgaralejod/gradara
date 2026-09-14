'use client';
import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
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
  const [query, setQuery] = useState('');
  const [category, setCategory] = useState<LibraryCategoryId | 'all'>('all');
  const [active, setActive] = useState(0);
  const searchRef = useRef<HTMLInputElement>(null);
  const hits = useMemo(
    () => searchLibrary(query, query.trim() ? 'all' : category, compatibleWith),
    [query, category, compatibleWith],
  );
  useEffect(() => {
    if (variant === 'popover') searchRef.current?.focus();
  }, [variant]);

  const grouped = useMemo(() => {
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
  }, [hits, query, category]);

  const flat = grouped.flatMap((g) => g.items);
  const highlight = Math.min(active, Math.max(0, flat.length - 1));

  return (
    <div className={`library-navigator is-${variant}`}>
      <header className="library-titleblock">
        <span className="tb-kicker">Library</span>
        <strong>Components</strong>
        <span className="tb-count">{library.length}</span>
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
                  key={hit.definition.kind}
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
                      hit.definition.kind,
                    );
                    e.dataTransfer.effectAllowed = 'copy';
                  }}
                  onClick={() => onAdd(hit.definition)}
                >
                  <span className="legend-preview">
                    <BlockPreview definition={hit.definition} miniature />
                  </span>
                  <span className="legend-copy">
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
