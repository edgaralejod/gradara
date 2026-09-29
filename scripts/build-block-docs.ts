/**
 * Write the block reference pages of gradara.app: site/public/docs/blocks/index.html and
 * one page per library block, from the same reference model as the workbench's Help
 * dialog (lib/gradara/block-reference.ts). Run after changing a block or its docs:
 * `npx tsx scripts/build-block-docs.ts`. `--check` fails instead of writing when the
 * checked-in pages are out of date.
 */
import {
  mkdirSync,
  readFileSync,
  readdirSync,
  rmSync,
  writeFileSync,
  existsSync,
} from 'node:fs';
import { library, type Definition } from '../lib/gradara/model';
import { blockDocs } from '../lib/gradara/block-docs';
import {
  DOCS_ORIGIN,
  blockDocsPath,
  blockReference,
  type BlockReference,
  type ReferencePort,
} from '../lib/gradara/block-reference';
import { categoryOf, libraryCategories } from '../lib/gradara/catalog';

const OUT = 'site/public/docs/blocks';
const check = process.argv.includes('--check');

const esc = (s: string) =>
  s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
/** Plain text with `code` spans. */
const rich = (s: string) =>
  s
    .split('`')
    .map((part, i) => (i % 2 ? `<code>${esc(part)}</code>` : esc(part)))
    .join('');

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

