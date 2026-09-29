/**
 * A block's reference page, in the shape of a Simulink block reference: description,
 * ports, parameters, equations, implementation, limitations, and related blocks.
 *
 * Structural facts come from the definition (so they are always what the block does);
 * the prose comes from lib/gradara/block-docs. The workbench's Help dialog and the
 * gradara.app block pages (scripts/build-block-docs.tsx) both render this one shape.
 */
import type { BlockDoc } from './block-docs/types';
import { categoryLabel, categoryOf } from './catalog';
import { domainLabels, type Definition, type Port } from './model';

export const DOCS_ORIGIN = 'https://gradara.app';
/** Firebase serves pages without their .html (cleanUrls). */
export const blockDocsPath = (kind: string) => `/docs/blocks/${kind}`;
export const blockDocsUrl = (kind: string) => DOCS_ORIGIN + blockDocsPath(kind);

export type ReferencePort = {
  id: string;
  name: string;
  domain: string;
  unit?: string;
  description?: string;
};

export type ReferenceParameter = {
  id: string;
  name: string;
  value: number;
  unit: string;
  range?: string;
  description?: string;
};

export type BlockReference = {
  kind: string;
  title: string;
  category: string;
  /** The one-line summary shown in the library. */
  summary: string;
  description: string[];
  inputs: ReferencePort[];
  outputs: ReferencePort[];
  /** Physical terminals: conserving connections with no direction. */
  terminals: ReferencePort[];
  parameters: ReferenceParameter[];
  equations: string[];
  /** A Modelica Standard Library class this block instantiates, with its documentation. */
  msl?: { className: string; url: string };
  /** The block's own Modelica equations, when it is not an MSL class. */
  source?: string;
  limitations: string[];
  tips: string[];
  seeAlso: { kind: string; title: string }[];
  /** Shipped examples that use this block. */
  examples: string[];
  url: string;
};

/**
 * Blocks whose Modelica the engine writes by hand (`PHYSICAL` in server/modelica.py)
 * rather than from the definition's equations; their definition equations are only a
 * summary, so the page does not show them as the source.
 */
export const HAND_WRITTEN_KINDS = new Set([
  'angleSensor',
  'capacitor',
  'currentSensor',
  'dcSource',
  'diode',
  'idealSwitch',
  'inductor',
  'pmsm',
  'resistor',
  'shaftLoad',
  'springDamper',
  'torqueSensor',
  'voltageSensor',
]);

/** The MSL 4.1.0 documentation page for a class: one page per package, one anchor per class. */
export function mslDocsUrl(className: string) {
  const pkg = className.split('.').slice(0, -1).join('_');
  return `https://doc.modelica.org/Modelica%204.1.0/Resources/helpDymola/${pkg}.html#${className}`;
}

function range(min?: number, max?: number) {
  if (min === undefined && max === undefined) return undefined;
  if (max === undefined) return `≥ ${min}`;
  if (min === undefined) return `≤ ${max}`;
  return `${min} to ${max}`;
}

export function blockReference(
  definition: Definition,
  doc: BlockDoc | undefined,
  library: Definition[],
  examples: string[] = [],
): BlockReference {
  const port = (p: Port): ReferencePort => ({
    id: p.id,
    name: p.name,
    domain: domainLabels[p.domain] ?? p.domain,
    unit: p.unit || undefined,
    description: doc?.ports[p.id],
  });
  const by = (direction: Port['direction']) =>
    definition.ports.filter((p) => p.direction === direction).map(port);
  const titleOf = (kind: string) =>
    library.find((d) => d.kind === kind)?.name ?? kind;
  const source = definition.equations.trim();
  return {
    kind: definition.kind,
    title: definition.name,
    category: categoryLabel(categoryOf(definition)),
    // Some built-in blocks only repeat their name; the page's first sentence says more.
    summary:
      definition.description.trim() === definition.name && doc
        ? firstSentence(doc.description[0])
        : definition.description,
    description: doc?.description ?? [definition.description],
    inputs: by('input'),
    outputs: by('output'),
    terminals: by('physical'),
    parameters: definition.parameters.map((p) => ({
      id: p.id,
      name: p.name,
      value: p.value,
      unit: p.unit,
      range: range(p.min, p.max),
      description: doc?.parameters?.[p.id],
    })),
    equations: doc?.equations ?? [],
    msl: definition.modelica
      ? {
          className: definition.modelica.class,
          url: mslDocsUrl(definition.modelica.class),
        }
      : undefined,
    source:
      !definition.modelica &&
      !HAND_WRITTEN_KINDS.has(definition.kind) &&
      source &&
      !source.startsWith('//')
        ? [definition.declarations?.trim(), source].filter(Boolean).join('\n')
        : undefined,
    limitations: doc?.limitations ?? [],
    tips: doc?.tips ?? [],
    seeAlso: (doc?.seeAlso ?? [])
      .filter((kind) => library.some((d) => d.kind === kind))
      .map((kind) => ({ kind, title: titleOf(kind) })),
    examples,
    url: blockDocsUrl(definition.kind),
  };
}

const firstSentence = (text: string) =>
  (/^.*?[.!?](?=\s|$)/.exec(text)?.[0] ?? text).replace(/`/g, '');

/** Text with `code` spans, split for rendering: odd entries are code. */
export const codeSpans = (text: string) => text.split('`');
