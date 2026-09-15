export type Range = [number, number];
export type PlotView = { x: Range; y: Range };
export type Axes = 'xy' | 'x' | 'y';
export function clampTime(range: Range, duration: number): Range {
  const span = Math.min(
    duration,
    Math.max(duration * 1e-9, range[1] - range[0]),
  );
  const lo = Math.max(0, Math.min(duration - span, range[0]));
  return [lo, lo + span];
}
export function zoomRange(range: Range, factor: number, fraction = 0.5): Range {
  const anchor = range[0] + (range[1] - range[0]) * fraction;
  const span = Math.max(1e-12, (range[1] - range[0]) * factor);
  return [anchor - span * fraction, anchor + span * (1 - fraction)];
}
export function panView(
  view: PlotView,
  dx: number,
  dy: number,
  axes: Axes,
  duration: number,
): PlotView {
  const x = dx * (view.x[1] - view.x[0]),
    y = dy * (view.y[1] - view.y[0]);
  return {
    x:
      axes === 'y'
        ? view.x
        : clampTime([view.x[0] - x, view.x[1] - x], duration),
    y: axes === 'x' ? view.y : [view.y[0] + y, view.y[1] + y],
  };
}
export function sampleIndex(time: number[], target: number): number {
  let lo = 0,
    hi = time.length;
  while (lo < hi) {
    const mid = (lo + hi) >>> 1;
    if (time[mid] <= target) lo = mid + 1;
    else hi = mid;
  }
  return Math.max(0, lo - 1);
}
export function fitValues(time: number[], values: number[][], x: Range): Range {
  let lo = Infinity,
    hi = -Infinity;
  const start = Math.max(0, sampleIndex(time, x[0])),
    end = Math.min(time.length - 1, sampleIndex(time, x[1]) + 1);
  for (const series of values)
    for (let i = start; i <= end; i++) {
      const v = series[i];
      if (Number.isFinite(v)) {
        lo = Math.min(lo, v);
        hi = Math.max(hi, v);
      }
    }
  if (!Number.isFinite(lo)) return [-1, 1];
  const pad = (hi - lo || Math.max(Math.abs(lo) * 0.1, 1)) * 0.08;
  return [lo - pad, hi + pad];
}

export function axisTicks(range: Range, count = 5): number[] {
  const raw = (range[1] - range[0]) / count;
  const scale = 10 ** Math.floor(Math.log10(raw));
  const step = ([1, 2, 2.5, 5, 10].find((n) => n * scale >= raw) ?? 10) * scale;
  const start = Math.ceil(range[0] / step);
  const end = Math.floor(range[1] / step);
  return Array.from(
    { length: Math.max(0, Math.min(20, end - start + 1)) },
    (_, i) => Number(((start + i) * step).toPrecision(12)),
  );
}
