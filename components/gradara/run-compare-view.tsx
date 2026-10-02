'use client';
import { useEffect, useMemo, useState } from 'react';
import {
  ChevronLeft,
  ChevronRight,
  Crosshair,
  Hand,
  Scan,
} from 'lucide-react';
import type { SimulationResult } from '@/lib/gradara/api';
import { parameterDifferences } from '@/lib/gradara/compare';
import {
  clampTime,
  fitSeries,
  type PlotView,
  type Range,
} from '@/lib/gradara/plot-navigation';
import {
  compareMany,
  mergeRegions,
  signalDetail,
  toleranceValue,
  type SignalStatus,
  type Tolerance,
} from '@/lib/gradara/run-compare';
import InspectorPlot from './inspector-plot';
import PlotViewport from './plot-viewport';
import { PaneResizer, useFractions, useSize } from './resizable-columns';

/** A run on show in the inspector, with its colour and data. */
export type CompareEntry = {
  id: string;
  title: string;
  color: string;
  data: SimulationResult;
};
type Fields = { absolute: string; relative: string; time: string };

const noFields: Fields = { absolute: '', relative: '', time: '' };
const statusText: Record<SignalStatus, string> = {
  out: 'Differs',
  within: 'Within tolerance',
  'compared-only': 'Not in the baseline',
  'baseline-only': 'Not in this run',
};
const amount = (value: number, unit: string) =>
  `${Number(value.toPrecision(4))}${unit ? ` ${unit}` : ''}`;

function storedFields(key: string): Fields {
  try {
    const value = JSON.parse(localStorage.getItem(key) ?? 'null') as Fields | null;
    if (value && [value.absolute, value.relative, value.time].every((v) => typeof v === 'string'))
      return value;
  } catch {
    /* Tolerances are a convenience; start empty when storage is unavailable. */
  }
  return noFields;
}

/**
 * Compare the runs on show with one baseline, in each run's own colour: a
 * table of every signal with its largest difference per run, and for the
 * selected signal all runs overlaid above their differences from the baseline
 * and the tolerance band.
 */
