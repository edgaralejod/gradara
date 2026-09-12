'use client';
import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { Search, Sparkles } from 'lucide-react';
import { Input } from '@/components/ui/input';
import {
  domainColors,
  library,
  type Definition,
  type LibraryCategoryId,
  type Port,
} from '@/lib/gradara/model';
import {
  categoryOf,
  libraryCategories,
  searchLibrary,
} from '@/lib/gradara/catalog';
import { fuzzyRanges } from '@/lib/gradara/fuzzy';
import { BlockSymbol } from './block-symbol';

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

function Specimen({ definition }: { definition: Definition }) {
  const sum = definition.kind === 'sum' || definition.kind === 'subtract';
  return (
    <span
      className={`specimen notation-${sum ? 'sum' : definition.kind === 'gain' ? 'gain' : definition.kind}`}
      style={{ '--domain': domainColors[definition.domain] } as React.CSSProperties}
    >
      <svg className="specimen-outline" viewBox="0 0 100 100" preserveAspectRatio="none">
        {sum ? (
          <ellipse cx="50" cy="50" rx="46" ry="46" />
        ) : definition.kind === 'gain' ? (
          <polygon points="4,8 96,50 4,92" />
        ) : definition.kind === 'mux' ? (
          <polygon points="12,8 90,24 90,76 12,92" />
        ) : definition.kind === 'demux' ? (
          <polygon points="10,24 88,8 88,92 10,76" />
        ) : ['ground', 'resistor', 'capacitor', 'inductor', 'diode'].includes(
            definition.kind,
          ) ? null : (
          <rect x="5" y="8" width="90" height="84" rx="0" />
        )}
      </svg>
      <span className="specimen-symbol">
        <BlockSymbol definition={definition} />
        {sum && (
          <span className="library-sum">
            {definition.kind === 'sum' ? '+' : '±'}
          </span>
        )}
      </span>
    </span>
  );
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
    () =>
      searchLibrary(query, query.trim() ? 'all' : category, compatibleWith),
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
        <span className="tb-kicker">Sheet</span>
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
            placeholder="Find"
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
              return (
                <button
                  key={hit.definition.kind}
                  type="button"
                  draggable={variant === 'panel'}
                  className={`legend-row ${index === highlight ? 'is-active' : ''}`}
                  title={hit.definition.description}
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
                  <Specimen definition={hit.definition} />
                  <span className="legend-copy">
                    <span className="legend-name">
                      <Highlight text={hit.definition.name} query={query} />
                    </span>
                    <span className="legend-kind">{hit.definition.kind}</span>
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
