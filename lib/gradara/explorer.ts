import {
  findSubsystem,
  isBoundary,
  subsystemsOf,
  syncInstances,
  usageCount,
} from './hierarchy';
import type {
  Block,
  Net,
  Parameter,
  Project,
  SubsystemDefinition,
} from './model';
import { isCausal } from './model';
import { netDisplayName } from './names';

/*
 * The Model Explorer's view of a document: every sheet, block, parameter, and
 * signal net, flattened once into arrays so filtering a large model is a scan.
 * Sheets are definitions (the top level or a subsystem inside), not instances:
 * a definition used twice is listed once, with its usage count.
 */

export type SheetInfo = {
  /** '' for the top level, otherwise the subsystem definition ID. */
  id: string;
  name: string;
  /** Instance IDs from the top level that open this sheet; undefined for an inactive variant's inside. */
  path?: string[];
  /** Readable location, e.g. "EV › Drivetrain". */
  label: string;
  uses: number;
  /** Set when the sheet is only reachable as an inactive variant. */
  inactive?: boolean;
};

export type BlockRow = {
  key: string;
  sheetId: string;
  block: Block;
  /** "Drivetrain › Inverter" (sheet label) for display. */
  sheet: string;
};

export type ParameterRow = {
  key: string;
  sheetId: string;
  blockId: string;
  blockName: string;
  sheet: string;
  parameter: Parameter;
  /** The promoted subsystem parameter that sets this one, if any. */
  promotedAs?: string;
  /** Lower-case text the filter matches against. */
  text: string;
};

export type NetRow = {
  key: string;
  sheetId: string;
  sheet: string;
  net: Net;
  name: string;
  unit: string;
};

export type ExplorerIndex = {
  sheets: SheetInfo[];
  blocks: BlockRow[];
  parameters: ParameterRow[];
  nets: NetRow[];
};

type Sheet = Pick<Project, 'blocks' | 'wires' | 'junctions' | 'nets'>;

function sheetOf(doc: Project, id: string): Sheet | undefined {
  if (!id) return doc;
  const sub = findSubsystem(doc, id);
  return sub && { ...sub, junctions: sub.junctions ?? [] };
}

/** Each definition's first path from the top, found breadth-first through active insides. */
function sheetPaths(doc: Project) {
  const paths = new Map<string, { path: string[]; label: string }>([
    ['', { path: [], label: doc.name }],
  ]);
  const queue: [string, Sheet][] = [['', doc]];
  while (queue.length) {
    const [id, sheet] = queue.shift()!;
    const here = paths.get(id)!;
    for (const block of sheet.blocks) {
      const ref = block.definition.subsystem?.ref;
      if (!ref || paths.has(ref)) continue;
      const sub = findSubsystem(doc, ref);
      if (!sub) continue;
      paths.set(ref, {
        path: [...here.path, block.id],
        label: `${here.label} › ${block.definition.name}`,
      });
      queue.push([ref, { ...sub, junctions: sub.junctions ?? [] }]);
    }
  }
  return paths;
}

export function explorerIndex(doc: Project): ExplorerIndex {
  const paths = sheetPaths(doc);
  const sheets: SheetInfo[] = [
    { id: '', name: doc.name, path: [], label: doc.name, uses: 1 },
  ];
  for (const sub of subsystemsOf(doc)) {
    const found = paths.get(sub.id);
    sheets.push({
      id: sub.id,
      name: sub.name,
      path: found?.path,
      label: found?.label ?? `${sub.name} (inactive variant)`,
      uses: usageCount(doc, sub.id),
      ...(found ? {} : { inactive: true }),
    });
  }
  const blocks: BlockRow[] = [];
  const parameters: ParameterRow[] = [];
  const nets: NetRow[] = [];
  for (const info of sheets) {
    const sheet = sheetOf(doc, info.id)!;
    const promoted = new Map<string, string>();
    if (info.id)
      for (const p of findSubsystem(doc, info.id)!.parameters ?? [])
        for (const t of p.targets)
          promoted.set(`${t.blockId}\u0000${t.parameterId}`, p.name);
    for (const block of sheet.blocks) {
      if (isBoundary(block)) continue;
      const key = `${info.id}/${block.id}`;
      blocks.push({ key, sheetId: info.id, block, sheet: info.label });
      for (const parameter of block.definition.parameters)
        parameters.push({
          key: `${key}/${parameter.id}`,
          sheetId: info.id,
          blockId: block.id,
          blockName: block.definition.name,
          sheet: info.label,
          parameter,
          promotedAs: promoted.get(`${block.id}\u0000${parameter.id}`),
          text: `${info.label} ${block.definition.name} ${parameter.name} ${parameter.id} ${parameter.unit ?? ''}`.toLowerCase(),
        });
    }
    const byId = new Map(sheet.blocks.map((b) => [b.id, b]));
    const wires = new Map(sheet.wires.map((w) => [w.id, w]));
    for (const net of sheet.nets ?? []) {
      // A signal net: its anchor is a causal port.
      const [blockId, portId] = net.anchor.split('.');
      const port = byId
        .get(blockId)
        ?.definition.ports.find((p) => p.id === portId);
      const wire = wires.get(net.wireIds[0]);
      const end = wire && byId.get(wire.source);
      const causal =
        (port && isCausal(port.domain)) ||
        (!port &&
          end?.definition.ports.some(
            (p) => p.id === wire!.sourceHandle && isCausal(p.domain),
          ));
      if (!causal) continue;
      const key = `${info.id}/${net.id}`;
      nets.push({
        key,
        sheetId: info.id,
        sheet: info.label,
        net,
        name: netDisplayName({ ...doc, ...sheet } as Project, net),
        unit: port?.unit ?? '',
      });
    }
  }
  return { sheets, blocks, parameters, nets };
}

