'use client';
import { useEffect, useMemo, useRef, useState } from 'react';
import {
  ArrowLeftRight,
  ChevronLeft,
  ChevronRight,
  Crosshair,
  Hand,
  Scan,
} from 'lucide-react';
import { api, type SimulationResult } from '@/lib/gradara/api';
import { parameterDifferences } from '@/lib/gradara/compare';
import {
  clampTime,
  fitValues,
  type PlotView,
  type Range,
} from '@/lib/gradara/plot-navigation';
import {
  compareRuns,
  signalDetail,
  toleranceValue,
  type SignalStatus,
  type Tolerance,
} from '@/lib/gradara/run-compare';
import InspectorPlot from './inspector-plot';
import PlotViewport from './plot-viewport';

/** One stored run of the model, as GET /api/results lists it. */
type StoredRun = {
  id: string;
  finished: number;
  duration: number;
  samples: number;
  signals: number;
  projectRevision: number;
  modelHash: string;
  engine: string;
};
type Loaded = { data?: SimulationResult; error?: string };
type Fields = { absolute: string; relative: string; time: string };

const colors = { baseline: '#6d7986', compared: '#237db3', difference: '#be6622' };
const noFields: Fields = { absolute: '', relative: '', time: '' };
const statusText: Record<SignalStatus, string> = {
  out: 'Differs',
  within: 'Within tolerance',
  'compared-only': 'Only in the compared run',
  'baseline-only': 'Only in the baseline',
};

function runLabel(run: StoredRun, newest: string) {
  const when = new Date(run.finished).toLocaleString(undefined, {
    month: 'short',
    day: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
    second: '2-digit',
  });
  return `${when}${run.id === newest ? ' · latest' : ''} · ${run.duration} s`;
}
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
 * Compare two stored runs of the open model: a table of every signal with its
 * largest difference, and for the selected signal both runs overlaid above
 * their difference and the tolerance band.
 */
