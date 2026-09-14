'use client';
import { memo, useMemo, useState } from 'react';
import {
  LineChart,
  Line,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
} from 'recharts';
import {
  Activity,
  Download,
  LoaderCircle,
  AlertCircle,
  ChevronDown,
  ChevronUp,
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import { plotOptions, plotStart, formatPlotTime } from '@/lib/gradara/results';
import type { SimulationResult } from '@/lib/gradara/api';
import PlotViewport from './plot-viewport';
function Results({
  result,
  running,
  error,
  stale,
  empty = false,
}: {
  result: SimulationResult | null;
  running: boolean;
  error: string;
  stale: boolean;
  empty?: boolean;
}) {
  const [channel, setChannel] = useState('');
  const [compare, setCompare] = useState('');
  const options = useMemo(() => plotOptions(result), [result]);
  const active = options.find((p) => p.id === channel) ?? options[0];
  const [collapsed, setCollapsed] = useState(false);
  const isCollapsed = (collapsed || empty) && !error;
  const [timeRange, setTimeRange] = useState('full');
  const [fitAmplitude, setFitAmplitude] = useState(false);
  const [hidden, setHidden] = useState<string[]>([]);
  const series = useMemo(() => {
    const chosen = active?.series ?? [];
    const extra = result?.series.find(
      (s) => s.key === compare && !chosen.some((c) => c.key === s.key),
    );
    return extra ? [...chosen, extra] : chosen;
  }, [result, active, compare]);
  const timeStart = plotStart(result?.duration ?? 1, timeRange);
  const points = useMemo(
    () =>
      result?.time
        .map((t, i) => {
          const row: Record<string, number> = { time: t };
          series.forEach((s, n) => (row[`v${n}`] = s.values[i]));
          return row;
        })
        .filter((row) => row.time >= timeStart) ?? [],
    [result, series, timeStart],
  );
  const axis = useMemo(() => {
    const values = points
      .flatMap((row) =>
        series.map((s, i) => (hidden.includes(s.key) ? NaN : row[`v${i}`])),
      )
      .filter(Number.isFinite);
    let lo = fitAmplitude && values.length ? Infinity : 0,
      hi = fitAmplitude && values.length ? -Infinity : 0;
    for (const value of values) {
      lo = Math.min(lo, value);
      hi = Math.max(hi, value);
    }
    const span = hi - lo || 1;
    lo -= span * 0.04;
    hi += span * 0.06;
    const magnitude = 10 ** Math.floor(Math.log10(span / 4));
    const step =
      ([1, 2, 2.5, 5, 10].find((n) => n * magnitude >= span / 4) ?? 10) *
      magnitude;
    const ticks: number[] = [];
    for (let t = Math.ceil(lo / step) * step; t <= hi; t += step)
      ticks.push(Number(t.toPrecision(10)));
    return { domain: [lo, hi] as [number, number], ticks };
  }, [points, series, hidden, fitAmplitude]);
  const colors = ['#237db3', '#c77e22', '#379b87', '#945f9f'];
  const last = series[0]?.values.at(-1);
  return (
    <section
      className={`results-panel ${isCollapsed ? 'is-collapsed' : ''}`}
      aria-label="Simulation results"
    >
      <div className="results-heading">
        <div>
          <Activity size={16} />
          <strong>Simulation results</strong>
          {running ? (
            <span className="result-status">
              <LoaderCircle className="spin" size={12} />
              Simulating…
            </span>
          ) : error ? (
            <span className="result-status stale">
              <AlertCircle size={12} />
              Run failed
            </span>
          ) : result ? (
            <span className={`result-status ${stale ? 'stale' : ''}`}>
              <span />
              {stale ? 'Model changed · Run again' : 'Completed'}
              <span className="run-time">{result.elapsed}s</span>
            </span>
          ) : (
            <span className="subtle">No run yet</span>
          )}
        </div>
        <div>
          {result && (
            <a
              href={`/api/results/${result.id}/csv`}
              download
              aria-label="Download results as CSV"
              className="icon-link"
            >
              <Download size={14} />
            </a>
          )}
          <Button
            size="icon-sm"
            variant="ghost"
            onClick={() => setCollapsed((v) => !v)}
            disabled={empty}
            aria-label={isCollapsed ? 'Expand results' : 'Collapse results'}
          >
            {isCollapsed ? <ChevronUp /> : <ChevronDown />}
          </Button>
        </div>
      </div>
      {!isCollapsed &&
        (error ? (
          <div className="simulation-error" role="alert">
            <AlertCircle size={18} />
            <div>
              <strong>Simulation could not complete</strong>
              <pre>{error}</pre>
            </div>
          </div>
        ) : result ? (
          <>
            <div className="plot-toolbar">
              <select
                className="plot-signal"
                aria-label="Plot signal or group"
                value={active?.id ?? ''}
                onChange={(e) => {
                  setChannel(e.target.value);
                  setCompare('');
                  setHidden([]);
                  setTimeRange('full');
                  setFitAmplitude(false);
                }}
              >
                {options.some((p) => p.group) && (
                  <optgroup label="Saved plots">
                    {options
                      .filter((p) => p.group)
                      .map((p) => (
                        <option key={p.id} value={p.id}>
                          {p.label}
                        </option>
                      ))}
                  </optgroup>
                )}
                <optgroup label="Signals">
                  {options
                    .filter((p) => !p.group)
                    .map((p) => (
                      <option key={p.id} value={p.id}>
                        {p.label}
                      </option>
                    ))}
                </optgroup>
              </select>
              <select
                className="plot-signal plot-compare"
                aria-label="Compare with signal"
                value={compare}
                onChange={(e) => {
                  setCompare(e.target.value);
                  setHidden([]);
                }}
              >
                <option value="">Compare with…</option>
                {result.series
                  .filter((s) => !active?.series.some((a) => a.key === s.key))
                  .map((s) => (
                    <option key={s.key} value={s.key}>
                      {s.name}
                      {s.unit ? ` (${s.unit})` : ''}
                    </option>
                  ))}
              </select>
              <select
                className="plot-range"
                aria-label="Plot time range"
                value={timeRange}
                onChange={(e) => {
                  setTimeRange(e.target.value);
                  setFitAmplitude(e.target.value !== 'full');
                }}
              >
                <option value="full">Full run</option>
                <option value="last10">Last 10%</option>
                <option value="last50">Last 50 ms</option>
                <option value="last1">Last 1 ms</option>
              </select>
              <button
                className={`plot-fit ${fitAmplitude ? 'is-active' : ''}`}
                aria-label="Fit signal amplitude"
                aria-pressed={fitAmplitude}
                onClick={() => setFitAmplitude((v) => !v)}
                title="Fit the vertical axis to the visible signals"
              >
                Fit Y
              </button>
              <div className="plot-metric">
                {last?.toFixed(2)}
                <span>{series[0]?.unit}</span>
              </div>
            </div>
            <div className="plot-body">
              <PlotViewport>
                {({ width, height }) => (
                  <LineChart
                    width={width}
                    height={height}
                    data={points}
                    margin={{ top: 8, right: 28, bottom: 2, left: 0 }}
                  >
                    <CartesianGrid stroke="#eef0f7" vertical={false} />
                    <XAxis
                      dataKey="time"
                      type="number"
                      domain={[timeStart, result.duration]}
                      tickCount={6}
                      tickFormatter={(v) =>
                        formatPlotTime(
                          Number(v),
                          result.duration,
                          result.duration - timeStart,
                        )
                      }
                      tick={{ fontSize: 10, fill: '#9da4b4' }}
                      axisLine={false}
                      tickLine={false}
                      minTickGap={40}
                    />
                    <YAxis
                      domain={axis.domain}
                      ticks={axis.ticks}
                      allowDataOverflow
                      width={47}
                      tick={{ fontSize: 10, fill: '#9da4b4' }}
                      axisLine={false}
                      tickLine={false}
                      tickCount={4}
                      tickFormatter={(v) =>
                        Number(v).toLocaleString(undefined, {
                          maximumFractionDigits: 3,
                        })
                      }
                    />
                    <Tooltip
                      labelFormatter={(v) =>
                        `Time ${formatPlotTime(Number(v), result.duration, (result.duration - timeStart) / 100)}`
                      }
                      formatter={(v, name) => [Number(v).toFixed(3), name]}
                      contentStyle={{
                        fontSize: 12,
                        border: '1px solid #e5e7f0',
                        borderRadius: 7,
                        boxShadow: '0 4px 15px #27325710',
                      }}
                    />
                    {series.map((s, i) => (
                      <Line
                        key={s.key}
                        type="linear"
                        dataKey={`v${i}`}
                        name={s.name}
                        stroke={colors[i % colors.length]}
                        strokeWidth={2}
                        dot={false}
                        isAnimationActive={false}
                        hide={hidden.includes(s.key)}
                      />
                    ))}
                  </LineChart>
                )}
              </PlotViewport>
            </div>
            <div className="plot-legend">
              {series.map((s, i) => (
                <button
                  key={s.key}
                  onClick={() =>
                    setHidden((h) =>
                      h.includes(s.key)
                        ? h.filter((k) => k !== s.key)
                        : [...h, s.key],
                    )
                  }
                  style={{ opacity: hidden.includes(s.key) ? 0.4 : 1 }}
                >
                  <span style={{ background: colors[i % colors.length] }} />
                  {s.name}
                  {s.unit ? ` (${s.unit})` : ''}
                </button>
              ))}
              <span className="plot-samples">
                {result.samples.toLocaleString()} samples · {result.engine}
              </span>
            </div>
          </>
        ) : (
          <div className="results-empty">
            <span className="empty-chart">
              {running ? (
                <LoaderCircle size={28} className="spin" />
              ) : (
                <Activity size={30} />
              )}
            </span>
            <div>
              <strong>
                {running
                  ? 'Solving your connected model'
                  : 'Your system, in motion'}
              </strong>
              <p>
                {running
                  ? 'The canvas stays yours while the engine runs.'
                  : 'Run the model to inspect and compare its signals over time.'}
              </p>
            </div>
          </div>
        ))}
    </section>
  );
}
export default memo(Results);
