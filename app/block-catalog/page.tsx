'use client';
// SPDX-License-Identifier: Apache-2.0
import { useGeneratedLibrary } from '@/lib/gradara/generated-library';
import { useState, type CSSProperties } from 'react';
import Link from 'next/link';
import { ArrowLeft, Search, Shapes } from 'lucide-react';
import { BlockPreview } from '@/components/gradara/block-face';
import { library, domainColors } from '@/lib/gradara/model';
import { categoryOf, libraryCategories } from '@/lib/gradara/catalog';
import { defaultBlockSize } from '@/lib/gradara/block-design';
import './catalog.css';

export default function BlockCatalog() {
  const { entries, error, retry } = useGeneratedLibrary();
  const [source, setSource] = useState('built-in');
  const [query, setQuery] = useState('');
  const [category, setCategory] = useState('all');
  const [zoom, setZoom] = useState(1);
  const [specimens, setSpecimens] = useState(false);
  const pool =
    source === 'ai' ? entries.map((entry) => entry.definition) : library;
  const definitions = pool.filter(
    (d) =>
      (source === 'ai' || category === 'all' || categoryOf(d) === category) &&
      `${d.name} ${d.kind} ${d.description}`
        .toLowerCase()
        .includes(query.trim().toLowerCase()),
  );
  const groups =
    source === 'ai'
      ? [{ id: 'ai', label: 'Your AI blocks', items: definitions }]
      : libraryCategories.map((c) => ({
          ...c,
          items: definitions.filter((d) => categoryOf(d) === c.id),
        }));
  return (
    <main
      className="block-catalog"
      style={{ '--catalog-zoom': zoom } as CSSProperties}
    >
      <header className="catalog-heading">
        <Link href="/" aria-label="Return to Gradara">
          <ArrowLeft size={15} /> Gradara
        </Link>
        <span className="catalog-divider" />
        <Shapes size={16} />
        <h1>Design catalog</h1>
        <span className="catalog-heading-note">
          Block shapes, notation, and terminals
        </span>
      </header>
      <div className="catalog-controls">
        <label className="catalog-search">
          <Search size={14} />
          <input
            aria-label="Search block catalog"
            placeholder="Find a block…"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
          />
        </label>
        <select
          aria-label="Catalog source"
          value={source}
          onChange={(e) => setSource(e.target.value)}
        >
          <option value="built-in">Built-in blocks</option>
          <option value="ai">AI blocks</option>
        </select>
        <select
          aria-label="Block category"
          disabled={source === 'ai'}
          value={category}
          onChange={(e) => setCategory(e.target.value)}
        >
          <option value="all">All categories</option>
          {libraryCategories.map((c) => (
            <option key={c.id} value={c.id}>
              {c.label}
            </option>
          ))}
        </select>
        <label className="catalog-zoom">
          Scale
          <select
            aria-label="Preview zoom"
            value={zoom}
            onChange={(e) => setZoom(Number(e.target.value))}
          >
            <option value={1}>100%</option>
            <option value={1.5}>150%</option>
            <option value={2}>200%</option>
          </select>
        </label>
        <label className="catalog-specimens">
          <input
            type="checkbox"
            checked={specimens}
            onChange={(e) => setSpecimens(e.target.checked)}
          />
          Library previews
        </label>
        <span className="catalog-count" aria-live="polite">
          {definitions.length} {definitions.length === 1 ? 'block' : 'blocks'}
        </span>
      </div>
      <div className="catalog-content">
        {source === 'ai' && error && (
          <div className="catalog-error" role="alert">
            {error}
            <button onClick={retry}>Retry</button>
          </div>
        )}
        {groups
          .filter((group) => group.items.length)
          .map((group) => (
            <section
              className="catalog-section"
              key={group.id}
              aria-label={group.label}
            >
              <h2>
                {group.label}
                <span>{group.items.length}</span>
              </h2>
              <div className="catalog-grid">
                {group.items.map((d) => {
                  const size = defaultBlockSize(d);
                  const drawingOnly =
                    !d.generated &&
                    ['mux', 'demux', 'subsystem'].includes(d.kind);
                  return (
                    <article
                      className="catalog-card"
                      key={
                        entries.find((entry) => entry.definition === d)?.id ??
                        d.kind
                      }
                      data-kind={d.kind}
                    >
                      <header>
                        <strong>{d.name}</strong>
                        <span>
                          {size.width} × {size.height}
                        </span>
                      </header>
                      <div
                        className="catalog-stage"
                        style={{ minHeight: (size.height + 64) * zoom }}
                      >
                        <div
                          className="catalog-model"
                          style={{ width: size.width, height: size.height }}
                        >
                          <BlockPreview definition={d} />
                          <span className="catalog-block-name">{d.name}</span>
                        </div>
                      </div>
                      <p className="catalog-description">
                        {d.description === d.name
                          ? `${group.label} block.`
                          : d.description}
                      </p>
                      {specimens && (
                        <div className="catalog-library-sample">
                          <span className="legend-preview">
                            <BlockPreview definition={d} miniature compact />
                          </span>
                          <span className="legend-name">{d.name}</span>
                        </div>
                      )}
                      <footer>
                        <span className="catalog-domain">
                          <i style={{ background: domainColors[d.domain] }} />
                          {d.domain}
                        </span>
                        {drawingOnly ? (
                          <span className="catalog-warning">Drawing only</span>
                        ) : (
                          <code>{d.kind}</code>
                        )}
                      </footer>
                    </article>
                  );
                })}
              </div>
            </section>
          ))}
        {!definitions.length && (
          <div className="catalog-empty">
            <Shapes size={24} />
            <strong>
              {source === 'ai' && !pool.length
                ? 'No AI blocks yet'
                : 'No matching blocks'}
            </strong>
            <p>
              {source === 'ai' && !pool.length
                ? 'Blocks created in the workspace will appear here.'
                : 'Try another search or category.'}
            </p>
            {(query || category !== 'all') && (
              <button
                onClick={() => {
                  setQuery('');
                  setCategory('all');
                }}
              >
                Clear filters
              </button>
            )}
          </div>
        )}
      </div>
      <footer className="catalog-status">
        <span>Read-only reference · shared diagram renderer</span>
        <span>Diagram text 14 px · dimensions in diagram units</span>
      </footer>
    </main>
  );
}
