import { writeFileSync, readFileSync } from 'node:fs';
import { renderToStaticMarkup } from 'react-dom/server';
import { ExampleDiagram } from '../components/gradara/example-diagram';
import { normalizeProject } from '../lib/gradara/normalize-project';
const [out, ...files] = process.argv.slice(2);
const css = readFileSync('site/public/assets/block-faces.css','utf8') + readFileSync('site/public/assets/docs.css','utf8') + 'body{background:#fff;margin:16px}h2{font:600 14px system-ui}';
const body = files.map((f) => `<h2>${f}</h2>` + renderToStaticMarkup(<ExampleDiagram project={normalizeProject(JSON.parse(readFileSync(f,'utf8')))} />)).join('');
writeFileSync(out, `<!doctype html><meta charset=utf-8><style>${css}</style>${body}`);
