'use client';
import { useEffect, useMemo, useState } from 'react';
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
} from 'lucide-react';
import { api, type SimulationResult } from '@/lib/gradara/api';
import { plotOptions } from '@/lib/gradara/results';
import {
  clampTime,
  fitValues,
  zoomRange,
  type Axes,
  type PlotView,
} from '@/lib/gradara/plot-navigation';
import PlotViewport from './plot-viewport';
import InspectorPlot, { traceColors } from './inspector-plot';

type Plot = { signals: string[]; view?: PlotView };
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
      signals:
        groups[i]?.series.map((s) => s.key) ??
        (i === 0
          ? logged.length
            ? logged.map((s) => s.key)
            : result.series.slice(0, 1).map((s) => s.key)
          : []),
    })),
  };
}
function validConfig(value: unknown): value is Config {
  if (!value || typeof value !== 'object') return false;
  const c = value as Config;
  return (
    !!layouts[c.layout] &&
    Number.isInteger(c.active) &&
    c.active >= 0 &&
    c.active < 6 &&
    typeof c.linked === 'boolean' &&
    Array.isArray(c.plots) &&
    c.plots.length === 6 &&
    c.plots.every(
      (p) =>
        p &&
        Array.isArray(p.signals) &&
        p.signals.every((k) => typeof k === 'string') &&
        (!p.view ||
          [p.view.x, p.view.y].every(
            (r) =>
              Array.isArray(r) &&
              r.length === 2 &&
              r.every(Number.isFinite) &&
              r[1] > r[0],
          )),
    )
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
  const storageKey = `gradara-inspector:${modelId ?? result.snapshot?.modelId ?? 'workspace'}`;
  const [resolution, setResolution] = useState<{
    id: string;
    data?: SimulationResult;
    error?: string;
  } | null>(null);
  const full = resolution?.id === result.id ? resolution.data : undefined;
  const loading = resolution?.id !== result.id;
  const dataError = resolution?.id === result.id ? resolution.error : '';
  const [reload, setReload] = useState(0);
  const [config, setConfig] = useState<Config>(() => {
    let stored: unknown;
    try {
      stored = JSON.parse(localStorage.getItem(storageKey) ?? 'null');
    } catch {
      stored = null;
    }
    return validConfig(stored) ? stored : initial(result);
  });
  const [query, setQuery] = useState(''),
    [onlyLogged, setOnlyLogged] = useState(false);
  const [axes, setAxes] = useState<Axes>('x'),
    [mode, setMode] = useState<'pan' | 'zoom' | 'cursor'>('pan');
  const [maximized, setMaximized] = useState<number | null>(null);
  const [storageError, setStorageError] = useState('');
  const resultId = result.id;
  useEffect(() => {
    const abort = new AbortController();
    void api<SimulationResult>(`/results/${resultId}/data`, {
      signal: abort.signal,
    })
      .then((data) => setResolution({ id: resultId, data }))
      .catch((e) => {
        if (e.name !== 'AbortError')
          setResolution({ id: resultId, error: e.message });
      });
    return () => abort.abort();
  }, [resultId, reload]);
  const data = full ?? result;
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
  // New logged nets are discovered in the picker without replacing user assignments.
  const traces = useMemo(
    () =>
      data?.series.map((s, i) => ({
        ...s,
        color: traceColors[i % traceColors.length],
      })) ?? [],
    [data],
  );
  const duration = data?.duration ?? 1;
  const plotView = (plot: Plot): PlotView => {
    const x = clampTime(plot.view?.x ?? [0, duration], duration);
    return {
      x,
      y:
        plot.view?.y ??
        fitValues(
          data?.time ?? [],
          traces
            .filter((s) => plot.signals.includes(s.key))
            .map((s) => s.values),
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
  const assign = (index: number, key: string, checked: boolean) =>
    edit((c) => ({
      ...c,
      plots: c.plots.map((p, i) =>
        i === index
          ? {
              ...p,
              signals: checked
                ? [...new Set([...p.signals, key])]
                : p.signals.filter((k) => k !== key),
              view: p.view
                ? {
                    ...p.view,
                    y: fitValues(
                      data?.time ?? [],
                      traces
                        .filter((s) =>
                          (checked
                            ? [...p.signals, key]
                            : p.signals.filter((k) => k !== key)
                          ).includes(s.key),
                        )
                        .map((s) => s.values),
                      p.view.x,
                    ),
                  }
                : undefined,
            }
          : p,
      ),
    }));
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
          : fitValues(
              data?.time ?? [],
              traces
                .filter((s) => p.signals.includes(s.key))
                .map((s) => s.values),
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
  const shown = traces.filter(
    (s) =>
      (!onlyLogged || s.netId) &&
      `${s.name} ${s.unit}`.toLowerCase().includes(query.toLowerCase()),
  );
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
                  : 'Completed'}
        </span>
        {result && (
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
      {dataError && (
        <div role="alert" className="di-error">
          Full-resolution data could not load. Showing preview samples.{' '}
          {dataError}{' '}
          <button
            onClick={() => {
              setResolution(null);
              setReload((n) => n + 1);
            }}
          >
            Retry
          </button>
        </div>
      )}
      {storageError && <output>{storageError}</output>}
      {!data || !config ? (
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
            <aside className="di-signals" aria-label="Signal selection">
              <div className="di-pane-title">
                <strong>Signals</strong>
                <span>{traces.length}</span>
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
              {shown.map((s) => (
                <div
                  key={s.key}
                  className={`di-signal ${config.plots[active].signals.includes(s.key) ? 'is-assigned' : ''}`}
                >
                  <input
                    type="checkbox"
                    aria-label={`Plot ${s.name} in plot ${active + 1}`}
                    checked={config.plots[active].signals.includes(s.key)}
                    onChange={(e) => assign(active, s.key, e.target.checked)}
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
                      assign(
                        active,
                        s.key,
                        !config.plots[active].signals.includes(s.key),
                      )
                    }
                    title={`${s.name} · ${s.unit || 'unitless'}${s.netId ? ' · logged' : ''} — Drag onto a plot or click to toggle`}
                  >
                    <i style={{ background: s.color }} />
                    <span>{s.name}</span>
                    <small>{s.unit || '—'}</small>
                  </button>
                </div>
              ))}
              {!shown.length && (
                <p>
                  No matching signals. Mark signal nets for logging and run
                  again.
                </p>
              )}
              <p className="di-resolution">
                {loading
                  ? 'Loading full resolution…'
                  : `${data.time.length.toLocaleString()} samples${full?.id === result?.id ? ' · full resolution' : ' · preview'}`}
              </p>
            </aside>
            <div
              className="di-grid"
              style={{
                gridTemplateColumns: `repeat(${maximized === null ? cols : 1},minmax(0,1fr))`,
                gridTemplateRows: `repeat(${maximized === null ? rows : 1},minmax(180px,1fr))`,
              }}
            >
              {displayed.map((index) => {
                const p = config.plots[index],
                  selected = traces.filter((s) => p.signals.includes(s.key)),
                  v = plotView(p),
                  missing = p.signals.filter(
                    (k) => !traces.some((s) => s.key === k),
                  );
                return (
                  <div
                    role="presentation"
                    key={index}
                    className={`di-tile ${active === index ? 'is-active' : ''}`}
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
                      if (traces.some((s) => s.key === key)) {
                        assign(index, key, true);
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
                            time={data.time}
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
                          onClick={() => assign(index, s.key, false)}
                        >
                          <i style={{ background: s.color }} />
                          {s.name}
                          {s.unit ? ` (${s.unit})` : ''} ×
                        </button>
                      ))}
                      {missing.length > 0 && (
                        <span>
                          {missing.length} assigned signal(s) unavailable in
                          this run
                        </span>
                      )}
                    </div>
                  </div>
                );
              })}
            </div>
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
