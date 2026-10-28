/**
 * Print: the whole design as pages, one per sheet. The top level comes first,
 * then every subsystem in the order the Model Explorer lists them (depth first,
 * by name). A subsystem used by several instances prints once, with every
 * instance path listed under its title. Subsystems with variants print their
 * active variant, as the canvas shows them.
 *
 * The sheets are drawn by components/gradara/print-document.tsx with the
 * canvas's own block and wire components; this file holds the pure parts:
 * which pages, their titles, the fit of each sheet into its page, and the
 * parameter tables.
 */
import {
  breadcrumb,
  findSubsystem,
  hierarchyTree,
  isBoundary,
  scopeView,
  subsystemAt,
  type HierarchyNode,
} from './hierarchy';
import type { Domain, Project } from './model';
import { sheetBounds, type Bounds } from './sheet-bounds';
import { isTagKind } from './tag-blocks';

export type PaperSize = 'letter' | 'a4';

export type PrintOptions = {
  paper: PaperSize;
  /** A table of each sheet's block parameters after its diagram. */
  parameters: boolean;
};

export const DEFAULT_PRINT_OPTIONS: PrintOptions = { paper: 'letter', parameters: true };

/** CSS pixels per millimetre (96 per inch). */
const MM = 96 / 25.4;
/** Page margin on every side, in millimetres. */
export const PAGE_MARGIN_MM = 10;

/** The paper, landscape, in millimetres. */
export const PAPER: Record<PaperSize, { width: number; height: number; css: string; label: string }> = {
  letter: { width: 279.4, height: 215.9, css: 'letter landscape', label: 'Letter' },
  a4: { width: 297, height: 210, css: 'A4 landscape', label: 'A4' },
};

/** Heights of the page header and footer, in CSS pixels. */
export const HEADER_PX = 34;
export const FOOTER_PX = 30;

/** The printable area of a page and the diagram's box inside it, in CSS pixels. */
export function pageBox(paper: PaperSize) {
  const p = PAPER[paper];
  // A hair under the paper so rounding never spills a page onto the next.
  const width = Math.floor((p.width - 2 * PAGE_MARGIN_MM) * MM) - 2;
  const height = Math.floor((p.height - 2 * PAGE_MARGIN_MM) * MM) - 2;
  return { width, height, diagram: { width, height: height - HEADER_PX - FOOTER_PX } };
}

export type PrintPage = {
  /** The subsystem definition (or `top`), unique per page. */
  key: string;
  /** The instance path of the first place it is used (empty at the top). */
  path: string[];
  title: string;
  /** Where it sits, "Drive › Inverter"; empty at the top. */
  where: string;
  /** Other instances of the same subsystem, as "Drive 2 › Inverter". */
  also: string[];
  variant?: string;
  sheet: Project;
};

const where = (doc: Project, path: string[]) =>
  breadcrumb(doc, path)
    .slice(1)
    .map((c) => c.name)
    .join(' › ');

/** Every sheet of the design, in Model Explorer order, each subsystem once. */
export function printPages(doc: Project): PrintPage[] {
  const pages: PrintPage[] = [
    { key: 'top', path: [], title: doc.name, where: '', also: [], sheet: scopeView(doc, []) },
  ];
  const byRef = new Map<string, PrintPage>();
  const visit = (node: HierarchyNode) => {
    const ref = subsystemAt(doc, node.path);
    if (ref) {
      const seen = byRef.get(ref);
      if (seen) seen.also.push(where(doc, node.path));
      else {
        const page: PrintPage = {
          key: ref,
          path: node.path,
          title: node.name,
          where: where(doc, node.path),
          also: [],
          ...(node.variant ? { variant: node.variant } : {}),
          sheet: scopeView(doc, node.path),
        };
        byRef.set(ref, page);
        pages.push(page);
      }
    }
    node.children.forEach(visit);
  };
  hierarchyTree(doc).children.forEach(visit);
  return pages;
}

export type Fit = { x: number; y: number; zoom: number };

/** Place a sheet's drawing in a box: centred, scaled down to fit, never enlarged past 1:1. */
export function fitSheet(bounds: Bounds | undefined, box: { width: number; height: number }, pad = 12): Fit {
  if (!bounds || bounds.width <= 0 || bounds.height <= 0) return { x: pad, y: pad, zoom: 1 };
  const zoom = Math.min(
    1,
    (box.width - 2 * pad) / bounds.width,
    (box.height - 2 * pad) / bounds.height,
  );
  return {
    x: (box.width - bounds.width * zoom) / 2 - bounds.x * zoom,
    y: (box.height - bounds.height * zoom) / 2 - bounds.y * zoom,
    zoom,
  };
}

export function sheetFit(page: PrintPage, paper: PaperSize): Fit {
  return fitSheet(sheetBounds(page.sheet), pageBox(paper).diagram);
}

export type ParameterRow = { block: string; parameter: string; value: string; unit: string };

/** A value as people write it: 0.001, 1e-6, 2.5e+3 only when plain digits get long. */
export function formatValue(value: number): string {
  if (!Number.isFinite(value)) return String(value);
  if (value === 0) return '0';
  const abs = Math.abs(value);
  const text = abs >= 1e-3 && abs < 1e6 ? String(Number(value.toPrecision(6))) : value.toExponential();
  return text.replace(/(\.\d*?)0+e/, '$1e').replace(/\.e/, 'e');
}

/** The parameters of a sheet's blocks, in the order the blocks are drawn top to bottom, left to right. */
export function parameterRows(sheet: Project): ParameterRow[] {
  return sheet.blocks
    .filter((b) => !isBoundary(b) && !isTagKind(b.definition.kind) && b.definition.parameters.length)
    .slice()
    .sort((a, b) => a.position.y - b.position.y || a.position.x - b.position.x)
    .flatMap((b) =>
      b.definition.parameters.map((p) => ({
        block: b.definition.name,
        parameter: p.name,
        value: formatValue(p.value),
        unit: p.unit ?? '',
      })),
    );
}

/** The domains drawn on a sheet, for its legend. */
export function sheetDomains(sheet: Project): Domain[] {
  const found = new Set<Domain>();
  for (const b of sheet.blocks) for (const p of b.definition.ports) found.add(p.domain);
  const order: Domain[] = ['signal', 'boolean', 'electrical', 'mechanical', 'translational', 'thermal', 'magnetic', 'threePhase', 'physicalBus'];
  return order.filter((d) => found.has(d));
}

export const DOMAIN_NAMES: Record<Domain, string> = {
  signal: 'Signal',
  boolean: 'Boolean',
  electrical: 'Electrical',
  mechanical: 'Rotational',
  translational: 'Translational',
  thermal: 'Thermal',
  magnetic: 'Magnetic',
  threePhase: 'Three-phase',
  physicalBus: 'Physical bus',
};

/** Subsystem definitions no page shows: the insides of inactive variants, and definitions nothing uses. */
export function unprinted(doc: Project, pages: PrintPage[]): string[] {
  const printed = new Set(pages.map((p) => p.key));
  return (doc.subsystems ?? []).filter((s) => !printed.has(s.id) && !!findSubsystem(doc, s.id)).map((s) => s.id);
}
