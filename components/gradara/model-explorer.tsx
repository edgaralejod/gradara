'use client';
import {
  useDeferredValue,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from 'react';
import {
  ArrowUpToLine,
  Box,
  ChevronDown,
  ChevronRight,
  Crosshair,
  Layers,
  LineChart,
  Play,
  Plus,
  Search,
  SlidersHorizontal,
  Workflow,
} from 'lucide-react';
import type { Diagnostic, SimulationResult } from '@/lib/gradara/api';
import type { Block, Project } from '@/lib/gradara/model';
import {
  explorerIndex,
  filterParameters,
  replaceValues,
  searchModel,
  setNetLogged,
  setParameterAt,
  type ExplorerIndex,
  type ParameterRow,
  type SearchHit,
} from '@/lib/gradara/explorer';
import {
  findSubsystem,
  isInstance,
  makeUnique,
  promoteParameter,
  refsOf,
  syncInstances,
} from '@/lib/gradara/hierarchy';
import {
  applyConfiguration,
  matchingConfiguration,
  renameConfiguration,
  saveConfiguration,
  setConfigurationChoice,
  variantInstances,
} from '@/lib/gradara/variants';
import NumberField from './number-field';
import type { useVariantChecks } from './use-variant-checks';

type VariantChecks = ReturnType<typeof useVariantChecks>;

export type ExplorerTarget = {
  sheetId: string;
  blockId?: string;
  netId?: string;
};
type View = 'parameters' | 'variants' | 'signals';
type Node = { sheetId: string; blockId?: string };

const ROW = 30;

/**
 * The Explorer workspace: a model tree, one table (parameters, variants, or
 * signals), and details for the selected tree node. Every edit goes through
 * `onCommit` as one undo step on the whole document.
 */
export default function ModelExplorer({
  doc,
  result,
  problems,
  focusedBlock,
  searchSignal,
  onCommit,
  onReveal,
  onRunAll,
  variantChecks,
  onOpenResults,
}: {
  doc: Project;
  variantChecks: VariantChecks;
  result: SimulationResult | null;
  problems: Diagnostic[];
  /** The block selected in the Diagram, so both tabs agree. */
  focusedBlock?: Node;
  /** Changes when ⌘K is pressed, to focus the search field. */
  searchSignal: number;
  onCommit: (change: (doc: Project) => Project) => void;
  onReveal: (target: ExplorerTarget) => void;
  onRunAll: () => void;
  onOpenResults: () => void;
}) {
  const index = useMemo(() => explorerIndex(doc), [doc]);
  const [view, setView] = useState<View>('parameters');
  const [node, setNode] = useState<Node>(focusedBlock ?? { sheetId: '' });
  const [query, setQuery] = useState('');
  const searchRef = useRef<HTMLInputElement>(null);
  useEffect(() => {
    if (searchSignal) searchRef.current?.focus();
  }, [searchSignal]);
  const hits = useMemo(() => searchModel(index, query, 30), [index, query]);
  const reveal = (hit: SearchHit) => {
    setQuery('');
    onReveal({ sheetId: hit.sheetId, blockId: hit.blockId, netId: hit.netId });
  };
  return (
    <div className="model-explorer">
      <div className="explorer-bar">
        <div className="explorer-search">
          <Search size={14} />
          <input
            ref={searchRef}
            value={query}
            placeholder="Search blocks, ports, parameters, nets, variants  ⌘K"
            aria-label="Search the model"
            onChange={(e) => setQuery(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter' && hits[0]) reveal(hits[0]);
              if (e.key === 'Escape') setQuery('');
              e.stopPropagation();
            }}
          />
          {query && (
            <ul className="explorer-hits">
              {hits.length ? (
                hits.map((hit, i) => (
                  <li key={`${hit.kind}-${hit.sheetId}-${hit.label}-${i}`}>
                    <button onClick={() => reveal(hit)}>
                      <span className={`hit-kind kind-${hit.kind}`}>
                        {hit.kind}
                      </span>
                      <strong>{hit.label}</strong>
                      <span>{hit.detail}</span>
                    </button>
                  </li>
                ))
              ) : (
                <li className="explorer-empty">No matches</li>
              )}
            </ul>
          )}
        </div>
        <div className="explorer-views" role="tablist">
          {(
            [
              ['parameters', 'Parameters', SlidersHorizontal],
              ['variants', 'Variants', Layers],
              ['signals', 'Signals', LineChart],
            ] as const
          ).map(([id, label, Icon]) => (
            <button
              key={id}
              role="tab"
              aria-selected={view === id}
              onClick={() => setView(id)}
            >
              <Icon size={13} />
              {label}
            </button>
          ))}
        </div>
      </div>
      <div className="explorer-body">
        <ModelTree
          doc={doc}
          index={index}
          node={node}
          focused={focusedBlock}
          problems={problems}
          onSelect={setNode}
          onReveal={onReveal}
        />
        <section className="explorer-table">
          {view === 'parameters' && (
            <ParametersView
              doc={doc}
              index={index}
              node={node}
              onCommit={onCommit}
              onReveal={onReveal}
            />
          )}
          {view === 'variants' && (
            <VariantsView
              doc={doc}
              index={index}
              checks={variantChecks}
              onCommit={onCommit}
              onRunAll={onRunAll}
            />
          )}
          {view === 'signals' && (
            <SignalsView
              index={index}
              result={result}
              onCommit={onCommit}
              onReveal={onReveal}
              onOpenResults={onOpenResults}
            />
          )}
        </section>
        <Details
          doc={doc}
          index={index}
          node={node}
          problems={problems}
          onCommit={onCommit}
          onReveal={onReveal}
        />
      </div>
    </div>
  );
}

// ---------------------------------------------------------------- tree

function ModelTree({
  doc,
  index,
  node,
  focused,
  problems,
  onSelect,
  onReveal,
}: {
  doc: Project;
  index: ExplorerIndex;
  node: Node;
  focused?: Node;
  problems: Diagnostic[];
  onSelect: (node: Node) => void;
  onReveal: (target: ExplorerTarget) => void;
}) {
  const [open, setOpen] = useState<Set<string>>(() => new Set(['']));
  const flagged = useMemo(
    () =>
      new Set(
        problems
          .filter((p) => p.severity !== 'info')
          .flatMap((p) => p.blockIds),
      ),
    [problems],
  );
  const toggle = (key: string) =>
    setOpen((o) => {
      const next = new Set(o);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  const rows: ReactNode[] = [];
  const sheetName = (id: string) =>
    index.sheets.find((s) => s.id === id)?.name ?? '';
  const walk = (sheetId: string, depth: number, trail: Set<string>) => {
    const blocks = index.blocks.filter((b) => b.sheetId === sheetId);
    for (const row of blocks) {
      const b = row.block;
      const key = row.key;
      const inner = isInstance(b) ? b.definition.subsystem!.ref : undefined;
      const variants = b.definition.subsystem?.variants;
      const expandable = !!inner && !trail.has(inner);
      const expanded = open.has(key);
      const selected = node.sheetId === sheetId && node.blockId === b.id;
      const inDiagram =
        focused?.sheetId === sheetId && focused.blockId === b.id;
      const uses = inner
        ? (index.sheets.find((s) => s.id === inner)?.uses ?? 0)
        : 0;
      rows.push(
        <div
          key={key}
          className={`tree-row ${selected ? 'is-selected' : ''} ${inDiagram ? 'is-focused' : ''}`}
          style={{ paddingLeft: 8 + depth * 14 }}
        >
          {expandable ? (
            <button
              className="tree-toggle"
              aria-label={expanded ? 'Collapse' : 'Expand'}
              onClick={() => toggle(key)}
            >
              {expanded ? (
                <ChevronDown size={12} />
              ) : (
                <ChevronRight size={12} />
              )}
            </button>
          ) : (
            <span className="tree-toggle" />
          )}
          <button
            className="tree-label"
            onClick={() => onSelect({ sheetId, blockId: b.id })}
            onDoubleClick={() => onReveal({ sheetId, blockId: b.id })}
            title="Double-click to show on the canvas"
          >
            {inner ? <Workflow size={12} /> : <Box size={12} />}
            <span>{b.definition.name}</span>
            {variants && (
              <span className="tree-badge">
                {
                  variants.find((v) => v.id === b.definition.subsystem!.active)
                    ?.name
                }
              </span>
            )}
            {!!uses && uses > 1 && (
              <span className="tree-badge">Used {uses}×</span>
            )}
            {flagged.has(b.id) && (
              <span className="tree-problem" title="Has problems" />
            )}
          </button>
        </div>,
      );
      if (expandable && expanded) {
        const next = new Set(trail).add(inner!);
        if (variants)
          for (const v of variants) {
            const vkey = `${key}#${v.id}`;
            const active = v.id === b.definition.subsystem!.active;
            const vopen = open.has(vkey);
            rows.push(
              <div
                key={vkey}
                className="tree-row tree-variant"
                style={{ paddingLeft: 8 + (depth + 1) * 14 }}
              >
                <button
                  className="tree-toggle"
                  aria-label={vopen ? 'Collapse' : 'Expand'}
                  onClick={() => toggle(vkey)}
                >
                  {vopen ? (
                    <ChevronDown size={12} />
                  ) : (
                    <ChevronRight size={12} />
                  )}
                </button>
                <button
                  className="tree-label"
                  onClick={() => onSelect({ sheetId: v.ref })}
                >
                  <Layers size={12} />
                  <span>
                    {v.name} {active ? '· active' : ''}
                  </span>
                  <span className="tree-muted">{sheetName(v.ref)}</span>
                </button>
              </div>,
            );
            if (vopen && !trail.has(v.ref))
              walk(v.ref, depth + 2, new Set(next).add(v.ref));
          }
        else walk(inner!, depth + 1, next);
      }
    }
  };
  walk('', 1, new Set());
  return (
    <nav className="explorer-tree" aria-label="Model tree">
      <div
        className={`tree-row tree-root ${!node.sheetId && !node.blockId ? 'is-selected' : ''}`}
      >
        <button
          className="tree-label"
          onClick={() => onSelect({ sheetId: '' })}
        >
          <Workflow size={12} />
          <strong>{doc.name}</strong>
          <span className="tree-muted">{index.blocks.length} blocks</span>
        </button>
      </div>
      {rows}
    </nav>
  );
}

/** Sheets under a tree node: a block's own inside and everything nested in it, or a sheet and its children. */
function sheetsUnder(doc: Project, start: string[]): Set<string> {
  const out = new Set<string>();
  const stack = [...start];
  while (stack.length) {
    const id = stack.pop()!;
    if (out.has(id)) continue;
    out.add(id);
    const sheet = id ? findSubsystem(doc, id) : doc;
    for (const b of sheet?.blocks ?? []) stack.push(...refsOf(b.definition));
  }
  return out;
}

function rowsFor(
  doc: Project,
  index: ExplorerIndex,
  node: Node,
): ParameterRow[] {
  if (!node.blockId) {
    if (!node.sheetId) return index.parameters;
    const sheets = sheetsUnder(doc, [node.sheetId]);
    return index.parameters.filter((p) => sheets.has(p.sheetId));
  }
  const block = index.blocks.find(
    (b) => b.sheetId === node.sheetId && b.block.id === node.blockId,
  )?.block;
  const own = index.parameters.filter(
    (p) => p.sheetId === node.sheetId && p.blockId === node.blockId,
  );
  if (!block || !isInstance(block)) return own;
  const sheets = sheetsUnder(doc, refsOf(block.definition));
  return [...own, ...index.parameters.filter((p) => sheets.has(p.sheetId))];
}

// ---------------------------------------------------------------- parameters

function ParametersView({
  doc,
  index,
  node,
  onCommit,
  onReveal,
}: {
  doc: Project;
  index: ExplorerIndex;
  node: Node;
  onCommit: (change: (doc: Project) => Project) => void;
  onReveal: (target: ExplorerTarget) => void;
}) {
  const [filter, setFilter] = useState('');
  const deferred = useDeferredValue(filter);
  const [find, setFind] = useState('');
  const [replace, setReplace] = useState('');
  const [note, setNote] = useState('');
  const scoped = useMemo(() => rowsFor(doc, index, node), [doc, index, node]);
  const rows = useMemo(
    () => filterParameters(scoped, deferred),
    [scoped, deferred],
  );
  const findValue = find.trim() === '' ? NaN : Number(find);
  const replaceValue = replace.trim() === '' ? NaN : Number(replace);
  const matches = Number.isFinite(findValue)
    ? rows.filter((r) => r.parameter.value === findValue).length
    : 0;
  return (
    <>
      <div className="table-tools">
        <input
          className="table-filter"
          value={filter}
          placeholder="Filter by block, parameter, or unit"
          aria-label="Filter parameters"
          onChange={(e) => setFilter(e.target.value)}
          onKeyDown={(e) => e.stopPropagation()}
        />
        <span className="table-count">
          {rows.length} of {scoped.length}
        </span>
        <form
          className="find-replace"
          onSubmit={(e) => {
            e.preventDefault();
            if (!matches || !Number.isFinite(replaceValue)) return;
            let count = 0;
            onCommit((d) => {
              const r = replaceValues(d, rows, findValue, replaceValue);
              count = r.count;
              return r.project;
            });
            setNote(
              `Replaced ${count || matches} value${(count || matches) === 1 ? '' : 's'}.`,
            );
          }}
        >
          <input
            value={find}
            placeholder="Find value"
            aria-label="Find value"
            inputMode="decimal"
            onChange={(e) => {
              setFind(e.target.value);
              setNote('');
            }}
            onKeyDown={(e) => e.stopPropagation()}
          />
          <input
            value={replace}
            placeholder="Replace with"
            aria-label="Replace with"
            inputMode="decimal"
            onChange={(e) => setReplace(e.target.value)}
            onKeyDown={(e) => e.stopPropagation()}
          />
          <button
            type="submit"
            disabled={!matches || !Number.isFinite(replaceValue)}
          >
            Replace {matches || ''}
          </button>
        </form>
        {note && <span className="table-note">{note}</span>}
      </div>
      <div className="table-head param-grid">
        <span>Location</span>
        <span>Block</span>
        <span>Parameter</span>
        <span>Value</span>
        <span>Unit</span>
        <span>Range</span>
        <span />
      </div>
      <VirtualRows
        count={rows.length}
        render={(i) => {
          const r = rows[i];
          const p = r.parameter;
          return (
            <div
              key={r.key}
              className="table-row param-grid"

              onDoubleClick={() =>
                onReveal({ sheetId: r.sheetId, blockId: r.blockId })
              }
            >
              <span title={r.sheet}>{r.sheet}</span>
              <span title={r.blockName}>{r.blockName}</span>
              <span title={p.id}>
                {p.name}
                {r.promotedAs && (
                  <em className="promoted-tag">↑ {r.promotedAs}</em>
                )}
              </span>
              <NumberField
                value={p.value}
                min={p.min}
                max={p.max}
                ariaLabel={`${r.blockName} ${p.name}`}
                disabled={!!r.promotedAs}
                onChange={(value) =>
                  onCommit((d) =>
                    setParameterAt(d, r.sheetId, r.blockId, p.id, value),
                  )
                }
              />
              <span>{p.unit}</span>
              <span className="table-muted">
                {p.min !== undefined || p.max !== undefined
                  ? `${p.min ?? '−∞'} … ${p.max ?? '∞'}`
                  : ''}
              </span>
              <span className="row-actions">
                {r.sheetId && !r.promotedAs && (
                  <button
                    title="Promote to a parameter of the subsystem block"
                    aria-label={`Promote ${r.blockName} ${p.name}`}
                    onClick={() =>
                      onCommit((d) =>
                        syncInstances(
                          promoteParameter(d, r.sheetId, r.blockId, p.id),
                        ),
                      )
                    }
                  >
                    <ArrowUpToLine size={12} />
                  </button>
                )}
                <button
                  title="Show on the canvas"
                  aria-label={`Show ${r.blockName}`}
                  onClick={() =>
                    onReveal({ sheetId: r.sheetId, blockId: r.blockId })
                  }
                >
                  <Crosshair size={12} />
                </button>
              </span>
            </div>
          );
        }}
      />
    </>
  );
}

/** Renders only the rows in view, so a 1,000-block model scrolls smoothly. */
function VirtualRows({
  count,
  render,
}: {
  count: number;
  render: (i: number) => ReactNode;
}) {
  const [scroll, setScroll] = useState(0);
  const [height, setHeight] = useState(600);
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const observer = new ResizeObserver(() => setHeight(el.clientHeight));
    observer.observe(el);
    return () => observer.disconnect();
  }, []);
  const first = Math.max(0, Math.floor(scroll / ROW) - 10);
  const last = Math.min(count, Math.ceil((scroll + height) / ROW) + 10);
  const items: ReactNode[] = [];
  for (let i = first; i < last; i++) items.push(render(i));
  return (
    <div
      className="table-rows"
      ref={ref}
      onScroll={(e) => setScroll(e.currentTarget.scrollTop)}
    >
      <div style={{ height: count * ROW, position: 'relative' }}>
        <div
          style={{ position: 'absolute', top: first * ROW, left: 0, right: 0 }}
        >
          {items}
        </div>
      </div>
      {!count && <p className="explorer-empty">Nothing to show here.</p>}
    </div>
  );
}

// ---------------------------------------------------------------- variants

function VariantsView({
  doc,
  index,
  checks,
  onCommit,
  onRunAll,
}: {
  doc: Project;
  index: ExplorerIndex;
  checks: VariantChecks;
  onCommit: (change: (doc: Project) => Project) => void;
  onRunAll: () => void;
}) {
  const instances = variantInstances(doc);
  const configurations = doc.configurations ?? [];
  const current = matchingConfiguration(doc);
  const sheet = (id: string) =>
    index.sheets.find((s) => s.id === id)?.label ?? '';
  if (!instances.length)
    return (
      <p className="explorer-empty">
        No subsystem has variants yet. Select a subsystem block in the Diagram
        and add a variant in the inspector.
      </p>
    );
  return (
    <>
      <div className="table-tools">
        <button
          className="tool-button"
          onClick={() =>
            onCommit(
              (d) =>
                saveConfiguration(
                  d,
                  `Configuration ${configurations.length + 1}`,
                ).project,
            )
          }
        >
          <Plus size={12} /> Configuration from current choices
        </button>
        <button
          className="tool-button"
          disabled={configurations.length < 2}
          onClick={onRunAll}
        >
          <Play size={11} /> Run all configurations
        </button>
        <label className="table-check">
          <input
            type="checkbox"
            checked={checks.enabled}
            onChange={(e) => checks.setEnabled(e.target.checked)}
          />
          Compile inactive variants in the background
        </label>
        <button
          className="tool-button"
          disabled={checks.running}
          onClick={() => void checks.run()}
        >
          {checks.running ? 'Compiling…' : 'Compile now'}
        </button>
      </div>
      {(checks.results.length > 0 || checks.error) && (
        <ul className="variant-checks">
          {checks.error && <li className="is-bad">{checks.error}</li>}
          {checks.results.map((r) => (
            <li
              key={`${r.key}-${r.variantId}`}
              className={r.ok ? 'is-ok' : 'is-bad'}
              title={r.message}
            >
              <strong>{r.name}</strong>{' '}
              {r.ok ? 'compiles' : r.message.split('\n')[0]}
            </li>
          ))}
        </ul>
      )}
      <div className="variants-table-wrap">
        <table className="variants-table">
          <thead>
            <tr>
              <th>Subsystem</th>
              <th>Current</th>
              {configurations.map((c) => (
                <th
                  key={c.id}
                  className={c.id === current?.id ? 'is-current' : ''}
                >
                  <input
                    defaultValue={c.name}
                    aria-label="Configuration name"
                    onBlur={(e) =>
                      onCommit((d) =>
                        renameConfiguration(d, c.id, e.target.value),
                      )
                    }
                    onKeyDown={(e) => {
                      if (e.key === 'Enter') e.currentTarget.blur();
                      e.stopPropagation();
                    }}
                  />
                  <button
                    className="apply-config"
                    onClick={() => onCommit((d) => applyConfiguration(d, c))}
                  >
                    Apply
                  </button>
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {instances.map((inst) => (
              <tr key={inst.key}>
                <td>
                  <strong>{inst.block.definition.name}</strong>
                  <span className="table-muted">{sheet(inst.sheetId)}</span>
                </td>
                <td>
                  <select
                    value={inst.active}
                    aria-label={`${inst.block.definition.name} active variant`}
                    onChange={(e) =>
                      onCommit((d) =>
                        applyConfiguration(d, {
                          id: 'now',
                          name: 'now',
                          choices: { [inst.key]: e.target.value },
                        }),
                      )
                    }
                  >
                    {inst.variants.map((v) => (
                      <option key={v.id} value={v.id}>
                        {v.name}
                      </option>
                    ))}
                  </select>
                </td>
                {configurations.map((c) => (
                  <td key={c.id}>
                    <select
                      value={c.choices[inst.key] ?? ''}
                      aria-label={`${inst.block.definition.name} in ${c.name}`}
                      onChange={(e) =>
                        onCommit((d) =>
                          setConfigurationChoice(
                            d,
                            c.id,
                            inst.key,
                            e.target.value,
                          ),
                        )
                      }
                    >
                      <option value="">(unchanged)</option>
                      {inst.variants.map((v) => (
                        <option key={v.id} value={v.id}>
                          {v.name}
                        </option>
                      ))}
                    </select>
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </>
  );
}

// ---------------------------------------------------------------- signals

function SignalsView({
  index,
  result,
  onCommit,
  onReveal,
  onOpenResults,
}: {
  index: ExplorerIndex;
  result: SimulationResult | null;
  onCommit: (change: (doc: Project) => Project) => void;
  onReveal: (target: ExplorerTarget) => void;
  onOpenResults: () => void;
}) {
  const [filter, setFilter] = useState('');
  const ranges = useMemo(() => {
    const out = new Map<string, [number, number]>();
    for (const s of result?.series ?? []) {
      if (!s.netId || result?.comparison) continue;
      let lo = Infinity,
        hi = -Infinity;
      for (const v of s.values) {
        if (v < lo) lo = v;
        if (v > hi) hi = v;
      }
      const prev = out.get(s.netId);
      out.set(
        s.netId,
        prev ? [Math.min(prev[0], lo), Math.max(prev[1], hi)] : [lo, hi],
      );
    }
    return out;
  }, [result]);
  const q = filter.toLowerCase();
  const rows = index.nets.filter(
    (n) => !q || `${n.name} ${n.sheet}`.toLowerCase().includes(q),
  );
  const fmt = (v: number) =>
    Math.abs(v) >= 1e4 || (Math.abs(v) < 1e-3 && v !== 0)
      ? v.toExponential(2)
      : Number(v.toPrecision(4)).toString();
  return (
    <>
      <div className="table-tools">
        <input
          className="table-filter"
          value={filter}
          placeholder="Filter signals"
          aria-label="Filter signals"
          onChange={(e) => setFilter(e.target.value)}
          onKeyDown={(e) => e.stopPropagation()}
        />
        <span className="table-count">
          {index.nets.filter((n) => n.net.logged).length} logged of{' '}
          {index.nets.length}
        </span>
        <button
          className="tool-button"
          onClick={onOpenResults}
          disabled={!result}
        >
          <LineChart size={12} /> Open Results
        </button>
      </div>
      <div className="table-head signal-grid">
        <span>Log</span>
        <span>Signal</span>
        <span>Location</span>
        <span>Unit</span>
        <span>Last run range</span>
        <span />
      </div>
      <div className="table-rows">
        {rows.map((n) => {
          const range = ranges.get(n.net.id);
          return (
            <div key={n.key} className="table-row signal-grid">
              <input
                type="checkbox"
                checked={!!n.net.logged}
                aria-label={`Log ${n.name}`}
                onChange={(e) =>
                  onCommit((d) =>
                    setNetLogged(d, n.sheetId, n.net.id, e.target.checked),
                  )
                }
              />
              <span>{n.name}</span>
              <span className="table-muted">{n.sheet}</span>
              <span>{n.unit}</span>
              <span className="table-muted">
                {range
                  ? `${fmt(range[0])} … ${fmt(range[1])}`
                  : n.net.logged
                    ? 'run to record'
                    : ''}
              </span>
              <span className="row-actions">
                <button
                  title="Show on the canvas"
                  aria-label={`Show ${n.name}`}
                  onClick={() =>
                    onReveal({ sheetId: n.sheetId, netId: n.net.id })
                  }
                >
                  <Crosshair size={12} />
                </button>
              </span>
            </div>
          );
        })}
        {!rows.length && <p className="explorer-empty">No signal nets.</p>}
      </div>
    </>
  );
}

// ---------------------------------------------------------------- details

function Details({
  doc,
  index,
  node,
  problems,
  onCommit,
  onReveal,
}: {
  doc: Project;
  index: ExplorerIndex;
  node: Node;
  problems: Diagnostic[];
  onCommit: (change: (doc: Project) => Project) => void;
  onReveal: (target: ExplorerTarget) => void;
}) {
  const row = node.blockId
    ? index.blocks.find(
        (b) => b.sheetId === node.sheetId && b.block.id === node.blockId,
      )
    : undefined;
  const sheet = index.sheets.find((s) => s.id === node.sheetId);
  const block: Block | undefined = row?.block;
  const inner = block?.definition.subsystem?.ref;
  const uses = inner
    ? (index.sheets.find((s) => s.id === inner)?.uses ?? 0)
    : 0;
  const own = block
    ? problems.filter(
        (p) => p.blockIds.includes(block.id) && p.severity !== 'info',
      )
    : [];
  return (
    <aside className="explorer-details" aria-label="Details">
      {block ? (
        <>
          <h3>{block.definition.name}</h3>
          <dl>
            <dt>Kind</dt>
            <dd>{block.definition.modelica?.class ?? block.definition.kind}</dd>
            <dt>Location</dt>
            <dd>{row!.sheet}</dd>
            <dt>ID</dt>
            <dd>
              <code>{block.id}</code>
            </dd>
            <dt>Ports</dt>
            <dd>
              {block.definition.ports.map((p) => p.name).join(', ') || '—'}
            </dd>
            {inner && (
              <>
                <dt>Inside</dt>
                <dd>
                  {findSubsystem(doc, inner)?.name}{' '}
                  {uses > 1 && `· Used ${uses}×`}
                </dd>
              </>
            )}
          </dl>
          <div className="details-actions">
            <button
              className="tool-button"
              onClick={() =>
                onReveal({ sheetId: node.sheetId, blockId: block.id })
              }
            >
              <Crosshair size={12} /> Show on canvas
            </button>
            {uses > 1 && node.sheetId === '' && (
              <button
                className="tool-button"
                onClick={() =>
                  onCommit((d) => syncInstances(makeUnique(d, block.id)))
                }
              >
                Make unique
              </button>
            )}
          </div>
          {own.length > 0 && (
            <ul className="details-problems">
              {own.map((p) => (
                <li key={p.id} className={`severity-${p.severity}`}>
                  {p.message}
                </li>
              ))}
            </ul>
          )}
        </>
      ) : (
        <>
          <h3>{sheet?.name ?? doc.name}</h3>
          <dl>
            <dt>Location</dt>
            <dd>{sheet?.label}</dd>
            <dt>Blocks</dt>
            <dd>
              {index.blocks.filter((b) => b.sheetId === node.sheetId).length}
            </dd>
            {!!node.sheetId && (
              <>
                <dt>Used</dt>
                <dd>{sheet?.uses}×</dd>
              </>
            )}
          </dl>
          {sheet?.path && (
            <div className="details-actions">
              <button
                className="tool-button"
                onClick={() => onReveal({ sheetId: node.sheetId })}
              >
                <Crosshair size={12} /> Open in Diagram
              </button>
            </div>
          )}
          {sheet?.inactive && (
            <p className="table-muted">
              This inside belongs to an inactive variant. Switch to it to open
              it.
            </p>
          )}
        </>
      )}
    </aside>
  );
}
