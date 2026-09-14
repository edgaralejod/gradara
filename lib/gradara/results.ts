import type { SimulationResult } from './api';

export function plotOptions(result: SimulationResult | null) {
  if (!result) return [];
  const available = new Map(result.series.map((s) => [s.key, s]));
  const groups = (result.snapshot?.plots ?? []).flatMap((group) => {
    const series = group.series.flatMap((key, i) => {
      const signal = available.get(key);
      return signal
        ? [{ ...signal, name: group.labels?.[i] ?? signal.name }]
        : [];
    });
    return series.length
      ? [{ id: `group:${group.id}`, label: group.label, group: true, series }]
      : [];
  });
  return [
    ...groups,
    ...result.series.map((signal) => ({
      id: `signal:${signal.key}`,
      label: signal.unit ? `${signal.name} (${signal.unit})` : signal.name,
      group: false,
      series: [signal],
    })),
  ];
}

export function plotStart(duration: number, range: string) {
  if (range === 'last10') return duration * 0.9;
  if (range === 'last50') return Math.max(0, duration - 0.05);
  if (range === 'last1') return Math.max(0, duration - 0.001);
  return 0;
}
export function formatPlotTime(
  seconds: number,
  duration: number,
  span = duration,
) {
  const [scale, unit] =
    duration < 0.001 ? [1e6, 'µs'] : duration < 1 ? [1e3, 'ms'] : [1, 's'];
  const digits = Math.max(
    0,
    Math.min(
      6,
      Math.ceil(-Math.log10(Math.max((span * Number(scale)) / 6, 1e-9))) + 1,
    ),
  );
  return `${Number((seconds * Number(scale)).toFixed(digits))} ${unit}`;
}
