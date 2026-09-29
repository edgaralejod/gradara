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
import { defaultBlockSize } from '../lib/gradara/block-design';
import { library, type Block, type Project } from '../lib/gradara/model';
import { normalizeProject } from '../lib/gradara/normalize-project';
import { linkEnds } from '../lib/gradara/project';
import { examples, type ExampleSpec } from './block-examples';
import { ExampleDiagram } from './example-diagram';

const OUT = 'models/examples/blocks';
const check = process.argv.includes('--check');
const reviewAt = process.argv.indexOf('--review');
const reviewDir = reviewAt > 0 ? process.argv[reviewAt + 1] : undefined;

// Deterministic ids, so rebuilding an unchanged spec rewrites identical files.
let counter = 0;
Object.defineProperty(globalThis.crypto, 'randomUUID', {
  value: () => `id${(++counter).toString(36).padStart(4, '0')}`,
  configurable: true,
});

/** Where a name beside or above a block goes (the canvas draws it under the body). */
function labelOffset(
  name: string,
  size: { width: number; height: number },
  side: 'left' | 'right' | 'above' | [number, number],
) {
  if (Array.isArray(side)) return { x: side[0], y: side[1] };
  const width = Math.min(240, Math.max(24, name.length * 8));
  if (side === 'above') return { x: 0, y: -size.height - 32 };
  const x = size.width / 2 + width / 2 + 8;
  return { x: side === 'right' ? x : -x, y: -size.height / 2 - 14 };
}

/** Modelica keywords and built-ins an instance id must not shadow. */
const RESERVED = new Set(
  'algorithm and annotation block break class connect connector constant constrainedby der discrete each else elseif elsewhen encapsulated end enumeration equation expandable extends external false final flow for function if import impure in initial inner input loop model not operator or outer output package parameter partial protected public pure record redeclare replaceable return stream then time true type when while within'.split(
    ' ',
  ),
);

function instance(
  spec: ExampleSpec,
  [
    id,
    kind,
    name,
    [cx, cy],
    params = {},
    options,
  ]: ExampleSpec['blocks'][number],
): Block {
  if (RESERVED.has(id))
    throw new Error(`${spec.id}: ${id} is a Modelica keyword`);
  const found = library.find((d) => d.kind === kind);
  if (!found) throw new Error(`${spec.id}: unknown block kind ${kind}`);
  const definition = structuredClone(found);
  definition.name = name;
  for (const [key, value] of Object.entries(params)) {
    const parameter = definition.parameters.find((p) => p.id === key);
    if (!parameter)
      throw new Error(`${spec.id}: ${kind} has no parameter ${key}`);
    parameter.value = value;
  }
  const { rotation, label, ports } =
    typeof options === 'number'
      ? { rotation: options, label: undefined, ports: undefined }
      : (options ?? {});
  for (const [portId, place] of Object.entries(ports ?? {})) {
    const port = definition.ports.find((p) => p.id === portId);
    if (!port) throw new Error(`${spec.id}: ${kind} has no port ${portId}`);
    const [side, offset] = Array.isArray(place) ? place : [place, undefined];
    port.side = side;
    if (offset === undefined) delete port.offset;
    else port.offset = offset;
  }
  const standard = defaultBlockSize(definition);
  const size =
    rotation === 90 || rotation === 270
      ? { width: standard.height, height: standard.width }
      : standard;
  return {
    id,
    definition,
    position: { x: cx - size.width / 2, y: cy - size.height / 2 },
    size,
    ...(rotation ? { rotation } : {}),
    ...(label ? { labelOffset: labelOffset(name, size, label) } : {}),
  };
}

function build(spec: ExampleSpec): Project {
  counter = 0;
  let doc: Project = {
    version: 1,
    name: `Example: ${spec.title}`,
    exampleId: `block-${spec.id}`,
    description: spec.description,
    duration: spec.duration,
    revision: 0,
    blocks: spec.blocks.map((b) => instance(spec, b)),
    wires: [],
    junctions: [],
    nets: [],
    annotations: [],
    plots: [],
  };
  for (const [from, to] of spec.links) {
    const [a, ah] = from.split('.'),
      [b, bh] = to.split('.');
    for (const [id, handle] of [
      [a, ah],
      [b, bh],
    ])
      if (
        !doc.blocks
          .find((x) => x.id === id)
          ?.definition.ports.some((p) => p.id === handle)
      )
        throw new Error(`${spec.id}: no port ${id}.${handle}`);
    try {
      doc = linkEnds(doc, { id: a, handle: ah }, { id: b, handle: bh });
    } catch (e) {
      throw new Error(`${spec.id}: ${from} → ${to}: ${(e as Error).message}`);
    }
  }
  doc = normalizeProject(normalizeProject(doc));
  if (spec.finish) doc = spec.finish(doc);
  delete doc.modelId;
  doc.plots = spec.plots.map((plot, i) => ({
    id: `plot${i + 1}`,
    label: plot.label,
    series: plot.series,
    ...(plot.labels ? { labels: plot.labels } : {}),
  }));
  for (const plot of doc.plots)
    for (const key of plot.series) {
      const [id, port] = key.split('.');
      if (
        !doc.blocks
          .find((b) => b.id === id)
          ?.definition.ports.some(
            (p) => p.id === port && p.direction === 'output',
          )
      )
        throw new Error(`${spec.id}: plot series ${key} is not an output`);
    }
  return doc;
}

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
  const doc = build(spec);
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
.diagram-wires polyline{fill:none;stroke-width:1.5}
.diagram-block{position:absolute}.diagram-turn{position:absolute;left:50%;top:50%}.diagram-name{position:absolute;transform:translateX(-50%);font-size:12px;color:#273f50;white-space:nowrap}`;
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