export default function RunCompareView({
  modelId,
  latestId,
}: {
  modelId: string;
  /** The run the inspector shows; a new one refreshes the list. */
  latestId: string;
}) {
  const [runs, setRuns] = useState<StoredRun[] | null>(null);
  const [listError, setListError] = useState('');
  const [chosen, setChosen] = useState({ baseline: '', compared: '' });
  const [loaded, setLoaded] = useState<Record<string, Loaded>>({});
  const storageKey = `gradara-compare:${modelId}`;
  const [fields, setFields] = useState<Fields>(() => storedFields(storageKey));
  const [selectedKey, setSelectedKey] = useState('');
  const [onlyDifferent, setOnlyDifferent] = useState(false);
  const [mode, setMode] = useState<'pan' | 'zoom' | 'cursor'>('pan');
  const [x, setX] = useState<Range | null>(null);
  const [region, setRegion] = useState(-1);

  useEffect(() => {
    const abort = new AbortController();
    void api<{ runs: StoredRun[] }>(
      `/results?model=${encodeURIComponent(modelId)}`,
      { signal: abort.signal },
    )
      .then(({ runs: list }) => {
        setRuns(list);
        setListError('');
        // Default to the newest run against the one before it; keep a baseline the user chose.
        setChosen((c) => {
          const compared = list[0]?.id ?? '';
          const kept = list.some((r) => r.id === c.baseline && r.id !== compared);
          return {
            compared,
            baseline: kept ? c.baseline : (list.find((r) => r.id !== compared)?.id ?? ''),
          };
        });
      })
      .catch((e) => {
        if (e.name !== 'AbortError') setListError(e.message);
      });
    return () => abort.abort();
  }, [modelId, latestId]);

  // Each run's full data is fetched once and kept while the view is open.
  const requested = useRef(new Set<string>());
  useEffect(() => {
    for (const id of [chosen.baseline, chosen.compared]) {
      if (!id || requested.current.has(id)) continue;
      requested.current.add(id);
      void api<SimulationResult>(`/results/${id}/data`)
        .then((data) => setLoaded((all) => ({ ...all, [id]: { data } })))
        .catch((e) => setLoaded((all) => ({ ...all, [id]: { error: e.message } })));
    }
  }, [chosen.baseline, chosen.compared]);

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
  const baseline = loaded[chosen.baseline]?.data,
    compared = loaded[chosen.compared]?.data;
  const comparison = useMemo(
    () => (baseline && compared ? compareRuns(baseline, compared, tolerance) : null),
    [baseline, compared, tolerance],
  );
  const selected =
    comparison?.signals.find((s) => s.key === selectedKey) ?? comparison?.signals[0];
  const detail = useMemo(
    () =>
      comparison && baseline && compared && selected
        ? signalDetail(comparison, baseline, compared, selected.key, tolerance)
        : null,
    [comparison, baseline, compared, selected, tolerance],
  );
  const changes = useMemo(
    () =>
      baseline?.snapshot && compared?.snapshot
        ? parameterDifferences(baseline.snapshot, compared.snapshot)
        : [],
    [baseline, compared],
  );

  if (listError)
    return (
      <div role="alert" className="di-error">
        The stored runs could not be listed. {listError}
      </div>
    );
  if (!runs) return <div className="di-empty">Loading runs…</div>;
  if (runs.length < 2)
    return (
      <div className="di-empty">
        Comparing needs two runs of this model. Change a parameter and run
        again, then compare the two runs here.
      </div>
    );

  const newest = runs[0].id;
  const duration = comparison?.duration ?? 1;
  const view = clampTime(x ?? [0, duration], duration);
  const loadError = loaded[chosen.baseline]?.error || loaded[chosen.compared]?.error;
  const rows = (comparison?.signals ?? []).filter(
    (s) => !onlyDifferent || s.status !== 'within',
  );
  const choose = (side: 'baseline' | 'compared', id: string) => {
    setChosen((c) =>
      // Picking the run that is on the other side swaps the two.
      id === (side === 'baseline' ? c.compared : c.baseline)
        ? { baseline: c.compared, compared: c.baseline }
        : { ...c, [side]: id },
    );
    setRegion(-1);
  };
  const showRegion = (index: number) => {
    const all = exact ? [] : (detail?.regions ?? []);
    if (!all.length) return;
    const n = all.length;
    const at = ((index % n) + n) % n;
    const [start, end] = all[at];
    // Show the stretch with some of what surrounds it.
    const pad = Math.max((end - start) * 0.5, duration * 0.02);
    setRegion(at);
    setX(clampTime([start - pad, end + pad], duration));
  };
  const overlay = detail
    ? [
        { key: 'baseline', name: 'Baseline', unit: selected!.unit, blockId: '', values: detail.baseline, color: colors.baseline },
        { key: 'compared', name: 'Compared', unit: selected!.unit, blockId: '', values: detail.compared, color: colors.compared },
      ]
    : [];
  const difference = detail
    ? [{ key: 'difference', name: 'Difference', unit: selected!.unit, blockId: '', values: detail.difference, color: colors.difference }]
    : [];
  const time = comparison?.time ?? [];
  // With no tolerance every difference is outside it, so marking the stretches would shade the whole plot.
  const stretches = exact ? [] : (detail?.regions ?? []);
  const plot = (traces: typeof overlay, extra: number[][] = []): PlotView => ({
    x: view,
    y: fitValues(time, [...traces.map((t) => t.values), ...extra], view),
  });

  return (
    <div className="dc">
      <div className="dc-bar">
        <label>
          Baseline
          <select
            aria-label="Baseline run"
            value={chosen.baseline}
            onChange={(e) => choose('baseline', e.target.value)}
          >
            {runs.map((r) => (
              <option key={r.id} value={r.id}>
                {runLabel(r, newest)}
              </option>
            ))}
          </select>
        </label>
        <button
          type="button"
          aria-label="Swap baseline and compared run"
          title="Swap the two runs"
          onClick={() => choose('baseline', chosen.compared)}
        >
          <ArrowLeftRight size={13} aria-hidden="true" />
        </button>
        <label>
          Compare
          <select
            aria-label="Compared run"
            value={chosen.compared}
            onChange={(e) => choose('compared', e.target.value)}
          >
            {runs.map((r) => (
              <option key={r.id} value={r.id}>
                {runLabel(r, newest)}
              </option>
            ))}
          </select>
        </label>
        <span className="di-divider" />
        <span className="dc-tolerance">
          Tolerance
          {(
            [
              ['absolute', 'Absolute', selected?.unit ?? ''],
              ['relative', 'Relative', '%'],
              ['time', 'Time', 's'],
            ] as const
          ).map(([field, label, unit]) => (
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
                aria-label={`${label} tolerance${unit ? ` in ${unit}` : ''}`}
                placeholder="0"
                value={fields[field]}
                onChange={(e) => setFields((f) => ({ ...f, [field]: e.target.value }))}
              />
              {field !== 'absolute' && <small>{unit}</small>}
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
        {!comparison ? (
          loadError ? (
            <span role="alert">A run’s data could not be loaded. {loadError}</span>
          ) : (
            'Loading both runs…'
          )
        ) : (
          <>
            <strong>
              {comparison.out
                ? `${comparison.out} of ${comparison.out + comparison.within} signals differ`
                : exact
                  ? `All ${comparison.within} signals are identical`
                  : `All ${comparison.within} signals are within tolerance`}
              {comparison.unmatched ? ` · ${comparison.unmatched} in one run only` : ''}
            </strong>
            <span title={changes.join('\n')}>
              {changes.length
                ? `Changed from the baseline: ${changes.slice(0, 3).join('; ')}${changes.length > 3 ? `; and ${changes.length - 3} more` : ''}`
                : !baseline!.snapshot || !compared!.snapshot
                  ? ''
                  : baseline!.modelHash === compared!.modelHash
                  ? 'Same model and parameters in both runs'
                  : 'No top-level parameter changed; the models differ inside a subsystem or in their structure'}
            </span>
            {comparison.truncated && (
              <span>
                The runs have different stop times; the first {comparison.duration} s are compared.
              </span>
            )}
          </>
        )}
      </div>
      {comparison && (
        <div className="dc-body">
          <aside className="dc-signals" aria-label="Compared signals">
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
                <col className="dc-col-difference" />
                <col className="dc-col-at" />
              </colgroup>
              <thead>
                <tr>
                  <th scope="col">Signal</th>
                  <th scope="col">Max difference</th>
                  <th scope="col">At</th>
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
                    <td>
                      {s.status === 'out' || s.status === 'within'
                        ? amount(s.maxDifference, s.unit)
                        : '—'}
                    </td>
                    <td>
                      {(s.status === 'out' || s.status === 'within') && s.maxDifference > 0
                        ? `${Number(s.maxAt.toPrecision(4))} s`
                        : '—'}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
            {!rows.length && <p>No signal differs.</p>}
          </aside>
          <div className="dc-plots">
            {!selected ? (
              <div className="di-empty">These runs recorded no signals.</div>
            ) : !detail ? (
              <div className="di-empty">
                {selected.name} was recorded{' '}
                {selected.status === 'baseline-only'
                  ? 'only in the baseline run'
                  : 'only in the compared run'}
                , so there is nothing to compare it with.
              </div>
            ) : (
              <>
                <div className="di-tile">
                  <header>
                    <strong>{selected.name}</strong>
                    <span>{selected.unit || 'unitless'}</span>
                  </header>
                  <div className="di-chart">
                    <PlotViewport>
                      {({ width, height }) => (
                        <InspectorPlot
                          width={width}
                          height={height}
                          time={time}
                          traces={overlay}
                          view={plot(overlay)}
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
                    <span><i style={{ background: colors.baseline }} /> Baseline</span>
                    <span><i style={{ background: colors.compared }} /> Compared</span>
                  </div>
                </div>
                <div className="di-tile">
                  <header>
                    <strong>Difference</strong>
                    <span>compared − baseline · {selected.unit || 'unitless'}</span>
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
                          time={time}
                          traces={difference}
                          view={plot(difference, exact ? [] : [detail.lower, detail.upper])}
                          axes="x"
                          mode={mode}
                          duration={duration}
                          band={exact ? undefined : detail}
                          regions={stretches}
                          onActivate={() => {}}
                          onView={(next) => setX(next.x)}
                          onFit={() => setX(null)}
                        />
                      )}
                    </PlotViewport>
                  </div>
                  <div className="di-legend dc-legend">
                    <span><i style={{ background: colors.difference }} /> Difference</span>
                    {!exact && <span><i className="dc-band" /> Tolerance</span>}
                    {stretches.length > 0 && <span><i className="dc-outside" /> Outside tolerance</span>}
                    <span>
                      Largest {amount(detail.maxDifference, selected.unit)}
                      {detail.maxDifference > 0 ? ` at ${Number(detail.maxAt.toPrecision(4))} s` : ''}
                    </span>
                  </div>
                </div>
              </>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
