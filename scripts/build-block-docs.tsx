/**
 * Write the block reference pages of gradara.app: site/public/docs/blocks/index.html and
 * one page per library block, from the same reference model as the workbench's Help
 * dialog (lib/gradara/block-reference.ts). Run after changing a block or its docs:
 * `npm run docs:blocks`. `--check` fails instead of writing when the checked-in pages
 * are out of date.
 *
 * Each page draws the block with the workbench's own renderer (BlockPreview), so the
 * picture is exactly what the canvas shows. The site's Content-Security-Policy allows
 * no inline styles, so every `style` attribute React writes becomes a class in the
 * generated site/public/assets/block-faces.css, next to a copy of app/blocks.css.
 *
 * Links are root-absolute: Firebase serves the index at /docs/blocks (no trailing
 * slash, cleanUrls), where a relative link like `resistor.html` would resolve to
 * /docs/resistor.html.
 */
import { createHash } from 'node:crypto';
import {
  existsSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import type { CSSProperties, ReactNode } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { BlockPreview } from '../components/gradara/block-face';
import { defaultBlockSize } from '../lib/gradara/block-design';
import { library, type Definition } from '../lib/gradara/model';
import { blockDocs } from '../lib/gradara/block-docs';
import {
  DOCS_ORIGIN,
  blockDocsPath,
  blockReference,
  codeSpans,
  type BlockReference,
  type ReferencePort,
} from '../lib/gradara/block-reference';
import { categoryOf, libraryCategories } from '../lib/gradara/catalog';
import {
  blockExamples,
  exampleForKind,
  type BlockExample,
} from '../lib/gradara/block-examples';
import type { Project } from '../lib/gradara/model';
import { ExampleDiagram, sheetBounds } from './example-diagram';

const OUT = 'site/public/docs/blocks';
const FACES_CSS = 'site/public/assets/block-faces.css';
const EXAMPLES_CSS = 'site/public/assets/examples';
const check = process.argv.includes('--check');

// ---------------------------------------------------------------------------------
// Content helpers

/** Shipped examples, by the block kinds they use (inside subsystems too). */
function exampleUse() {
  const use = new Map<string, string[]>();
  for (const file of readdirSync('models/examples').filter((f) =>
    f.endsWith('.json'),
  )) {
    const doc = JSON.parse(readFileSync(`models/examples/${file}`, 'utf8'));
    const kinds = new Set<string>();
    for (const sheet of [doc, ...(doc.subsystems ?? [])])
      for (const b of sheet.blocks ?? []) kinds.add(b.definition.kind);
    for (const kind of kinds)
      use.set(kind, [...(use.get(kind) ?? []), doc.name]);
  }
  return use;
}

const use = exampleUse();
const refs = new Map<string, BlockReference>(
  library.map((d) => [
    d.kind,
    blockReference(d, blockDocs[d.kind], library, use.get(d.kind) ?? []),
  ]),
);
const categories = libraryCategories
  .map((c) => ({
    ...c,
    blocks: library.filter((d) => categoryOf(d) === c.id),
  }))
  .filter((c) => c.blocks.length);
const categoryIdOf = (label: string) =>
  categories.find((c) => c.label === label)?.id ?? 'other';

/** Text with `code` spans. */
function Rich({ text }: { text: string }) {
  return (
    <>
      {codeSpans(text).map((part, i) =>
        i % 2 ? <code key={i}>{part}</code> : part,
      )}
    </>
  );
}

/** The site's port-shape class for a reference domain label (see site.css `.port`). */
const PORT_SHAPE: Record<string, string> = {
  signal: 'signal',
  Boolean: 'boolean',
  electrical: 'electrical',
  rotational: 'mechanical',
  translational: 'translational',
  thermal: 'thermal',
  magnetic: 'magnetic',
  '3-phase': 'three-phase',
};
const shapeOf = (domain: string) => PORT_SHAPE[domain] ?? 'signal';

function PortMark({ domain }: { domain: string }) {
  return <span className={`port ${shapeOf(domain)}`} aria-hidden="true" />;
}

/** The domains a block's ports use, in a stable order. */
function domainsOf(ref: BlockReference) {
  const seen = new Set(
    [...ref.inputs, ...ref.outputs, ...ref.terminals].map((p) => p.domain),
  );
  return Object.keys(PORT_SHAPE).filter((d) => seen.has(d));
}

function Anchor({ id, children }: { id: string; children: ReactNode }) {
  return (
    <h2 id={id}>
      <a className="anchor" href={`#${id}`}>
        {children}
      </a>
    </h2>
  );
}

// ---------------------------------------------------------------------------------
// Block drawings

/** The block at canvas size, scaled up to fill the drawing sheet. */
function Drawing({ definition }: { definition: Definition }) {
  const size = defaultBlockSize(definition);
  const k = Math.max(1, Math.min(2.25, 300 / size.width, 200 / size.height));
  return (
    <span
      className="sheet-stage"
      style={
        {
          width: size.width * k,
          height: size.height * k,
          '--k': k.toFixed(3),
        } as CSSProperties
      }
    >
      <BlockPreview definition={definition} />
    </span>
  );
}

function Thumb({ definition }: { definition: Definition }) {
  return (
    <span className="thumb" aria-hidden="true">
      <BlockPreview definition={definition} miniature />
    </span>
  );
}

// ---------------------------------------------------------------------------------
// Page chrome

const Arrow = () => (
  <svg viewBox="0 0 16 16" aria-hidden="true" className="icon">
    <path d="M5 11 11 5M6 5h5v5" />
  </svg>
);

function Page({
  title,
  description,
  canonical,
  bodyClass,
  stylesheet,
  children,
}: {
  title: string;
  description: string;
  canonical: string;
  bodyClass: string;
  /** A page-specific stylesheet: the example diagram's geometry. */
  stylesheet?: string;
  children: ReactNode;
}) {
  return (
    <html lang="en">
      <head>
        <meta charSet="utf-8" />
        <meta name="viewport" content="width=device-width, initial-scale=1" />
        <title>{`${title} · Gradara`}</title>
        <meta name="description" content={description} />
        <meta name="theme-color" content="#0a0e13" />
        <link rel="canonical" href={canonical} />
        <link rel="icon" href="/assets/icon.svg" type="image/svg+xml" />
        <link rel="stylesheet" href="/assets/site.css" />
        <link rel="stylesheet" href="/assets/block-faces.css" />
        <link rel="stylesheet" href="/assets/docs.css" />
        {stylesheet && <link rel="stylesheet" href={stylesheet} />}
        <script src="/assets/site.js" defer />
        <script src="/assets/docs.js" defer />
      </head>
      <body className={bodyClass}>
        <a className="skip" href="#main">
          Skip to content
        </a>
        <header className="site-header">
          <nav className="nav wrap docs-wrap" aria-label="Main">
            <a className="brand" href="/">
              <img src="/assets/icon.svg" alt="" width={28} height={28} />
              Gradara
            </a>
            <button
              className="nav-toggle"
              type="button"
              aria-controls="site-navigation"
              aria-expanded="false"
            >
              Menu
            </button>
            <div className="nav-links" id="site-navigation">
              <a href="/#features">Features</a>
              <a href="/#pricing">Pricing</a>
              <a href="/docs/blocks" aria-current="page" className="is-current">
                Blocks
              </a>
              <a href="https://github.com/edgaralejod/gradara/tree/main/docs">
                Docs
              </a>
              <a className="button small primary" href="/#download">
                Download
              </a>
            </div>
          </nav>
        </header>
        {children}
        <footer className="site-footer">
          <div className="wrap docs-wrap footer-inner">
            <p>© 2026 Virtu Services LLC</p>
            <div className="footer-links">
              <a href="/privacy.html">Privacy</a>
              <a href="/terms.html">Terms</a>
              <a href="https://github.com/edgaralejod/gradara">GitHub</a>
              <a href="mailto:support@virtu-services.us">Support</a>
            </div>
          </div>
        </footer>
      </body>
    </html>
  );
}

/** Every block, by category; the current one is marked and its category open. */
function Library({ current }: { current: BlockReference }) {
  return (
    <aside className="docs-nav" aria-label="Block library">
      <div className="docs-nav-inner">
        <label className="search">
          <span className="sr-only">Filter blocks</span>
          <svg viewBox="0 0 16 16" aria-hidden="true" className="icon">
            <circle cx="7" cy="7" r="4.5" />
            <path d="m10.5 10.5 3 3" />
          </svg>
          <input
            type="search"
            placeholder="Filter blocks"
            data-filter="nav"
            autoComplete="off"
          />
        </label>
        <a className="docs-nav-all" href="/docs/blocks">
          All blocks <span>{library.length}</span>
        </a>
        {categories.map((c) => (
          <details key={c.id} open={c.label === current.category} data-group="">
            <summary>
              {c.label} <span>{c.blocks.length}</span>
            </summary>
            <ul>
              {c.blocks.map((d) => (
                <li
                  key={d.kind}
                  data-name={`${d.name} ${d.kind}`.toLowerCase()}
                >
                  <a
                    href={blockDocsPath(d.kind)}
                    aria-current={d.kind === current.kind ? 'page' : undefined}
                  >
                    {d.name}
                  </a>
                </li>
              ))}
            </ul>
          </details>
        ))}
        <p className="docs-nav-empty" hidden>
          No blocks match.
        </p>
      </div>
    </aside>
  );
}

// ---------------------------------------------------------------------------------
// Example diagrams: each drawn once, its geometry in its own stylesheet

type ExampleView = {
  template: string;
  title: string;
  summary: string;
  /** Other library blocks the example shows. */
  others: string[];
  html: string;
  stylesheet: string;
};
const exampleCss = new Map<string, string>();
const exampleViews = new Map<string, ExampleView>();
const DIAGRAM_WIDTH = 780;

function exampleView(template: string, title: string): ExampleView {
  const cached = exampleViews.get(template);
  if (cached) return cached;
  const block = template.startsWith('block-');
  const id = block ? template.slice('block-'.length) : template;
  const doc = JSON.parse(
    readFileSync(`models/examples/${block ? `blocks/${id}` : id}.json`, 'utf8'),
  ) as Project;
  const entry: BlockExample | undefined = blockExamples.find(
    (e) => e.id === id,
  );
  const box = sheetBounds(doc);
  // Wide examples scroll sideways rather than shrink past legibility.
  const k = Math.max(0.8, Math.min(1, DIAGRAM_WIDTH / box.width));
  const rules = new Map<string, string>();
  const html = withoutInlineStyles(
    renderToStaticMarkup(
      <span
        className="example-scale"
        style={
          {
            width: Math.round(box.width * k),
            height: Math.round(box.height * k),
            '--k': k.toFixed(4),
          } as CSSProperties
        }
      >
        <ExampleDiagram project={doc} />
      </span>,
    ),
    rules,
    'x',
  );
  const name = `${EXAMPLES_CSS}/${template}.css`;
  exampleCss.set(
    name,
    `/* Generated by scripts/build-block-docs.tsx; do not edit. */
${[...rules.keys()]
  .sort()
  .map((key) => rules.get(key))
  .join('\n')}
`,
  );
  const kinds = new Set<string>();
  for (const sheet of [doc, ...(doc.subsystems ?? [])])
    for (const b of sheet.blocks) kinds.add(b.definition.kind);
  const view: ExampleView = {
    template,
    title,
    summary: entry?.summary ?? doc.description ?? '',
    others: library.map((d) => d.kind).filter((k) => kinds.has(k)),
    html,
    stylesheet: `/${name.replace('site/public/', '')}`,
  };
  exampleViews.set(template, view);
  return view;
}

function ExampleSection({ kind, name }: { kind: string; name: string }) {
  const link = exampleForKind(kind);
  if (!link) return null;
  const view = exampleView(link.template, link.title);
  const others = view.others.filter((k) => k !== kind);
  return (
    <section className="doc-section">
      <Anchor id="example">Example</Anchor>
      <p className="example-title">
        <strong>{view.title}</strong> {view.summary}
      </p>
      <figure className="example-sheet">
        <div
          className="example-canvas"
          dangerouslySetInnerHTML={{ __html: view.html }}
        />
        <figcaption>
          In Gradara, select a {name} block and press <kbd>F1</kbd>, then choose{' '}
          <strong>Open example</strong>. It opens as a new model in My models,
          ready to run.
        </figcaption>
      </figure>
      {others.length > 0 && (
        <p className="example-others">
          <span>Also in this example:</span>
          {others.map((k) => (
            <a key={k} href={blockDocsPath(k)}>
              {library.find((d) => d.kind === k)?.name ?? k}
            </a>
          ))}
        </p>
      )}
    </section>
  );
}

// ---------------------------------------------------------------------------------
// Block page

function Ports({ title, ports }: { title: string; ports: ReferencePort[] }) {
  if (!ports.length) return null;
  return (
    <div className="port-group">
      <h3>
        {title} <span className="count">{ports.length}</span>
      </h3>
      <ul className="entries">
        {ports.map((p) => (
          <li key={p.id} className="entry">
            <div className="entry-head">
              <PortMark domain={p.domain} />
              <strong>{p.name}</strong>
              {p.name !== p.id && <code className="id">{p.id}</code>}
              <span className="entry-meta">
                {p.domain}
                {p.unit ? (
                  <>
                    {' '}
                    · <span className="mono">{p.unit}</span>
                  </>
                ) : null}
              </span>
            </div>
            {p.description && (
              <p>
                <Rich text={p.description} />
              </p>
            )}
          </li>
        ))}
      </ul>
    </div>
  );
}

function Callout({
  id,
  tone,
  title,
  items,
}: {
  id: string;
  tone: 'warn' | 'tip';
  title: string;
  items: string[];
}) {
  if (!items.length) return null;
  return (
    <section className="doc-section">
      <Anchor id={id}>{title}</Anchor>
      <div className={`callout-box ${tone}`}>
        <ul>
          {items.map((l, i) => (
            <li key={i}>
              <Rich text={l} />
            </li>
          ))}
        </ul>
      </div>
    </section>
  );
}

function BlockPage({ definition }: { definition: Definition }) {
  const ref = refs.get(definition.kind)!;
  const category = categories.find((c) => c.label === ref.category);
  const siblings = category?.blocks ?? [definition];
  const at = siblings.findIndex((d) => d.kind === definition.kind);
  const prev = at > 0 ? siblings[at - 1] : undefined;
  const next = at < siblings.length - 1 ? siblings[at + 1] : undefined;
  const domains = domainsOf(ref);
  const portCount =
    ref.inputs.length + ref.outputs.length + ref.terminals.length;
  const toc: [string, string][] = [
    ['description', 'Description'],
    ...(exampleForKind(ref.kind)
      ? [['example', 'Example'] as [string, string]]
      : []),
    ...(portCount ? [['ports', 'Ports'] as [string, string]] : []),
    ...(ref.parameters.length
      ? [['parameters', 'Parameters'] as [string, string]]
      : []),
    ...(ref.equations.length
      ? [['equations', 'Equations'] as [string, string]]
      : []),
    ...(ref.msl || ref.source
      ? [['implementation', 'Implementation'] as [string, string]]
      : []),
    ...(ref.limitations.length
      ? [['limitations', 'Limitations'] as [string, string]]
      : []),
    ...(ref.tips.length ? [['tips', 'Tips'] as [string, string]] : []),
    ...(ref.examples.length
      ? [['examples', 'Used in'] as [string, string]]
      : []),
    ...(ref.seeAlso.length
      ? [['see-also', 'See also'] as [string, string]]
      : []),
  ];
  return (
    <Page
      title={ref.title}
      description={ref.summary}
      canonical={DOCS_ORIGIN + blockDocsPath(ref.kind)}
      bodyClass="docs"
      stylesheet={
        exampleForKind(ref.kind)
          ? exampleView(
              exampleForKind(ref.kind)!.template,
              exampleForKind(ref.kind)!.title,
            ).stylesheet
          : undefined
      }
    >
      <div className="docs-shell docs-wrap">
        <main id="main" className="docs-main">
          <article className="block-doc">
            <nav className="crumbs" aria-label="Breadcrumb">
              <a href="/docs/blocks">Block reference</a>
              <span aria-hidden="true">/</span>
              <a href={`/docs/blocks#${categoryIdOf(ref.category)}`}>
                {ref.category}
              </a>
            </nav>
            <header className="block-head">
              <h1>{ref.title}</h1>
              <p className="lede">{ref.summary}</p>
              <ul className="chips" aria-label="At a glance">
                {domains.map((d) => (
                  <li key={d} className="chip">
                    <PortMark domain={d} />
                    {d}
                  </li>
                ))}
                <li className="chip">
                  {ref.msl ? 'Modelica Standard Library' : 'Gradara equations'}
                </li>
                {portCount > 0 && (
                  <li className="chip quiet">
                    {portCount} {portCount === 1 ? 'port' : 'ports'}
                  </li>
                )}
                {ref.parameters.length > 0 && (
                  <li className="chip quiet">
                    {ref.parameters.length}{' '}
                    {ref.parameters.length === 1 ? 'parameter' : 'parameters'}
                  </li>
                )}
              </ul>
            </header>
            <figure className="sheet">
              <div className="sheet-canvas">
                <Drawing definition={definition} />
              </div>
              <figcaption className="title-block">
                <span>
                  <small>Block</small>
                  {definition.name}
                </span>
                <span>
                  <small>Kind</small>
                  <code>{definition.kind}</code>
                </span>
                <span>
                  <small>Library</small>
                  {ref.category}
                </span>
              </figcaption>
            </figure>

            <section className="doc-section prose">
              <Anchor id="description">Description</Anchor>
              {ref.description.map((p, i) => (
                <p key={i}>
                  <Rich text={p} />
                </p>
              ))}
            </section>

            <ExampleSection kind={definition.kind} name={definition.name} />

            {portCount > 0 && (
              <section className="doc-section">
                <Anchor id="ports">Ports</Anchor>
                <Ports title="Inputs" ports={ref.inputs} />
                <Ports title="Outputs" ports={ref.outputs} />
                <Ports title="Conserving terminals" ports={ref.terminals} />
              </section>
            )}

            {ref.parameters.length > 0 && (
              <section className="doc-section">
                <Anchor id="parameters">Parameters</Anchor>
                <ul className="entries params">
                  {ref.parameters.map((p) => (
                    <li key={p.id} className="entry">
                      <div className="entry-head">
                        <strong>{p.name}</strong>
                        <code className="id">{p.id}</code>
                        <span className="value">
                          {String(p.value)}
                          {p.unit && <span className="unit"> {p.unit}</span>}
                        </span>
                      </div>
                      {p.range && <p className="range">{p.range}</p>}
                      {p.description && (
                        <p>
                          <Rich text={p.description} />
                        </p>
                      )}
                    </li>
                  ))}
                </ul>
              </section>
            )}

            {ref.equations.length > 0 && (
              <section className="doc-section">
                <Anchor id="equations">Equations</Anchor>
                <div className="code-card">
                  <div className="code-label">Modelica</div>
                  <pre>{ref.equations.join('\n')}</pre>
                </div>
              </section>
            )}

            {(ref.msl || ref.source) && (
              <section className="doc-section">
                <Anchor id="implementation">Implementation</Anchor>
                {ref.msl ? (
                  <div className="impl-card">
                    <div>
                      <small>Modelica Standard Library 4.1.0</small>
                      <code>{ref.msl.className}</code>
                    </div>
                    <a
                      className="button small"
                      href={ref.msl.url}
                      rel="noreferrer"
                    >
                      MSL documentation <Arrow />
                    </a>
                  </div>
                ) : (
                  <div className="code-card">
                    <div className="code-label">The block’s Modelica model</div>
                    <pre className="source">{ref.source}</pre>
                  </div>
                )}
              </section>
            )}

            <Callout
              id="limitations"
              tone="warn"
              title="Assumptions and limitations"
              items={ref.limitations}
            />
            <Callout id="tips" tone="tip" title="Tips" items={ref.tips} />

            {ref.examples.length > 0 && (
              <section className="doc-section">
                <Anchor id="examples">Used in</Anchor>
                <p className="muted">
                  These larger examples use it too. Open them from{' '}
                  <strong>Examples</strong> in the app.
                </p>
                <ul className="example-list">
                  {ref.examples.map((e) => (
                    <li key={e}>{e}</li>
                  ))}
                </ul>
              </section>
            )}

            {ref.seeAlso.length > 0 && (
              <section className="doc-section">
                <Anchor id="see-also">See also</Anchor>
                <ul className="cards related">
                  {ref.seeAlso.map((s) => {
                    const d = library.find((x) => x.kind === s.kind);
                    return (
                      <li key={s.kind}>
                        <a className="card" href={blockDocsPath(s.kind)}>
                          {d && <Thumb definition={d} />}
                          <span className="card-text">
                            <strong>{s.title}</strong>
                            <span>{refs.get(s.kind)?.summary}</span>
                          </span>
                        </a>
                      </li>
                    );
                  })}
                </ul>
              </section>
            )}

            <p className="offline-hint">
              Select a block in Gradara and press <kbd>F1</kbd> to open its page
              offline.
            </p>

            <nav className="pager" aria-label={`More in ${ref.category}`}>
              {prev ? (
                <a className="prev" href={blockDocsPath(prev.kind)}>
                  <small>Previous</small>
                  {prev.name}
                </a>
              ) : (
                <span />
              )}
              {next && (
                <a className="next" href={blockDocsPath(next.kind)}>
                  <small>Next</small>
                  {next.name}
                </a>
              )}
            </nav>
          </article>
        </main>
        <Library current={ref} />
        <nav className="docs-toc" aria-label="On this page">
          <p>On this page</p>
          <ul>
            {toc.map(([id, label]) => (
              <li key={id}>
                <a href={`#${id}`}>{label}</a>
              </li>
            ))}
          </ul>
        </nav>
      </div>
    </Page>
  );
}

// ---------------------------------------------------------------------------------
// Index

function IndexPage() {
  return (
    <Page
      title="Block reference"
      description="Reference pages for every block in the Gradara library."
      canonical={`${DOCS_ORIGIN}/docs/blocks/`}
      bodyClass="docs docs-index"
    >
      <main id="main">
        <section className="index-hero">
          <div className="grid-bg" aria-hidden="true" />
          <div className="docs-wrap">
            <p className="kicker">Block reference</p>
            <h1>Every block, on one sheet.</h1>
            <p className="lede">
              What each block in the Gradara library does, its ports and
              parameters, the equations it solves, what it leaves out, and a
              small runnable example. The same pages open offline in the app
              with <kbd>F1</kbd>.
            </p>
            <label className="search big">
              <span className="sr-only">Search blocks</span>
              <svg viewBox="0 0 16 16" aria-hidden="true" className="icon">
                <circle cx="7" cy="7" r="4.5" />
                <path d="m10.5 10.5 3 3" />
              </svg>
              <input
                type="search"
                placeholder={`Search ${library.length} blocks`}
                data-filter="index"
                autoComplete="off"
              />
            </label>
            <nav className="category-chips" aria-label="Categories">
              {categories.map((c) => (
                <a key={c.id} href={`#${c.id}`}>
                  {c.label} <span>{c.blocks.length}</span>
                </a>
              ))}
            </nav>
          </div>
        </section>
        <div className="docs-wrap index-body">
          {categories.map((c) => (
            <section
              key={c.id}
              className="index-category"
              id={c.id}
              data-group=""
            >
              <header>
                <h2>{c.label}</h2>
                <p>{c.hint}</p>
                <span className="count">{c.blocks.length}</span>
              </header>
              <ul className="cards">
                {c.blocks.map((d) => {
                  const ref = refs.get(d.kind)!;
                  return (
                    <li
                      key={d.kind}
                      data-name={`${d.name} ${d.kind} ${ref.summary} ${c.label}`.toLowerCase()}
                    >
                      <a className="card" href={blockDocsPath(d.kind)}>
                        <Thumb definition={d} />
                        <span className="card-text">
                          <strong>{d.name}</strong>
                          <span>{ref.summary}</span>
                          <span className="card-domains">
                            {domainsOf(ref).map((dom) => (
                              <PortMark key={dom} domain={dom} />
                            ))}
                          </span>
                        </span>
                      </a>
                    </li>
                  );
                })}
              </ul>
            </section>
          ))}
          <p className="index-empty" hidden>
            No blocks match. Try a part name like “resistor” or a kind like{' '}
            <code>pid</code>.
          </p>
        </div>
      </main>
    </Page>
  );
}

// ---------------------------------------------------------------------------------
// Inline styles → classes (the site's CSP allows no style attributes)

const faceRules = new Map<string, string>();
const unescapeAttr = (s: string) =>
  s
    .replace(/&quot;/g, '"')
    .replace(/&#x27;/g, "'")
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&amp;/g, '&');

function classFor(style: string, rules = faceRules, prefix = 'f') {
  const css = unescapeAttr(style);
  const name = `${prefix}-${createHash('sha1').update(css).digest('hex').slice(0, 8)}`;
  if (!rules.has(name))
    rules.set(
      name,
      `.${name}{${css
        .split(';')
        .filter((d) => d.trim())
        .map((d) => `${d.trim()}!important`)
        .join(';')}}`,
    );
  return name;
}

function withoutInlineStyles(html: string, rules = faceRules, prefix = 'f') {
  return html.replace(
    /<([a-zA-Z][\w-]*)([^>]*?) style="([^"]*)"([^>]*)>/g,
    (_, tag: string, before: string, style: string, after: string) => {
      const cls = classFor(style, rules, prefix);
      let attrs = before + after;
      attrs = / class="/.test(attrs)
        ? attrs.replace(
            / class="([^"]*)"/,
            (_m, c: string) => ` class="${c} ${cls}"`,
          )
        : `${attrs} class="${cls}"`;
      return `<${tag}${attrs}>`;
    },
  );
}

