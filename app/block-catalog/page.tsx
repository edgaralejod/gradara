'use client';
import { useState } from 'react';
import Link from 'next/link';
import { Input } from '@/components/ui/input';
import { BlockPreview } from '@/components/gradara/block-face';
import { library } from '@/lib/gradara/model';
import { categoryOf, libraryCategories } from '@/lib/gradara/catalog';
import { defaultBlockSize } from '@/lib/gradara/block-design';
import './catalog.css';

export default function BlockCatalog() {
  const [query, setQuery] = useState('');
  const [category, setCategory] = useState('all');
  const [zoom, setZoom] = useState(1);
  const definitions = library.filter(
    (d) =>
      (category === 'all' || categoryOf(d) === category) &&
      `${d.name} ${d.kind} ${d.description}`
        .toLowerCase()
        .includes(query.toLowerCase()),
  );
  return (
    <main className="block-catalog">
      <header className="catalog-heading">
        <Link href="/">← Gradara</Link>
        <h1>Block design catalog</h1>
        <p>
          80 × 64 standard body · 14 px diagram text · {library.length} blocks
        </p>
      </header>
      <div className="catalog-controls">
        <Input
          aria-label="Search block catalog"
          placeholder="Find a block…"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
        />
        <select
          aria-label="Block category"
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
        <select
          aria-label="Preview zoom"
          value={zoom}
          onChange={(e) => setZoom(Number(e.target.value))}
        >
          <option value={1}>100% zoom</option>
          <option value={1.5}>150% zoom</option>
          <option value={2}>200% zoom</option>
        </select>
        <span aria-live="polite">{definitions.length} blocks</span>
      </div>
      <div
        className="catalog-grid"
        style={{ '--catalog-zoom': zoom } as React.CSSProperties}
      >
        {definitions.map((d) => {
          const size = defaultBlockSize(d);
          return (
            <article className="catalog-card" key={d.kind} data-kind={d.kind}>
              <header>
                <strong>{d.name}</strong>
                <span>
                  {size.width} × {size.height}
                </span>
              </header>
              <div className="catalog-stage">
                <div
                  className="catalog-model"
                  style={{ width: size.width, height: size.height }}
                >
                  <BlockPreview definition={d} />
                  <span className="catalog-block-name">{d.name}</span>
                </div>
              </div>
              <div className="catalog-library-sample">
                <span className="legend-preview">
                  <BlockPreview definition={d} miniature />
                </span>
                <span className="legend-copy">
                  <span className="legend-name">{d.name}</span>
                  <span className="legend-kind">{d.description}</span>
                </span>
              </div>
              <footer>
                <span>{d.domain}</span>
                <code>{d.kind}</code>
              </footer>
            </article>
          );
        })}
      </div>
      {!definitions.length && (
        <p className="catalog-empty">No blocks match your search.</p>
      )}
    </main>
  );
}
