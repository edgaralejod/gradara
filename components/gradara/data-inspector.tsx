'use client';
import { useEffect, useEffectEvent, useRef, useState } from 'react';
import {
  Activity,
  Download,
  Hand,
  Scan,
  Crosshair,
  ZoomIn,
  ZoomOut,
  Maximize2,
  Minimize2,
  X,
  LayoutGrid,
  GitCompareArrows,
  ListChecks,
  Sparkles,
} from 'lucide-react';
import type { RunContext } from '@/lib/gradara/ask';
import {
  askAboutRuns,
  onInspectorCommand,
  padWindow,
  publishInspectorContext,
  takeInspectorCommand,
  windowAround,
  type InspectorCommand,
} from '@/lib/gradara/inspector-bus';
import { type SimulationResult } from '@/lib/gradara/api';
import { parameterDifferences } from '@/lib/gradara/compare';
import { plotOptions } from '@/lib/gradara/results';
import {
  clampTime,
  fitSeries,
  zoomRange,
  type Axes,
  type PlotView,
} from '@/lib/gradara/plot-navigation';
import {
  isAssigned,
  normalizeAssignments,
  plotTraces,
  runTitle,
  toggleAssignment,
  type Assignment,
  type RunTrace,
} from '@/lib/gradara/run-set';
import PlotViewport from './plot-viewport';
import { PaneResizer, useColumns, useFractions, useSize } from './resizable-columns';
import InspectorPlot, { traceColors } from './inspector-plot';
import RunCompareView from './run-compare-view';
import RunList from './run-list';
import RunSummary from './run-summary';
import { useRunLibrary } from './run-library';

type Plot = { signals: Assignment[]; view?: PlotView };
type Config = {
  layout: string;
  active: number;
  linked: boolean;
  plots: Plot[];
};
const layouts: Record<string, [number, number]> = {
  '1': [1, 1],
  '2v': [2, 1],
  '2h': [1, 2],
  '4': [2, 2],
  '6': [3, 2],
};
function initial(result: SimulationResult): Config {
  const groups = plotOptions(result).filter((o) => o.group);
  const logged = result.series.filter((s) => s.netId);
  return {
    layout: groups.length > 1 ? '2v' : '1',
    active: 0,
    linked: true,
    plots: Array.from({ length: 6 }, (_, i) => ({
      signals: (
        groups[i]?.series.map((s) => s.key) ??
        (i === 0
          ? logged.length
            ? logged.map((s) => s.key)
            : result.series.slice(0, 1).map((s) => s.key)
          : [])
      ).map((key) => ({ key })),
    })),
  };
}
const validRange = (r: unknown) =>
  Array.isArray(r) &&
  r.length === 2 &&
  r.every(Number.isFinite) &&
  r[1] > r[0];
/** A saved layout, including ones saved before runs could be overlaid (signals as bare keys). */
function readConfig(value: unknown): Config | null {
  if (!value || typeof value !== 'object') return null;
  const c = value as Config;
  if (
    !layouts[c.layout] ||
    !Number.isInteger(c.active) ||
    c.active < 0 ||
    c.active >= 6 ||
    typeof c.linked !== 'boolean' ||
    !Array.isArray(c.plots) ||
    c.plots.length !== 6
  )
    return null;
  const plots: Plot[] = [];
  for (const p of c.plots) {
    const signals = p && normalizeAssignments(p.signals);
    if (!signals) return null;
    if (p.view && !(validRange(p.view.x) && validRange(p.view.y))) return null;
    plots.push(p.view ? { signals, view: p.view } : { signals });
  }
  return { layout: c.layout, active: c.active, linked: c.linked, plots };
}

/** Signals inside subsystems are named by path ("Drive › Inverter › iq"); group them by that path. */
function groupSignals<T extends { name: string }>(signals: T[]) {
  const out = new Map<string, T[]>();
  for (const s of signals) {
    const name = s.name.replace(/^\[[^\]]*\]\s*/, '');
    const cut = name.lastIndexOf(' › ');
    const group = cut > 0 ? name.slice(0, cut) : 'Top level';
    out.set(group, [...(out.get(group) ?? []), s]);
  }
  return [...out.entries()].sort(([a], [b]) =>
    a === 'Top level' ? -1 : b === 'Top level' ? 1 : a.localeCompare(b),
  );
}

