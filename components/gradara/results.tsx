'use client';
import { memo, useMemo, useState } from 'react';
import {
  LineChart,
  Line,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ReferenceLine,
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
import { Tabs, TabsList, TabsTrigger } from '@/components/ui/tabs';
import type { SimulationResult } from '@/lib/gradara/api';
import PlotViewport from './plot-viewport';
function Results({
  result,
  running,
  error,
  stale,
}: {
  result: SimulationResult | null;
  running: boolean;
  error: string;
  stale: boolean;
}) {
  const [channel, setChannel] = useState('speed');
  const [collapsed, setCollapsed] = useState(false);
  const [timeRange, setTimeRange] = useState('full');
  const [hidden, setHidden] = useState<string[]>([]);
  const series = useMemo(() => {
    if (!result) return [];
    const available = result.series;
    const group = result.snapshot?.plots?.find((p) => p.id === channel);
    let chosen = group
      ? group.series.flatMap((key, i) =>
          available
            .filter((s) => s.key === key)
            .map((s) => ({ ...s, name: group.labels?.[i] ?? s.name })),
        )
      : channel === 'speed'
        ? ['load.w', 'reference.y'].flatMap((key) =>
            available.filter((s) => s.key === key),
          )
        : channel === 'current'
          ? available.filter((s) => s.key === 'motor.i')
          : channel === 'voltage'
            ? available.filter((s) => s.key === 'controller.y')
            : available.filter((s) => s.key === channel);
    if (!chosen.length) chosen = available.slice(0, 2);
    return chosen;
  }, [result, channel]);
  const timeStart =
    timeRange === 'last50' ? Math.max(0, (result?.duration ?? 0) - 0.05) : 0;
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
    let lo = Math.min(0, ...values),
      hi = Math.max(0, ...values);
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
  }, [points, series, hidden]);
  const colors = ['#237db3', '#c77e22', '#379b87', '#945f9f'];
  const last = series[0]?.values.at(-1);
  return (
    <section
      className={`results-panel ${collapsed ? 'is-collapsed' : ''}`}
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
            aria-label={collapsed ? 'Expand results' : 'Collapse results'}
          >
            {collapsed ? <ChevronUp /> : <ChevronDown />}
          </Button>
        </div>
      </div>
      {!collapsed &&
        (error ? (
          <div className="simulation-error" role="alert">
            <AlertCircle size={18} />
            <div>
              <strong>The model needs a change</strong>
              <pre>{error}</pre>
            </div>
          </div>
        ) : result ? (
          <>
            <div className="plot-toolbar">
              <Tabs
                value={channel}
                onValueChange={(v) => {
                  setChannel(String(v));
                  setTimeRange(v === 'phases' ? 'last50' : 'full');
                  setHidden([]);
                }}
              >
                <TabsList variant="line">
                  {(result.snapshot?.plots?.length
                    ? result.snapshot.plots
                    : [
                        { id: 'speed', label: 'Speed' },
                        { id: 'current', label: 'Current' },
                        { id: 'voltage', label: 'Drive voltage' },
                        ...result.series
                          .filter(
                            (s) =>
                              ![
                                'load',
                                'motor',
                                'reference',
                                'controller',
                                'sensor',
                              ].includes(s.blockId),
                          )
                          .slice(0, 3)
                          .map((s) => ({ id: s.key, label: s.name })),
                      ]
                  ).map((group) => (
                    <TabsTrigger key={group.id} value={group.id}>
                      {group.label}
                    </TabsTrigger>
                  ))}
                </TabsList>
              </Tabs>
              <select
                className="plot-range"
                aria-label="Plot time range"
                value={timeRange}
                onChange={(e) => setTimeRange(e.target.value)}
              >
                <option value="full">Full run</option>
                <option value="last50">Last 50 ms</option>
              </select>
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
                        `${Number(v).toFixed(timeRange === 'last50' ? 2 : 1)}s`
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
                      labelFormatter={(v) => `Time ${Number(v).toFixed(3)} s`}
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
                        strokeWidth={s.key === 'reference.y' ? 1.5 : 2}
                        strokeDasharray={
                          s.key === 'reference.y' || s.key === 'iqReference.y'
                            ? '5 4'
                            : undefined
                        }
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
                  : 'Run the model to explore speed, current, and controller output.'}
              </p>
            </div>
          </div>
        ))}
    </section>
  );
}
export default memo(Results);
