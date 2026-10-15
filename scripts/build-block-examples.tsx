/**
 * Build the block examples: small runnable models that show each library block in
 * use (models/examples/blocks/<id>.json) and their manifest (index.json), which the
 * workbench and gradara.app read to find a block's example. The specs are in
 * scripts/block-examples/; every block in the library must appear in one.
 *
 * Models are assembled with the workbench's own operations: its connection rules
 * (linkEnds) and the saved document boundary (normalizeProject: the sheet grid,
 * junctions, routes, nets), so an example is exactly what a user could build. Each
 * spec places its blocks; the router draws the wires. Run `npm run examples:blocks`; `--check` fails when the files are stale,
 * `--review <dir>` also writes an HTML sheet of every diagram for inspection.
 */
import {
  existsSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { renderToStaticMarkup } from 'react-dom/server';
import { library, type Project } from '../lib/gradara/model';
import { examples } from './block-examples';
import { assemble } from './block-examples/assemble';
import { ExampleDiagram } from '../components/gradara/example-diagram';

const OUT = 'models/examples/blocks';
const check = process.argv.includes('--check');
const reviewAt = process.argv.indexOf('--review');
const reviewDir = reviewAt > 0 ? process.argv[reviewAt + 1] : undefined;

/** Palette entries that become another kind when placed. */
const PLACED_AS: Record<string, string> = { emptySubsystem: 'subsystem' };

/** Kinds used anywhere in a document, inside subsystems too. */
function kindsIn(doc: Project) {
  const kinds = new Set<string>();
  for (const sheet of [doc, ...(doc.subsystems ?? [])])
    for (const b of sheet.blocks) kinds.add(b.definition.kind);
  return kinds;
}

const files = new Map<string, string>();
const manifest = examples.map((spec) => {
  const doc = assemble(spec);
  files.set(`${spec.id}.json`, JSON.stringify(doc, null, 2) + '\n');
  const used = kindsIn(doc);
  for (const kind of spec.about)
    if (!used.has(PLACED_AS[kind] ?? kind))
      throw new Error(`${spec.id} is about ${kind} but does not use it`);
  return {
    id: spec.id,
    title: spec.title,
    area: spec.area,
    summary: spec.summary,
    about: spec.about,
    kinds: [...used].sort(),
    checks: spec.checks,
    doc,
  };
});

const ids = new Set<string>();
for (const m of manifest) {
  if (ids.has(m.id)) throw new Error(`Duplicate example ${m.id}`);
  ids.add(m.id);
}
// The curated examples in models/examples/ also show blocks at work; a block that
// only they use opens one of them.
const showcase = readdirSync('models/examples')
  .filter((f) => f.endsWith('.json'))
  .sort()
  .map((f) => {
    const doc = JSON.parse(
      readFileSync(`models/examples/${f}`, 'utf8'),
    ) as Project;
    return {
      id: f.replace(/\.json$/, ''),
      title: doc.name,
      kinds: [...kindsIn(doc)].sort(),
    };
  });
files.set(
  'index.json',
  JSON.stringify(
    {
      examples: manifest.map(({ doc: _doc, ...entry }) => entry),
      showcase,
    },
    null,
    2,
  ) + '\n',
);

if (reviewDir) {
  mkdirSync(reviewDir, { recursive: true });
  const css =
    readFileSync('site/public/assets/block-faces.css', 'utf8') +
    `body{font:14px system-ui;margin:24px;background:#eef0f4}
section{background:#f8f9fc;margin:0 0 24px;padding:16px;border:1px solid #ccd}
.diagram{position:relative;display:block}.diagram-wires{position:absolute;left:0;top:0}
.diagram-wires polyline{fill:none;stroke-width:1.5}.diagram-wires polyline.is-bus{stroke-width:3.4}
.diagram-block{position:absolute}.diagram-name{position:absolute;transform:translateX(-50%);font-size:12px;color:#273f50;white-space:nowrap}`;
  const body = manifest
    .map(
      (m) =>
        `<section><h2>${m.id} — ${m.title}</h2><p>${m.summary}</p>${renderToStaticMarkup(<ExampleDiagram project={m.doc} />)}</section>`,
    )
    .join('\n');
  writeFileSync(
    `${reviewDir}/examples.html`,
    `<!doctype html><meta charset=utf-8><style>${css}</style>${body}`,
  );
}

if (check) {
  const stale = [...files].filter(
    ([name, text]) =>
      !existsSync(`${OUT}/${name}`) ||
      readFileSync(`${OUT}/${name}`, 'utf8') !== text,
  );
  const extra = existsSync(OUT)
    ? readdirSync(OUT).filter((f) => !files.has(f))
    : [];
  if (stale.length || extra.length) {
    console.error(
      `Block examples are out of date (${stale.length} changed, ${extra.length} removed). Run: npm run examples:blocks`,
    );
    process.exit(1);
  }
  console.log(`${files.size - 1} block examples are current.`);
} else {
  rmSync(OUT, { recursive: true, force: true });
  mkdirSync(OUT, { recursive: true });
  for (const [name, text] of files) writeFileSync(`${OUT}/${name}`, text);
  console.log(`Wrote ${files.size - 1} block examples to ${OUT}.`);
}