export default function RunCompareView({
  entries,
  baselineId,
  onBaseline,
  modelKey,
}: {
  entries: CompareEntry[];
  baselineId: string;
  onBaseline: (id: string) => void;
  /** Where the tolerance is remembered. */
  modelKey: string;
}) {
  const storageKey = `gradara-compare:${modelKey}`;
  const [fields, setFields] = useState<Fields>(() => storedFields(storageKey));
  const [selectedKey, setSelectedKey] = useState('');
  const [onlyDifferent, setOnlyDifferent] = useState(false);
  const [mode, setMode] = useState<'pan' | 'zoom' | 'cursor'>('pan');
  const [x, setX] = useState<Range | null>(null);
  const [region, setRegion] = useState(-1);
  const signalPane = useSize('compare-signals', 380, 240, 700);
  const { attach: attachPlots, ...plotSplit } = useFractions('compare-plots', 2);

  useEffect(() => {
    try {
      localStorage.setItem(storageKey, JSON.stringify(fields));
    } catch {
      /* Not being able to remember tolerances is harmless. */
    }
  }, [fields, storageKey]);

  const tolerance: Tolerance = useMemo(
    () => ({
      absolute: toleranceValue(fields.absolute),
      relative: toleranceValue(fields.relative) / 100,
      time: toleranceValue(fields.time),
    }),
    [fields],
  );
  const exact = !tolerance.absolute && !tolerance.relative && !tolerance.time;
  const base = entries.find((e) => e.id === baselineId) ?? entries[0];
  const others = useMemo(
    () => entries.filter((e) => e.id !== base?.id),
    [entries, base],
  );
  const comparison = useMemo(
    () =>
      base
        ? compareMany(
            base.data,
            others.map((o) => ({ id: o.id, data: o.data })),
            tolerance,
          )
        : null,
    [base, others, tolerance],
  );
  const selected =
    comparison?.signals.find((s) => s.key === selectedKey) ?? comparison?.signals[0];
  const details = useMemo(
    () =>
      comparison && base && selected
        ? others.flatMap((o) => {
            const pair = comparison.pairs.find((p) => p.id === o.id);
            const detail = pair
              ? signalDetail(pair.comparison, base.data, o.data, selected.key, tolerance)
              : null;
            return pair && detail ? [{ entry: o, time: pair.comparison.time, detail }] : [];
          })
        : [],
    [comparison, base, others, selected, tolerance],
  );
  const changes = useMemo(
    () =>
      base?.data.snapshot
        ? others.map((o) => ({
            entry: o,
            list: o.data.snapshot
              ? parameterDifferences(base.data.snapshot!, o.data.snapshot)
              : [],
            same: !!o.data.snapshot && base.data.modelHash === o.data.modelHash,
          }))
        : [],
    [base, others],
  );
  if (!base || !comparison)
    return <div className="di-empty">Comparing needs two runs shown.</div>;

  const duration = Math.max(1e-9, ...entries.map((e) => e.data.duration));
  const view = clampTime(x ?? [0, duration], duration);
  const rows = comparison.signals.filter(
    (s) => !onlyDifferent || s.status !== 'within',
  );
  // With no tolerance every difference is outside it, so marking the stretches would shade the whole plot.
  const stretches = exact ? [] : mergeRegions(details.map((d) => d.detail.regions));
  const unit = selected?.unit ?? '';
  const trace = (e: CompareEntry, key: string) => {
    const s = e.data.series.find((v) => v.key === key);
    return s ? [{ ...s, key: `${e.id}::${key}`, name: e.title, color: e.color, time: e.data.time }] : [];
  };
  const overlay = selected ? entries.flatMap((e) => trace(e, selected.key)) : [];
  const difference = details.map(({ entry, time, detail }) => ({
    key: entry.id,
    name: entry.title,
    unit,
    blockId: '',
    values: detail.difference,
    color: entry.color,
    time,
  }));
  const bands = exact
    ? undefined
    : details.map(({ time, detail }) => ({ time, lower: detail.lower, upper: detail.upper }));
  const plotTime = overlay[0]?.time ?? base.data.time;
  const showRegion = (index: number) => {
    if (!stretches.length) return;
    const n = stretches.length;
    const at = ((index % n) + n) % n;
    const [start, end] = stretches[at];
    // Show the stretch with some of what surrounds it.
    const pad = Math.max((end - start) * 0.5, duration * 0.02);
    setRegion(at);
    setX(clampTime([start - pad, end + pad], duration));
  };
  const overlayView: PlotView = {
    x: view,
    y: fitSeries(overlay, view),
  };
  const differenceView: PlotView = {
    x: view,
    y: fitSeries(
      [
        ...difference,
        ...(bands ?? []).flatMap((b) => [
          { time: b.time, values: b.lower },
          { time: b.time, values: b.upper },
        ]),
      ],
      view,
    ),
  };

  return (
    <div className="dc">
      <div className="dc-bar">
        <label>
          Baseline
          <select
            aria-label="Baseline run"
            value={base.id}
            onChange={(e) => {
              onBaseline(e.target.value);
              setRegion(-1);
            }}
          >
            {entries.map((e) => (
              <option key={e.id} value={e.id}>
                {e.title}
              </option>
            ))}
          </select>
        </label>
        <span className="dc-runs">
          Compared
          {others.map((o) => (
            <span key={o.id} className="dc-run">
              <i style={{ background: o.color }} aria-hidden="true" />
              {o.title}
            </span>
          ))}
        </span>
        <span className="di-divider" />
        <span className="dc-tolerance">
          Tolerance
          {(
            [
              ['absolute', 'Absolute', unit],
              ['relative', 'Relative', '%'],
              ['time', 'Time', 's'],
            ] as const
          ).map(([field, label, u]) => (
            <label key={field} title={
              field === 'absolute'
                ? 'Allowed difference in the signal’s own unit'
                : field === 'relative'
                  ? 'Allowed difference as a share of the baseline value'
                  : 'How far an edge may shift in time before it counts as a difference'
            }>
              {label}
              <input
                inputMode="decimal"
                aria-label={`${label} tolerance${u ? ` in ${u}` : ''}`}
                placeholder="0"
                value={fields[field]}
                onChange={(e) => setFields((f) => ({ ...f, [field]: e.target.value }))}
              />
              {field !== 'absolute' && <small>{u}</small>}
            </label>
          ))}
        </span>
        <span className="di-divider" />
        {(['pan', 'zoom', 'cursor'] as const).map((m) => (
          <button key={m} type="button" aria-pressed={mode === m} onClick={() => setMode(m)}>
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
        <button type="button" onClick={() => { setX(null); setRegion(-1); }}>
          Fit
        </button>
      </div>
      <div className="dc-changes">
        <strong>
          {comparison.out
            ? `${comparison.out} of ${comparison.out + comparison.within} signals differ`
            : exact
              ? `All ${comparison.within} signals are identical`
              : `All ${comparison.within} signals are within tolerance`}
          {comparison.unmatched ? ` · ${comparison.unmatched} in some runs only` : ''}
        </strong>
        {changes.map(({ entry, list, same }) => (
          <span key={entry.id} title={list.join('\n')}>
            <i className="dc-dot" style={{ background: entry.color }} aria-hidden="true" />
            {list.length
              ? `${entry.title} changed from the baseline: ${list.slice(0, 3).join('; ')}${list.length > 3 ? `; and ${list.length - 3} more` : ''}`
              : same
                ? `${entry.title}: same model and parameters`
                : `${entry.title}: no top-level parameter changed; the models differ inside a subsystem or in their structure`}
          </span>
        ))}
        {comparison.truncated && (
          <span>Runs of different lengths are compared over their shared part.</span>
        )}
      </div>
      <div className="dc-body">
        <PaneResizer
          className="compare-resizer"
          style={{ left: `calc(min(${signalPane.size}px, 60%) - 3px)` }}
          label="Resize the compared signals list"
          {...signalPane.resizer()}
        />
        <aside
          className="dc-signals"
          aria-label="Compared signals"
          style={
            signalPane.stored
              ? { width: `min(${signalPane.size}px, 60%)` }
              : undefined
          }
        >
          <label className="di-logged-filter">
            <input
              type="checkbox"
              checked={onlyDifferent}
              onChange={(e) => setOnlyDifferent(e.target.checked)}
            />
            Differences only
          </label>
          <table>
            <colgroup>
              <col />
              {others.map((o) => (
                <col key={o.id} className="dc-col-difference" />
              ))}
            </colgroup>
            <thead>
              <tr>
                <th scope="col">Signal</th>
                {others.map((o) => (
                  <th key={o.id} scope="col" title={`Largest difference of ${o.title} from the baseline`}>
                    <i className="dc-dot" style={{ background: o.color }} aria-hidden="true" />
                    {o.title}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {rows.map((s) => (
                <tr
                  key={s.key}
                  className={`is-${s.status}${selected?.key === s.key ? ' is-selected' : ''}`}
                  onClick={() => {
                    setSelectedKey(s.key);
                    setRegion(-1);
                  }}
                >
                  <td className="dc-name">
                    <button type="button" aria-pressed={selected?.key === s.key} aria-label={`${s.name}: ${statusText[s.status]}`} title={`${s.name} · ${statusText[s.status]}`}>
                      <i aria-hidden="true" />
                      <span>{s.name}</span>
                      <small>
                        {s.status === 'within' && exact ? 'Identical' : statusText[s.status]}
                      </small>
                    </button>
                  </td>
                  {others.map((o) => {
                    const r = s.byRun[o.id];
                    return (
                      <td key={o.id} className={r ? `is-${r.status}` : undefined}>
                        {r && (r.status === 'out' || r.status === 'within')
                          ? amount(r.maxDifference, r.unit)
                          : '—'}
                      </td>
                    );
                  })}
                </tr>
              ))}
            </tbody>
          </table>
          {!rows.length && <p>No signal differs.</p>}
        </aside>
        <div
          className="dc-plots"
          ref={attachPlots}
          style={{
            gridTemplateRows: plotSplit.fractions
              .map((f) => `minmax(160px,${f * 100}fr)`)
              .join(' 1px '),
            gap: 0,
          }}
        >
          {!selected ? (
            <div className="di-empty">These runs recorded no signals.</div>
          ) : !details.length ? (
            <div className="di-empty">
              {selected.name} was not recorded in both the baseline and another
              run, so there is nothing to compare it with.
            </div>
          ) : (
            <>
              <div className="di-tile" style={{ gridRow: 1 }}>
                <header>
                  <strong>{selected.name}</strong>
                  <span>{unit || 'unitless'}</span>
                </header>
                <div className="di-chart">
                  <PlotViewport>
                    {({ width, height }) => (
                      <InspectorPlot
                        width={width}
                        height={height}
                        time={plotTime}
                        traces={overlay}
                        view={overlayView}
                        axes="x"
                        mode={mode}
                        duration={duration}
                        onActivate={() => {}}
                        onView={(next) => setX(next.x)}
                        onFit={() => setX(null)}
                      />
                    )}
                  </PlotViewport>
                </div>
                <div className="di-legend dc-legend">
                  {entries.map((e) => (
                    <span key={e.id}>
                      <i style={{ background: e.color }} /> {e.title}
                      {e.id === base.id ? ' (baseline)' : ''}
                    </span>
                  ))}
                </div>
              </div>
              <PaneResizer
                axis="y"
                className="in-grid"
                style={{ gridRow: 2 }}
                label="Resize the overlaid and difference plots"
                {...plotSplit.divider(0, 'y')}
              />
              <div className="di-tile" style={{ gridRow: 3 }}>
                <header>
                  <strong>Difference</strong>
                  <span>run − baseline · {unit || 'unitless'}</span>
                  {stretches.length > 0 && (
                    <>
                      <small>
                        {region >= 0 ? `${region + 1} of ` : ''}
                        {stretches.length} {stretches.length === 1 ? 'stretch' : 'stretches'} outside
                        tolerance
                      </small>
                      <button type="button" aria-label="Previous stretch outside tolerance" onClick={() => showRegion(region < 0 ? -1 : region - 1)}>
                        <ChevronLeft size={13} aria-hidden="true" />
                      </button>
                      <button type="button" aria-label="Next stretch outside tolerance" onClick={() => showRegion(region + 1)}>
                        <ChevronRight size={13} aria-hidden="true" />
                      </button>
                    </>
                  )}
                </header>
                <div className="di-chart">
                  <PlotViewport>
                    {({ width, height }) => (
                      <InspectorPlot
                        width={width}
                        height={height}
                        time={details[0].time}
                        traces={difference}
                        view={differenceView}
                        axes="x"
                        mode={mode}
                        duration={duration}
                        band={bands}
                        regions={stretches}
                        onActivate={() => {}}
                        onView={(next) => setX(next.x)}
                        onFit={() => setX(null)}
                      />
                    )}
                  </PlotViewport>
                </div>
                <div className="di-legend dc-legend">
                  {details.map(({ entry, detail }) => (
                    <span key={entry.id}>
                      <i style={{ background: entry.color }} /> {entry.title}: largest{' '}
                      {amount(detail.maxDifference, unit)}
                      {detail.maxDifference > 0 ? ` at ${Number(detail.maxAt.toPrecision(4))} s` : ''}
                    </span>
                  ))}
                  {!exact && <span><i className="dc-band" /> Tolerance</span>}
                  {stretches.length > 0 && <span><i className="dc-outside" /> Outside tolerance</span>}
                </div>
              </div>
            </>
          )}
        </div>
      </div>
    </div>
  );
}