function page(
  title: string,
  description: string,
  canonical: string,
  body: string,
) {
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${esc(title)} · Gradara</title>
<meta name="description" content="${esc(description)}">
<meta name="theme-color" content="#0a0e13">
<link rel="canonical" href="${canonical}">
<link rel="icon" href="../../assets/icon.svg" type="image/svg+xml">
<link rel="stylesheet" href="../../assets/site.css">
<script src="../../assets/site.js" defer></script>
</head>
<body>
<a class="skip" href="#main">Skip to content</a>
<header class="site-header">
  <nav class="nav wrap" aria-label="Main">
    <a class="brand" href="../../"><img src="../../assets/icon.svg" alt="" width="28" height="28">Gradara</a>
    <button class="nav-toggle" type="button" aria-controls="site-navigation" aria-expanded="false">Menu</button>
    <div class="nav-links" id="site-navigation">
      <a href="../../#features">Features</a>
      <a href="../../#pricing">Pricing</a>
      <a href="index.html">Blocks</a>
      <a href="https://github.com/edgaralejod/gradara/tree/main/docs">Docs</a>
      <a class="button small primary" href="../../#download">Download</a>
    </div>
  </nav>
</header>
<main id="main" class="wrap doc block-ref">
${body}
</main>
<footer class="site-footer">
  <div class="wrap footer-inner">
    <p>© 2026 Virtu Services LLC</p>
    <div class="footer-links">
      <a href="../../privacy.html">Privacy</a>
      <a href="../../terms.html">Terms</a>
      <a href="https://github.com/edgaralejod/gradara">GitHub</a>
      <a href="mailto:support@virtu-services.us">Support</a>
    </div>
  </div>
</footer>
</body>
</html>
`;
}

const domainClass = (domain: string) =>
  `domain-${domain.toLowerCase().replace(/[^a-z]+/g, '-')}`;

function portTable(title: string, ports: ReferencePort[]) {
  if (!ports.length) return '';
  const rows = ports
    .map(
      (p) =>
        `<tr><td><strong>${esc(p.name)}</strong>${p.name !== p.id ? ` <code>${esc(p.id)}</code>` : ''}</td><td><span class="port-domain ${domainClass(p.domain)}">${esc(p.domain)}</span>${p.unit ? ` · ${esc(p.unit)}` : ''}</td><td>${rich(p.description ?? '')}</td></tr>`,
    )
    .join('\n');
  return `<h3>${esc(title)}</h3>
<table><thead><tr><th>Port</th><th>Domain</th><th>Description</th></tr></thead>
<tbody>
${rows}
</tbody></table>`;
}

function list(title: string, items: string[]) {
  if (!items.length) return '';
  return `<h2>${esc(title)}</h2>\n<ul>${items.map((i) => `<li>${rich(i)}</li>`).join('')}</ul>`;
}

function blockPage(ref: BlockReference) {
  const params = ref.parameters.length
    ? `<h2>Parameters</h2>
<table><thead><tr><th>Parameter</th><th>Default</th><th>Description</th></tr></thead>
<tbody>
${ref.parameters
  .map(
    (p) =>
      `<tr><td><strong>${esc(p.name)}</strong> <code>${esc(p.id)}</code></td><td class="nowrap">${esc(String(p.value))}${p.unit ? ` ${esc(p.unit)}` : ''}${p.range ? `<br><span class="range">${esc(p.range)}</span>` : ''}</td><td>${rich(p.description ?? '')}</td></tr>`,
  )
  .join('\n')}
</tbody></table>`
    : '';
  const implementation = ref.msl
    ? `<h2>Implementation</h2>
<p>Instantiates <code>${esc(ref.msl.className)}</code> from the Modelica Standard Library 4.1.0. <a href="${esc(ref.msl.url)}" rel="noreferrer">MSL documentation</a></p>`
    : ref.source
      ? `<h2>Implementation</h2>\n<p>The block’s Modelica equations:</p>\n<pre class="block-source">${esc(ref.source)}</pre>`
      : '';
  const body = `<p class="meta"><a href="index.html">Block reference</a> › ${esc(ref.category)}</p>
<h1>${esc(ref.title)}</h1>
<p class="lede">${esc(ref.summary)}</p>
<h2>Description</h2>
${ref.description.map((p) => `<p>${rich(p)}</p>`).join('\n')}
${
  ref.inputs.length + ref.outputs.length + ref.terminals.length
    ? `<h2>Ports</h2>
${portTable('Inputs', ref.inputs)}
${portTable('Outputs', ref.outputs)}
${portTable('Conserving terminals', ref.terminals)}`
    : ''
}
${params}
${ref.equations.length ? `<h2>Equations</h2>\n<pre class="equations">${esc(ref.equations.join('\n'))}</pre>` : ''}
${implementation}
${list('Assumptions and limitations', ref.limitations)}
${list('Tips', ref.tips)}
${ref.examples.length ? `<h2>Examples</h2>\n<p>Used in the shipped examples ${ref.examples.map((e) => `<strong>${esc(e)}</strong>`).join(', ')}. Open them from <strong>Examples</strong> in the app.</p>` : ''}
${ref.seeAlso.length ? `<h2>See also</h2>\n<p class="see-also">${ref.seeAlso.map((s) => `<a href="${esc(s.kind)}.html">${esc(s.title)}</a>`).join(' ')}</p>` : ''}
<p class="meta">Press F1 on a selected block in Gradara to open this page offline.</p>`;
  return page(
    ref.title,
    ref.summary,
    DOCS_ORIGIN + blockDocsPath(ref.kind),
    body,
  );
}

function indexPage(defs: Definition[]) {
  const sections = libraryCategories
    .map((c) => {
      const blocks = defs.filter((d) => categoryOf(d) === c.id);
      if (!blocks.length) return '';
      return `<section class="block-category" id="${esc(c.id)}">
<h2>${esc(c.label)} <span>${blocks.length}</span></h2>
<ul class="block-index">
${blocks.map((d) => `<li><a href="${esc(d.kind)}.html"><strong>${esc(d.name)}</strong><span>${esc(blockReference(d, blockDocs[d.kind], library).summary)}</span></a></li>`).join('\n')}
</ul>
</section>`;
    })
    .join('\n');
  const body = `<h1>Block reference</h1>
<p class="lede">Every block in the Gradara library: what it does, its ports and parameters, the equations it solves, and what it leaves out. ${defs.length} blocks.</p>
<nav class="category-links" aria-label="Categories">${libraryCategories
    .filter((c) => defs.some((d) => categoryOf(d) === c.id))
    .map((c) => `<a href="#${esc(c.id)}">${esc(c.label)}</a>`)
    .join(' ')}</nav>
${sections}`;
  return page(
    'Block reference',
    'Reference pages for every block in the Gradara library.',
    `${DOCS_ORIGIN}/docs/blocks/`,
    body,
  );
}

const use = exampleUse();
const files = new Map<string, string>();
files.set('index.html', indexPage(library));
for (const definition of library)
  files.set(
    `${definition.kind}.html`,
    blockPage(
      blockReference(
        definition,
        blockDocs[definition.kind],
        library,
        use.get(definition.kind) ?? [],
      ),
    ),
  );

if (check) {
  const stale = [...files].filter(
    ([name, html]) =>
      !existsSync(`${OUT}/${name}`) ||
      readFileSync(`${OUT}/${name}`, 'utf8') !== html,
  );
  const extra = existsSync(OUT)
    ? readdirSync(OUT).filter((f) => !files.has(f))
    : [];
  if (stale.length || extra.length) {
    console.error(
      `Block reference pages are out of date (${stale.length} changed, ${extra.length} removed). Run: npx tsx scripts/build-block-docs.ts`,
    );
    process.exit(1);
  }
  console.log(`${files.size} block reference pages are current.`);
} else {
  rmSync(OUT, { recursive: true, force: true });
  mkdirSync(OUT, { recursive: true });
  for (const [name, html] of files) writeFileSync(`${OUT}/${name}`, html);
  console.log(`Wrote ${files.size} pages to ${OUT}.`);
}