/** One block-level element per line, so page diffs stay readable. */
const lines = (html: string) =>
  html.replace(
    /(?<!^)<(?=(?:head|body|meta|link|script|title|header|footer|main|aside|nav|article|section|figure|figcaption|details|div|h[1-3]|p|ul|li)[\s>])/g,
    '\n<',
  );

const render = (node: ReactNode) =>
  `<!doctype html>\n${lines(withoutInlineStyles(renderToStaticMarkup(node)))}\n`;

// ---------------------------------------------------------------------------------
// Write

const files = new Map<string, string>();
files.set(`${OUT}/index.html`, render(<IndexPage />));
for (const definition of library)
  files.set(
    `${OUT}/${definition.kind}.html`,
    render(<BlockPage definition={definition} />),
  );

files.set(
  FACES_CSS,
  `/* Generated by scripts/build-block-docs.tsx; do not edit. */
/* The workbench's block faces (app/blocks.css) and the per-block geometry React
   writes as style attributes, which the site's CSP does not allow inline. */
:root {
  --font-ui: system-ui, -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif;
  --font-code: ui-monospace, 'SFMono-Regular', Menlo, Consolas, monospace;
  --text-micro: 10px;
  --text-ui: 12px;
  --text-meta: var(--text-ui);
  --weight-regular: 400;
  --weight-medium: 500;
  --weight-heading: 600;
}
${readFileSync('app/blocks.css', 'utf8')}
${[...faceRules.keys()]
  .sort()
  .map((k) => faceRules.get(k))
  .join('\n')}
`,
);

for (const [path, text] of exampleCss) files.set(path, text);

if (check) {
  const stale = [...files].filter(
    ([path, text]) => !existsSync(path) || readFileSync(path, 'utf8') !== text,
  );
  const extra = [OUT, EXAMPLES_CSS].flatMap((dir) =>
    existsSync(dir)
      ? readdirSync(dir).filter((f) => !files.has(`${dir}/${f}`))
      : [],
  );
  if (stale.length || extra.length) {
    console.error(
      `Block reference pages are out of date (${stale.length} changed, ${extra.length} removed). Run: npm run docs:blocks`,
    );
    process.exit(1);
  }
  console.log(`${files.size} block reference files are current.`);
} else {
  for (const dir of [OUT, EXAMPLES_CSS]) {
    rmSync(dir, { recursive: true, force: true });
    mkdirSync(dir, { recursive: true });
  }
  for (const [path, text] of files) writeFileSync(path, text);
  console.log(
    `Wrote ${library.length + 1} pages to ${OUT}, ${FACES_CSS} (${faceRules.size} face rules), and ${exampleCss.size} example stylesheets.`,
  );
}