function InspectorSession({
  result,
  running,
  error,
  stale,
  modelId,
}: {
  result: SimulationResult;
  running: boolean;
  error: string;
  stale: boolean;
  modelId?: string;
}) {
  const model = modelId ?? result.snapshot?.modelId;
  const storageKey = `gradara-inspector:${modelId ?? result.snapshot?.modelId ?? 'workspace'}${result.comparison ? ':compare' : ''}`;
  // An overlay of several configurations already holds full data; it is not a stored run.
  const overlay = !!result.comparison;
  const library = useRunLibrary({
    modelId: model,
    latestId: result.id,
    preview: result,
    enabled: !overlay && !!model,
  });
  const [config, setConfig] = useState<Config>(() => {
    let stored: unknown;
    try {
      stored = JSON.parse(localStorage.getItem(storageKey) ?? 'null');
    } catch {
      stored = null;
    }
    return readConfig(stored) ?? initial(result);
  });
  const [query, setQuery] = useState(''),
    [onlyLogged, setOnlyLogged] = useState(false);
  const [axes, setAxes] = useState<Axes>('x'),
    [mode, setMode] = useState<'pan' | 'zoom' | 'cursor'>('pan');
  const [maximized, setMaximized] = useState<number | null>(null);
  // Compare the open runs signal by signal, in place of the plot grid.
  const [comparing, setComparing] = useState(false);
  // The Run summary (statistics of the shown runs), in place of the plot grid.
  const [summarizing, setSummarizing] = useState(false);
  const [baselineId, setBaselineId] = useState('');
  /** Evidence to show once its run's data has arrived. */
  const [pendingFocus, setPendingFocus] = useState<Extract<InspectorCommand, { type: 'focus' }> | null>(null);
  const signalPane = useColumns('inspector-signals', [244], 150);
  const signalStart = useRef(0);
  const { attach: attachRuns, ...runsPane } = useSize('inspector-runs', 190, 70);
  const [storageError, setStorageError] = useState('');
  useEffect(() => {
    // Debounce synchronous browser storage writes while panning.
    const timer = setTimeout(() => {
      try {
        localStorage.setItem(storageKey, JSON.stringify(config));
        setStorageError('');
      } catch {
        setStorageError('Plot preferences could not be saved in this browser.');
      }
    }, 150);
    return () => clearTimeout(timer);
  }, [config, storageKey]);

  // The runs on show, newest first, each with the data it has so far.
  const entries = library.open.flatMap((id) => {
    const data = library.dataOf(id);
    if (!data) return [];
    const stored = library.runs?.find((r) => r.id === id);
    return [
      {
        id,
        data,
        color: library.colorOf(id),
        title: overlay ? 'Configurations' : stored ? runTitle(stored) : 'Latest run',
      },
    ];
  });
  const openIds = entries.map((e) => e.id);
  const several = entries.length > 1;
  const signalColor = (id: string, key: string) => {
    const at = entries.find((e) => e.id === id)?.data.series.findIndex((s) => s.key === key) ?? 0;
    return traceColors[Math.max(0, at) % traceColors.length];
  };
  const tracesOf = (signals: Assignment[]) => plotTraces(signals, entries, signalColor);
  const duration = Math.max(1e-9, ...entries.map((e) => e.data.duration));
  const time = entries[0]?.data.time ?? [];
  const plotView = (plot: Plot): PlotView => {
    const x = clampTime(plot.view?.x ?? [0, duration], duration);
    return {
      x,
      y:
        plot.view?.y ??
        fitSeries(
          tracesOf(plot.signals).map((t) => ({ time: t.time, values: t.values })),
          x,
        ),
    };
  };
  const edit = (change: (c: Config) => Config) =>
    setConfig((c) => (c ? change(c) : c));
  const changeView = (index: number, view: PlotView) =>
    edit((c) => ({
      ...c,
      plots: c.plots.map((p, i) =>
        i === index
          ? { ...p, view }
          : c.linked
            ? { ...p, view: { ...plotView(p), x: view.x } }
            : p,
      ),
    }));
  const changeSignals = (
    index: number,
    next: (signals: Assignment[]) => Assignment[],
  ) =>
    edit((c) => ({
      ...c,
      plots: c.plots.map((p, i) => {
        if (i !== index) return p;
        const signals = next(p.signals);
        return {
          ...p,
          signals,
          view: p.view
            ? {
                ...p.view,
                y: fitSeries(
                  tracesOf(signals).map((t) => ({ time: t.time, values: t.values })),
                  p.view.x,
                ),
              }
            : undefined,
        };
      }),
    }));
  /** One run's copy of a signal on or off a plot. */
  const toggle = (index: number, key: string, run: string, checked: boolean) =>
    changeSignals(index, (list) => toggleAssignment(list, key, run, checked, openIds));
  /** A signal dropped on a plot goes on every open run that has it. */
  const place = (index: number, key: string) =>
    changeSignals(index, (list) =>
      list.some((a) => a.key === key)
        ? list.map((a) => (a.key === key ? { key } : a))
        : [...list, { key }],
    );
  const fit = (index: number, which: Axes = 'xy') => {
    if (!config) return;
    const p = config.plots[index],
      v = plotView(p),
      x: PlotView['x'] = which === 'y' ? v.x : [0, duration];
    changeView(index, {
      x,
      y:
        which === 'x'
          ? v.y
          : fitSeries(
              tracesOf(p.signals).map((t) => ({ time: t.time, values: t.values })),
              x,
            ),
    });
  };
  const zoom = (factor: number) => {
    if (!config) return;
    const v = plotView(config.plots[config.active]);
    changeView(config.active, {
      x: axes === 'y' ? v.x : clampTime(zoomRange(v.x, factor), duration),
      y: axes === 'x' ? v.y : zoomRange(v.y, factor),
    });
  };
  const [rows, cols] = layouts[config?.layout ?? '1'];
  const active = config?.active ?? 0;
  const visible = Array.from({ length: rows * cols }, (_, i) => i);
  const displayed = maximized === null ? visible : [maximized];
  const layoutKey = config?.layout ?? '1';
  const { attach: attachCols, ...colSplit } = useFractions(`di-grid-${layoutKey}-cols`, cols);
  const { attach: attachRows, ...rowSplit } = useFractions(`di-grid-${layoutKey}-rows`, rows);
  const matching = (entry: (typeof entries)[number]) =>
    entry.data.series.filter(
      (s) =>
        (!onlyLogged || s.netId) &&
        `${s.name} ${s.unit}`.toLowerCase().includes(query.toLowerCase()),
    );
  const signalCount = entries.reduce((n, e) => n + e.data.series.length, 0);
  const shownAny = entries.some((e) => matching(e).length);
  // Parameters that differ from the run shown first, for each other run.
  const reference = entries[0];
  const differences = (entry: (typeof entries)[number]) =>
    reference && entry !== reference && reference.data.snapshot && entry.data.snapshot
      ? parameterDifferences(entry.data.snapshot, reference.data.snapshot)
      : [];
  const canCompare = several && !overlay && !!model;
  // The Runs list can bring a run back, so an inspector with none shown is still worth showing.
  const listsRuns = !overlay && !!model;
  const compareOn = comparing && canCompare;
  const baseline = entries.some((e) => e.id === baselineId)
    ? baselineId
    : (entries[entries.length - 1]?.id ?? '');
  const activeSignals = config.plots[active].signals;
  const loading = library.open.some((id) => !library.dataOf(id));
  const sampleText = (id: string, samples: number) =>
    library.isFull(id) || overlay
      ? `${samples.toLocaleString()} samples`
      : `${samples.toLocaleString()} samples · preview`;
  const summaryOn = summarizing && !overlay && !!model && entries.length > 0 && !compareOn;

  // What is on show, for the Ask bar: the shown runs, the active plot's signals, and its zoom.
  const activeView = entries.length ? plotView(config.plots[active]) : null;
  const zoomed =
    !!activeView && (activeView.x[0] > duration * 1e-9 || activeView.x[1] < duration * (1 - 1e-9));
  const plotted = [...new Set(activeSignals.map((a) => a.key))].slice(0, 12);
  const runContext: RunContext | null =
    !overlay && model && entries.length
      ? {
          modelId: model,
          runIds: openIds,
          ...(compareOn ? { baseline } : {}),
          signals: plotted,
          ...(zoomed && activeView ? { window: activeView.x } : {}),
          titles: Object.fromEntries(entries.map((e) => [e.id, e.title])),
          signalNames: Object.fromEntries(
            plotted.map((key) => [
              key,
              entries.flatMap((e) => e.data.series).find((s) => s.key === key)?.name ?? key,
            ]),
          ),
        }
      : null;
  const contextKey = JSON.stringify(runContext);
  useEffect(() => {
    publishInspectorContext(contextKey === 'null' ? null : (JSON.parse(contextKey) as RunContext));
  }, [contextKey]);
  useEffect(() => () => publishInspectorContext(null), []);

  // Commands from elsewhere: show an answer's evidence, or compare a new run with the one discussed.
  const handleCommand = useEffectEvent(() => {
    if (!model) return;
    const command = takeInspectorCommand(model);
    if (!command) return;
    setMaximized(null);
    if (command.type === 'compare') {
      for (const id of command.runIds) library.setOpen(id, true);
      setBaselineId(command.baseline);
      setSummarizing(false);
      setComparing(true);
      return;
    }
    setComparing(false);
    setSummarizing(false);
    if (!library.open.includes(command.runId)) library.setOpen(command.runId, true);
    setPendingFocus(command);
  });
  useEffect(() => {
    // A command sent before this inspector opened is taken right after it mounts.
    const first = setTimeout(handleCommand, 0);
    const stop = onInspectorCommand(handleCommand);
    return () => {
      clearTimeout(first);
      stop();
    };
  }, []);
  const applyFocus = useEffectEvent(() => {
    const focus = pendingFocus;
    if (!focus) return;
    const entry = entries.find((e) => e.id === focus.runId);
    if (!entry) return; // wait for the run's data
    setPendingFocus(null);
    const x = focus.window ? padWindow(focus.window, duration) : windowAround(focus.at ?? 0, duration);
    edit((c) => {
      const signals = toggleAssignment(c.plots[c.active].signals, focus.key, focus.runId, true, openIds);
      return {
        ...c,
        plots: c.plots.map((p, i) =>
          i === c.active
            ? {
                ...p,
                signals,
                view: {
                  x,
                  y: fitSeries(
                    tracesOf(signals).map((t) => ({ time: t.time, values: t.values })),
                    x,
                  ),
                },
              }
            : c.linked
              ? { ...p, view: { ...plotView(p), x } }
              : p,
        ),
      };
    });
  });
  useEffect(() => {
    if (!pendingFocus) return;
    // Applied once the run's data is there; a frame later, so the plot sees the new run.
    const timer = setTimeout(applyFocus, 0);
    return () => clearTimeout(timer);
  }, [pendingFocus, entries.length, library.open]);
  return (
    <section className="data-inspector" aria-label="Data Inspector">
      <header className="di-heading">
        <strong>
          <Activity size={14} aria-hidden="true" /> Data Inspector
        </strong>
        <span>
          {running
            ? 'Simulating…'
            : error
              ? 'Run failed'
              : !result
                ? 'No run yet'
                : stale
                  ? 'Model changed · Run again'
                  : result.comparison
                    ? `Comparing ${result.comparison.map((c) => c.name).join(' · ')}`
                    : several
                      ? `Showing ${entries.map((e) => e.title).join(' · ')}`
                      : 'Completed'}
        </span>
        {!overlay && !!model && (
          <button
            type="button"
            className="di-compare"
            aria-pressed={compareOn}
            disabled={!canCompare}
            title={
              canCompare
                ? 'Compare the shown runs signal by signal, against a baseline'
                : 'Tick a second run in the Runs list to compare it with this one'
            }
            onClick={() => {
              setSummarizing(false);
              setComparing((on) => !on);
            }}
          >
            <GitCompareArrows size={13} aria-hidden="true" /> Compare runs
          </button>
        )}
        {!overlay && !!model && (
          <button
            type="button"
            className="di-compare"
            aria-pressed={summaryOn}
            disabled={!entries.length}
            title="Statistics, events and differences of the shown runs, computed on this computer"
            onClick={() => {
              setComparing(false);
              setSummarizing((on) => !on);
            }}
          >
            <ListChecks size={13} aria-hidden="true" /> Summary
          </button>
        )}
        {runContext && (
          <button
            type="button"
            className="di-compare di-ask"
            title="Ask AI about the shown runs (A). You see what is sent and the price first."
            onClick={() => askAboutRuns(runContext)}
          >
            <Sparkles size={13} aria-hidden="true" /> Ask about this run
          </button>
        )}
        {result && !result.comparison && (
          <a href={`/api/results/${result.id}/csv`} download>
            <Download size={13} aria-hidden="true" /> Export CSV
          </a>
        )}
      </header>
      {error && (
        <div role="alert" className="di-error">
          {error}
        </div>
      )}
      {library.errors.length > 0 && (
        <div role="alert" className="di-error">
          Full-resolution data could not load. Showing preview samples where
          there are any. {library.errors[0]}{' '}
          <button onClick={library.retry}>Retry</button>
        </div>
      )}
      {storageError && <output>{storageError}</output>}
      {summaryOn && model ? (
        <RunSummary
          modelId={model}
          runIds={openIds}
          baseline={compareOn ? baseline : undefined}
          signals={plotted}
          window={runContext?.window}
          titles={Object.fromEntries(entries.map((e) => [e.id, e.title]))}
          colors={Object.fromEntries(entries.map((e) => [e.id, e.color]))}
          onFocus={(runId, key, target) => {
            setSummarizing(false);
            if (!library.open.includes(runId)) library.setOpen(runId, true);
            setPendingFocus({ type: 'focus', modelId: model, runId, key, ...target });
          }}
        />
      ) : compareOn ? (
        <RunCompareView
          entries={entries}
          baselineId={baseline}
          onBaseline={setBaselineId}
          modelKey={model ?? 'workspace'}
        />
      ) : !config || (!entries.length && !listsRuns) ? (
        <div className="di-empty">
          Select a signal wire → Log to Data Inspector, then run the model.
          Sensor outputs can be logged; physical connections require a sensor.
        </div>
      ) : (
        <>
          <div className="di-toolbar" aria-label="Plot navigation">
            <label>
              <LayoutGrid size={14} aria-hidden="true" /> Layout{' '}
              <select
                aria-label="Plot layout"
                value={config.layout}
                onChange={(e) => {
                  const value = e.target.value;
                  edit((c) => ({
                    ...c,
                    layout: value,
                    active: Math.min(
                      c.active,
                      layouts[value][0] * layouts[value][1] - 1,
                    ),
                  }));
                  setMaximized(null);
                }}
              >
                <option value="1">1 plot</option>
                <option value="2v">2 stacked</option>
                <option value="2h">2 side by side</option>
                <option value="4">2 × 2</option>
                <option value="6">3 × 2</option>
              </select>
            </label>
            <span className="di-divider" />
            {(['pan', 'zoom', 'cursor'] as const).map((m) => (
              <button
                key={m}
                aria-pressed={mode === m}
                onClick={() => setMode(m)}
              >
                {m === 'pan' ? (
                  <Hand size={14} aria-hidden="true" />
                ) : m === 'zoom' ? (
                  <Scan size={14} aria-hidden="true" />
                ) : (
                  <Crosshair size={14} aria-hidden="true" />
                )}
                {m === 'pan' ? 'Pan' : m === 'zoom' ? 'Box zoom' : 'Cursor'}
              </button>
            ))}
            <label>
              Axes{' '}
              <select
                aria-label="Zoom and pan axes"
                value={axes}
                onChange={(e) => setAxes(e.target.value as Axes)}
              >
                <option value="x">X only</option>
                <option value="y">Y only</option>
                <option value="xy">X + Y</option>
              </select>
            </label>
            <button aria-label="Zoom in" onClick={() => zoom(0.5)}>
              <ZoomIn size={15} aria-hidden="true" />
            </button>
            <button aria-label="Zoom out" onClick={() => zoom(2)}>
              <ZoomOut size={15} aria-hidden="true" />
            </button>
            <button onClick={() => fit(active, 'x')}>Fit X</button>
            <button onClick={() => fit(active, 'y')}>Fit Y</button>
            <button onClick={() => fit(active)}>Fit both</button>
            <label>
              <input
                type="checkbox"
                checked={config.linked}
                onChange={(e) => {
                  const checked = e.target.checked;
                  edit((c) => ({
                    ...c,
                    linked: checked,
                    plots: checked
                      ? c.plots.map((p) => ({
                          ...p,
                          view: {
                            ...plotView(p),
                            x: plotView(c.plots[c.active]).x,
                          },
                        }))
                      : c.plots,
                  }));
                }}
              />
              Link X axes
            </label>
          </div>
          <div className="di-workspace">
            <PaneResizer
              className="signals-resizer"
              style={{
                left: `calc(min(${signalPane.widths[0]}px, 45%) - 3px)`,
              }}
              label="Resize the signal list"
              onReset={signalPane.reset}
              onResize={(delta, start) => {
                if (start) signalStart.current = signalPane.current.current[0];
                signalPane.resize(
                  0,
                  Math.min(480, signalStart.current + delta),
                );
              }}
            />
            <aside
              className="di-signals"
              aria-label="Runs and signals"
              style={{ width: `min(${signalPane.widths[0]}px, 45%)` }}
            >
              {!overlay && (
                <>
                  <div
                    className={`di-runs-pane${runsPane.stored ? ' is-sized' : ''}`}
                    ref={attachRuns}
                    style={
                      runsPane.stored ? { height: runsPane.size } : undefined
                    }
                  >
                  <div className="di-pane-title">
                    <strong>Runs</strong>
                    <span>{library.runs?.length ?? 0}</span>
                  </div>
                  <RunList
                    runs={library.runs}
                    error={library.listError}
                    latestId={result.id}
                    open={library.open}
                    colorOf={library.colorOf}
                    onOpen={library.setOpen}
                    onColor={library.setColor}
                    onRename={library.rename}
                    onRemove={library.remove}
                  />
                  <p>Tick up to three runs to show them together.</p>
                  </div>
                  <PaneResizer
                    axis="y"
                    label="Resize the run list"
                    {...runsPane.resizer(1)}
                  />
                </>
              )}
              <div className="di-signals-pane">
              <div className="di-pane-title">
                <strong>Signals</strong>
                <span>{signalCount}</span>
              </div>
              <p>Assign to plot {active + 1}, or drag onto a plot.</p>
              <input
                aria-label="Search signals"
                placeholder="Find a signal…"
                value={query}
                onChange={(e) => setQuery(e.target.value)}
              />
              <label className="di-logged-filter">
                <input
                  type="checkbox"
                  checked={onlyLogged}
                  onChange={(e) => setOnlyLogged(e.target.checked)}
                />
                Logged nets only
              </label>
              {entries.map((entry) => {
                const changes = differences(entry);
                const groups = groupSignals(matching(entry));
                return (
                  <section
                    key={entry.id}
                    className="di-run-section"
                    aria-label={`Signals of ${entry.title}`}
                  >
                    {(several || !overlay) && (
                      <div className="di-run-head">
                        {several ? (
                          <input
                            type="color"
                            className="di-run-color"
                            aria-label={`Colour of ${entry.title}`}
                            title="Colour of this run on the plots"
                            value={entry.color}
                            onChange={(e) =>
                              library.setColor(entry.id, e.target.value)
                            }
                          />
                        ) : null}
                        <strong title={entry.title}>{entry.title}</strong>
                        <small
                          title={
                            changes.length
                              ? `Compared with ${reference.title}, this run differs: ${changes.join('; ')}`
                              : undefined
                          }
                        >
                          {changes.length
                            ? `${changes.length} change${changes.length === 1 ? '' : 's'}`
                            : sampleText(entry.id, entry.data.time.length)}
                        </small>
                      </div>
                    )}
                    {groups.map(([group, signals]) => (
                      <div key={group} className="di-group">
                        {groups.length > 1 && (
                          <div className="di-group-title">{group}</div>
                        )}
                        {signals.map((s) => {
                          const on = isAssigned(activeSignals, s.key, entry.id, openIds);
                          return (
                            <div
                              key={s.key}
                              className={`di-signal ${on ? 'is-assigned' : ''}`}
                            >
                              <input
                                type="checkbox"
                                aria-label={`Plot ${s.name}${several ? ` of ${entry.title}` : ''} in plot ${active + 1}`}
                                checked={on}
                                onChange={(e) =>
                                  toggle(active, s.key, entry.id, e.target.checked)
                                }
                              />
                              <button
                                className="di-drag-signal"
                                draggable
                                onDragStart={(e) => {
                                  e.dataTransfer.setData(
                                    'application/gradara-signal',
                                    s.key,
                                  );
                                  e.dataTransfer.effectAllowed = 'copy';
                                }}
                                onClick={() =>
                                  toggle(active, s.key, entry.id, !on)
                                }
                                title={`${s.name} · ${s.unit || 'unitless'}${s.netId ? ' · logged' : ''} — Drag onto a plot or click to toggle`}
                              >
                                <i
                                  style={{
                                    background: several
                                      ? entry.color
                                      : signalColor(entry.id, s.key),
                                  }}
                                />
                                <span>{s.name}</span>
                                <small>{s.unit || '—'}</small>
                              </button>
                            </div>
                          );
                        })}
                      </div>
                    ))}
                  </section>
                );
              })}
              {!entries.length ? (
                <p>
                  {loading
                    ? 'Loading the run…'
                    : 'No run is shown. Tick a run above to list its signals.'}
                </p>
              ) : !shownAny && (
                <p>
                  No matching signals. Mark signal nets for logging and run
                  again.
                </p>
              )}
              {several && (
                <p>
                  A signal ticked in one run is drawn for every shown run that
                  has it; untick it in a run to hide it just there.
                </p>
              )}
              <p className="di-resolution">
                {loading
                  ? 'Loading full resolution…'
                  : entries
                      .map((e) => `${e.title}: ${sampleText(e.id, e.data.time.length)}`)
                      .join(' · ')}
              </p>
              </div>
            </aside>
            {!entries.length ? (
              <div className="di-grid di-no-runs">
                <div className="di-empty">
                  <strong>No run is shown.</strong>
                  <p>
                    {loading
                      ? 'Loading the run…'
                      : 'Tick a run in the Runs list to plot it again, or show the latest run.'}
                  </p>
                  {!loading && (
                    <button
                      type="button"
                      onClick={() => library.setOpen(result.id, true)}
                    >
                      Show the latest run
                    </button>
                  )}
                </div>
              </div>
            ) : (
            <div
              className="di-grid"
              ref={(node) => {
                attachCols(node);
                attachRows(node);
              }}
              style={
                maximized === null
                  ? {
                      gridTemplateColumns: colSplit.fractions
                        .map((f) => `minmax(0,${f * 100}fr)`)
                        .join(' 1px '),
                      gridTemplateRows: rowSplit.fractions
                        .map((f) => `minmax(180px,${f * 100}fr)`)
                        .join(' 1px '),
                      gap: 0,
                    }
                  : {
                      gridTemplateColumns: 'minmax(0,1fr)',
                      gridTemplateRows: 'minmax(180px,1fr)',
                    }
              }
            >
              {displayed.map((index) => {
                const p = config.plots[index],
                  selected: RunTrace[] = tracesOf(p.signals),
                  v = plotView(p),
                  missing = p.signals.filter(
                    (a) => !entries.some((e) => e.data.series.some((s) => s.key === a.key)),
                  );
                return (
                  <div
                    role="presentation"
                    key={index}
                    className={`di-tile ${active === index ? 'is-active' : ''}`}
                    style={
                      maximized === null
                        ? {
                            gridColumn: (index % cols) * 2 + 1,
                            gridRow: Math.floor(index / cols) * 2 + 1,
                          }
                        : undefined
                    }
                    onDragOver={(e) => {
                      if (
                        e.dataTransfer.types.includes(
                          'application/gradara-signal',
                        )
                      ) {
                        e.preventDefault();
                        e.dataTransfer.dropEffect = 'copy';
                      }
                    }}
                    onDrop={(e) => {
                      e.preventDefault();
                      const key = e.dataTransfer.getData(
                        'application/gradara-signal',
                      );
                      if (entries.some((r) => r.data.series.some((s) => s.key === key))) {
                        place(index, key);
                        edit((c) => ({ ...c, active: index }));
                      }
                    }}
                  >
                    <header>
                      <button
                        aria-label={`Select plot ${index + 1}`}
                        aria-pressed={active === index}
                        onClick={() => edit((c) => ({ ...c, active: index }))}
                      >
                        <span className="di-plot-number">
                          {String(index + 1).padStart(2, '0')}
                        </span>{' '}
                        Plot {index + 1}
                      </button>
                      <span>
                        {[
                          ...new Set(selected.map((s) => s.unit || 'unitless')),
                        ].join(' / ')}
                      </span>
                      <button
                        aria-label={
                          maximized === index ? 'Restore' : 'Maximize'
                        }
                        title={
                          maximized === index ? 'Restore plot' : 'Maximize plot'
                        }
                        onClick={() =>
                          setMaximized(maximized === index ? null : index)
                        }
                      >
                        {maximized === index ? (
                          <Minimize2 size={13} aria-hidden="true" />
                        ) : (
                          <Maximize2 size={13} aria-hidden="true" />
                        )}
                      </button>
                      <button
                        aria-label={`Clear plot ${index + 1}`}
                        title="Clear plot"
                        onClick={() =>
                          edit((c) => ({
                            ...c,
                            plots: c.plots.map((p, i) =>
                              i === index ? { signals: [] } : p,
                            ),
                          }))
                        }
                      >
                        <X size={14} aria-hidden="true" />
                      </button>
                    </header>
                    <div className="di-chart">
                      <PlotViewport>
                        {({ width, height }) => (
                          <InspectorPlot
                            width={width}
                            height={height}
                            time={time}
                            traces={selected}
                            view={v}
                            axes={axes}
                            mode={mode}
                            duration={duration}
                            onActivate={() =>
                              edit((c) => ({ ...c, active: index }))
                            }
                            onView={(next) => changeView(index, next)}
                            onFit={() => fit(index)}
                          />
                        )}
                      </PlotViewport>
                      {!selected.length && (
                        <div className="di-drop-hint">
                          Select signals or drop them here
                        </div>
                      )}
                    </div>
                    <div className="di-legend">
                      {selected.map((s) => (
                        <button
                          key={s.key}
                          title="Remove from this plot"
                          onClick={() => toggle(index, s.signal, s.run, false)}
                        >
                          <i
                            style={{
                              background: s.dash?.length
                                ? `repeating-linear-gradient(90deg, ${s.color} 0 ${s.dash[0] || 6}px, transparent ${s.dash[0] || 6}px ${(s.dash[0] || 6) + (s.dash[1] ?? 3)}px)`
                                : s.color,
                            }}
                          />
                          {several
                            ? `${s.name} · ${entries.find((e) => e.id === s.run)?.title ?? ''}`
                            : s.name}
                          {s.unit ? ` (${s.unit})` : ''} ×
                        </button>
                      ))}
                      {missing.length > 0 && (
                        <span>
                          {missing.length} assigned signal(s) unavailable in
                          the shown runs
                        </span>
                      )}
                    </div>
                  </div>
                );
              })}
              {maximized === null &&
                Array.from({ length: cols - 1 }, (_, i) => (
                  <PaneResizer
                    key={`col-${i}`}
                    className="in-grid"
                    style={{ gridColumn: i * 2 + 2, gridRow: '1 / -1' }}
                    label={`Resize plot columns ${i + 1} and ${i + 2}`}
                    {...colSplit.divider(i, 'x')}
                  />
                ))}
              {maximized === null &&
                Array.from({ length: rows - 1 }, (_, i) => (
                  <PaneResizer
                    key={`row-${i}`}
                    axis="y"
                    className="in-grid"
                    style={{ gridRow: i * 2 + 2, gridColumn: '1 / -1' }}
                    label={`Resize plot rows ${i + 1} and ${i + 2}`}
                    {...rowSplit.divider(i, 'y')}
                  />
                ))}
            </div>
            )}
          </div>
          <footer className="di-footer">
            Plot {active + 1} · Wheel zooms at pointer · Drag to{' '}
            {mode === 'zoom'
              ? 'zoom a region'
              : mode === 'pan'
                ? 'pan'
                : 'inspect samples'}{' '}
            · Double-click or Home fits · Arrow keys pan
          </footer>
        </>
      )}
    </section>
  );
}

export default function DataInspector(props: {
  result: SimulationResult | null;
  running: boolean;
  error: string;
  stale: boolean;
  modelId?: string;
}) {
  if (!props.result)
    return (
      <section className="data-inspector" aria-label="Data Inspector">
        <header className="di-heading">
          <strong>
            <Activity size={14} aria-hidden="true" /> Data Inspector
          </strong>
          <span>{props.running ? 'Simulating…' : 'No run yet'}</span>
        </header>
        {props.error && (
          <div role="alert" className="di-error">
            {props.error}
          </div>
        )}
        <div className="di-empty">
          Select a signal wire → Log to Data Inspector, then run the model. Use
          sensors to measure physical quantities.
        </div>
      </section>
    );
  return (
    <InspectorSession
      key={props.modelId ?? props.result.snapshot?.modelId ?? 'workspace'}
      {...props}
      result={props.result}
    />
  );
}
