import type { SimulationResult } from './api';

export type ComparisonRun = { name: string; result: SimulationResult };

/** Linear interpolation of `values` sampled at `time`, read at `t` (held at the ends). */
function sample(time: number[], values: number[], t: number, from: number) {
  let j = from;
  while (j + 1 < time.length && time[j + 1] <= t) j++;
  if (j + 1 >= time.length || time[j + 1] === time[j] || t <= time[j])
    return { value: values[j], index: j };
  const w = (t - time[j]) / (time[j + 1] - time[j]);
  return { value: values[j] + w * (values[j + 1] - values[j]), index: j };
}

/**
 * One result holding every configuration's signals, for overlaid plots. Each
 * series is renamed `[Configuration] name` and keyed `<n>::<key>`; runs after
 * the first are resampled onto the first run's time grid.
 */
export function mergeRuns(runs: ComparisonRun[]): SimulationResult {
  const [base] = runs;
  const time = base.result.time;
  const series = runs.flatMap((run, n) =>
    run.result.series.map((s) => {
      let values = s.values;
      if (n > 0) {
        let at = 0;
        values = time.map((t) => {
          const r = sample(run.result.time, s.values, t, at);
          at = r.index;
          return r.value;
        });
      }
      return {
        ...s,
        key: `${n}::${s.key}`,
        name: `[${run.name}] ${s.name}`,
        values,
      };
    }),
  );
  return {
    ...base.result,
    id: `compare-${base.result.id}`,
    time,
    samples: time.length,
    series,
    elapsed: runs.reduce((t, r) => t + r.result.elapsed, 0),
    comparison: runs.map((r) => ({ name: r.name, runId: r.result.id })),
  };
}