/** Rows whose text contains every word of `query` (case-insensitive). */
export function filterParameters(rows: ParameterRow[], query: string) {
  const words = query.toLowerCase().split(/\s+/).filter(Boolean);
  if (!words.length) return rows;
  return rows.filter((r) => words.every((w) => r.text.includes(w)));
}

function mapSheet(
  doc: Project,
  sheetId: string,
  change: (sheet: Sheet) => Sheet,
): Project {
  if (!sheetId) return { ...doc, ...change(doc) };
  return {
    ...doc,
    subsystems: subsystemsOf(doc).map((s) =>
      s.id === sheetId
        ? ({
            ...s,
            ...change({ ...s, junctions: s.junctions ?? [] }),
          } as SubsystemDefinition)
        : s,
    ),
  };
}

/** Set one parameter value anywhere in the document; instances follow. */
export function setParameterAt(
  doc: Project,
  sheetId: string,
  blockId: string,
  parameterId: string,
  value: number,
): Project {
  if (!Number.isFinite(value)) return doc;
  return syncInstances(
    mapSheet(doc, sheetId, (sheet) => ({
      ...sheet,
      blocks: sheet.blocks.map((b) =>
        b.id === blockId
          ? {
              ...b,
              definition: {
                ...b.definition,
                parameters: b.definition.parameters.map((p) =>
                  p.id === parameterId ? { ...p, value } : p,
                ),
              },
            }
          : b,
      ),
    })),
  );
}

/** Replace `find` with `replace` in every listed parameter whose value equals it. */
export function replaceValues(
  doc: Project,
  rows: ParameterRow[],
  find: number,
  replace: number,
) {
  let next = doc;
  let count = 0;
  for (const r of rows)
    if (r.parameter.value === find) {
      next = setParameterAt(
        next,
        r.sheetId,
        r.blockId,
        r.parameter.id,
        replace,
      );
      count++;
    }
  return { project: next, count };
}

export function setNetLogged(
  doc: Project,
  sheetId: string,
  netId: string,
  logged: boolean,
): Project {
  return mapSheet(doc, sheetId, (sheet) => ({
    ...sheet,
    nets: sheet.nets?.map((n) =>
      n.id === netId ? { ...n, logged: logged || undefined } : n,
    ),
  }));
}

export type SearchHit = {
  kind: 'block' | 'port' | 'parameter' | 'net' | 'variant' | 'subsystem';
  label: string;
  detail: string;
  sheetId: string;
  /** Block to select once the sheet is open. */
  blockId?: string;
  netId?: string;
};

/** Everything named `query` anywhere in the hierarchy, best matches first. */
export function searchModel(
  index: ExplorerIndex,
  query: string,
  limit = 50,
): SearchHit[] {
  const q = query.trim().toLowerCase();
  if (!q) return [];
  const hits: (SearchHit & { score: number })[] = [];
  const score = (text: string) => {
    const t = text.toLowerCase();
    if (t === q) return 3;
    if (t.startsWith(q)) return 2;
    return t.includes(q) ? 1 : 0;
  };
  const add = (hit: SearchHit, text: string) => {
    const s = score(text);
    if (s) hits.push({ ...hit, score: s });
  };
  for (const s of index.sheets)
    if (s.id)
      add(
        { kind: 'subsystem', label: s.name, detail: s.label, sheetId: s.id },
        s.name,
      );
  for (const b of index.blocks) {
    const d = b.block.definition;
    add(
      {
        kind: 'block',
        label: d.name,
        detail: b.sheet,
        sheetId: b.sheetId,
        blockId: b.block.id,
      },
      d.name,
    );
    for (const p of d.ports)
      add(
        {
          kind: 'port',
          label: `${d.name}.${p.name}`,
          detail: b.sheet,
          sheetId: b.sheetId,
          blockId: b.block.id,
        },
        p.name,
      );
    for (const v of d.subsystem?.variants ?? [])
      add(
        {
          kind: 'variant',
          label: `${d.name} [${v.name}]`,
          detail: b.sheet,
          sheetId: b.sheetId,
          blockId: b.block.id,
        },
        v.name,
      );
  }
  for (const p of index.parameters)
    add(
      {
        kind: 'parameter',
        label: `${p.blockName}.${p.parameter.name}`,
        detail: p.sheet,
        sheetId: p.sheetId,
        blockId: p.blockId,
      },
      `${p.parameter.name} ${p.parameter.id}`,
    );
  for (const n of index.nets)
    add(
      {
        kind: 'net',
        label: n.name,
        detail: n.sheet,
        sheetId: n.sheetId,
        netId: n.net.id,
      },
      n.name,
    );
  return hits
    .sort((a, b) => b.score - a.score || a.label.localeCompare(b.label))
    .slice(0, limit)
    .map(({ score: _s, ...hit }) => hit);
}
