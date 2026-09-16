'use client';
import { useEffect, useLayoutEffect, useRef, useState, useId } from 'react';
import type { SimulationResult } from '@/lib/gradara/api';
import {
  axisTicks,
  clampTime,
  panView,
  sampleIndex,
  zoomRange,
  type Axes,
  type PlotView,
} from '@/lib/gradara/plot-navigation';
import { formatPlotTime } from '@/lib/gradara/results';
export const traceColors = [
  '#237db3',
  '#be6622',
  '#258676',
  '#9656a3',
  '#b64c64',
  '#74852b',
  '#5266ad',
  '#785945',
];
type Trace = SimulationResult['series'][number] & { color: string };
const left = 62,
  right = 16,
  top = 14,
  bottom = 30;
function number(v: number) {
  return Number(v.toPrecision(5)).toString();
}
export default function InspectorPlot({
  width,
  height,
  time,
  traces,
  view,
  axes,
  mode,
  duration,
  onView,
  onActivate,
  onFit,
}: {
  width: number;
  height: number;
  time: number[];
  traces: Trace[];
  view: PlotView;
  axes: Axes;
  mode: 'pan' | 'zoom' | 'cursor';
  duration: number;
  onView: (view: PlotView) => void;
  onActivate: () => void;
  onFit: () => void;
}) {
  const canvas = useRef<HTMLCanvasElement>(null);
  const frame = useRef<number | null>(null);
  const id = useId();
  const drag = useRef<{
    pointer: number;
    x: number;
    y: number;
    view: PlotView;
    mode: 'pan' | 'zoom' | 'cursor';
  } | null>(null);
  const [box, setBox] = useState<{
    x: number;
    y: number;
    x2: number;
    y2: number;
  } | null>(null);
  const [cursorTime, setCursorTime] = useState<number | null>(null);
  const cursor =
    cursorTime === null || !time.length ? null : sampleIndex(time, cursorTime);
  const w = Math.max(1, width - left - right),
    h = Math.max(1, height - top - bottom);
  const latest = useRef({ view, axes, onView, onActivate, duration, w, h });
  useLayoutEffect(() => {
    latest.current = { view, axes, onView, onActivate, duration, w, h };
  }, [view, axes, onView, onActivate, duration, w, h]);
  const schedule = (v: PlotView) => {
    if (frame.current !== null) cancelAnimationFrame(frame.current);
    frame.current = requestAnimationFrame(() => {
      frame.current = null;
      onView(v);
    });
  };
  useEffect(() => {
    const node = canvas.current;
    if (!node) return;
    const wheel = (e: WheelEvent) => {
      e.preventDefault();
      const s = latest.current,
        r = node.getBoundingClientRect();
      s.onActivate();
      const fx = Math.max(0, Math.min(1, (e.clientX - r.left - left) / s.w)),
        fy = 1 - Math.max(0, Math.min(1, (e.clientY - r.top - top) / s.h));
      const factor = Math.exp(Math.max(-0.5, Math.min(0.5, e.deltaY * 0.002)));
      const next = {
        x:
          s.axes === 'y'
            ? s.view.x
            : clampTime(zoomRange(s.view.x, factor, fx), s.duration),
        y: s.axes === 'x' ? s.view.y : zoomRange(s.view.y, factor, fy),
      };
      if (frame.current !== null) cancelAnimationFrame(frame.current);
      frame.current = requestAnimationFrame(() => {
        frame.current = null;
        s.onView(next);
      });
    };
    node.addEventListener('wheel', wheel, { passive: false });
    return () => {
      node.removeEventListener('wheel', wheel);
      if (frame.current !== null) cancelAnimationFrame(frame.current);
    };
  }, []);
  useEffect(() => {
    const node = canvas.current;
    if (!node) return;
    const dpr = window.devicePixelRatio || 1;
    node.width = Math.round(width * dpr);
    node.height = Math.round(height * dpr);
    const ctx = node.getContext('2d');
    if (!ctx) return;
    ctx.scale(dpr, dpr);
    ctx.fillStyle = '#fff';
    ctx.fillRect(0, 0, width, height);
    const typography = getComputedStyle(node);
    ctx.font = `${typography.getPropertyValue('--text-micro').trim() || '10px'} ${typography.getPropertyValue('--font-code').trim() || 'monospace'}`;
    ctx.strokeStyle = '#e7ebef';
    ctx.fillStyle = '#65707a';
    for (const value of axisTicks(view.x, Math.max(2, Math.floor(w / 90)))) {
      const px = left + ((value - view.x[0]) / (view.x[1] - view.x[0])) * w;
      ctx.beginPath();
      ctx.moveTo(px, top);
      ctx.lineTo(px, top + h);
      ctx.stroke();
      ctx.textAlign = px > width - 45 ? 'right' : 'center';
      ctx.fillText(
        formatPlotTime(value, duration, view.x[1] - view.x[0]),
        px,
        height - 9,
      );
    }
    for (const value of axisTicks(view.y, Math.max(2, Math.floor(h / 45)))) {
      const py = top + ((view.y[1] - value) / (view.y[1] - view.y[0])) * h;
      ctx.beginPath();
      ctx.moveTo(left, py);
      ctx.lineTo(left + w, py);
      ctx.stroke();
      ctx.textAlign = 'right';
      ctx.fillText(number(value), left - 8, py + 4);
    }
    ctx.strokeStyle = '#adb6bf';
    ctx.lineWidth = 1;
    ctx.strokeRect(left, top, w, h);
    ctx.save();
    ctx.beginPath();
    ctx.rect(left, top, w, h);
    ctx.clip();
    const from = Math.max(0, sampleIndex(time, view.x[0]) - 1),
      to = Math.min(time.length - 1, sampleIndex(time, view.x[1]) + 1);
    for (const s of traces) {
      ctx.strokeStyle = s.color;
      ctx.lineWidth = 1.5;
      // Dense switching samples should not produce exaggerated miter spikes.
      ctx.lineJoin = 'round';
      ctx.beginPath();
      let started = false;
      for (let i = from; i <= to; i++) {
        const value = s.values[i];
        if (!Number.isFinite(value)) {
          started = false;
          continue;
        }
        const x = left + ((time[i] - view.x[0]) / (view.x[1] - view.x[0])) * w,
          y = top + ((view.y[1] - value) / (view.y[1] - view.y[0])) * h;
        if (!started) {
          ctx.moveTo(x, y);
          started = true;
        } else ctx.lineTo(x, y);
      }
      ctx.stroke();
    }
    if (cursor !== null) {
      const x =
        left + ((time[cursor] - view.x[0]) / (view.x[1] - view.x[0])) * w;
      ctx.strokeStyle = '#6d7986';
      ctx.setLineDash([3, 3]);
      ctx.beginPath();
      ctx.moveTo(x, top);
      ctx.lineTo(x, top + h);
      ctx.stroke();
    }
    ctx.restore();
  }, [width, height, time, traces, view, duration, w, h, cursor]);
  const local = (e: React.PointerEvent) => {
    const r = e.currentTarget.getBoundingClientRect();
    return {
      x: Math.max(left, Math.min(left + w, e.clientX - r.left)),
      y: Math.max(top, Math.min(top + h, e.clientY - r.top)),
    };
  };
  return (
    <div className="di-plot-surface" style={{ width, height }}>
      <canvas
        ref={canvas}
        style={{
          width,
          height,
          cursor: mode === 'pan' ? 'grab' : 'crosshair',
          touchAction: 'none',
        }}
        tabIndex={0}
        aria-label={`Time plot. X ${number(view.x[0])} to ${number(view.x[1])} seconds. Y ${number(view.y[0])} to ${number(view.y[1])}. ${traces.map((t) => t.name).join(', ')}`}
        aria-describedby={id}
        onPointerDown={(e) => {
          if (e.button !== 0 && e.button !== 1) return;
          e.preventDefault();
          onActivate();
          const p = local(e);
          if (mode === 'cursor')
            setCursorTime(
              view.x[0] + ((p.x - left) / w) * (view.x[1] - view.x[0]),
            );
          drag.current = {
            pointer: e.pointerId,
            ...p,
            view,
            mode: e.button === 1 ? 'pan' : mode,
          };
          e.currentTarget.setPointerCapture(e.pointerId);
        }}
        onPointerMove={(e) => {
          const p = local(e),
            d = drag.current;
          if (!d) {
            if (mode === 'cursor')
              setCursorTime(
                view.x[0] + ((p.x - left) / w) * (view.x[1] - view.x[0]),
              );
            return;
          }
          if (d.mode === 'pan')
            schedule(
              panView(d.view, (p.x - d.x) / w, (p.y - d.y) / h, axes, duration),
            );
          else if (d.mode === 'zoom')
            setBox({ x: d.x, y: d.y, x2: p.x, y2: p.y });
          else
            setCursorTime(
              view.x[0] + ((p.x - left) / w) * (view.x[1] - view.x[0]),
            );
        }}
        onPointerUp={(e) => {
          const d = drag.current;
          if (!d) return;
          const p = local(e);
          if (mode === 'cursor')
            setCursorTime(
              view.x[0] + ((p.x - left) / w) * (view.x[1] - view.x[0]),
            );
          drag.current = null;
          setBox(null);
          if (frame.current !== null) {
            cancelAnimationFrame(frame.current);
            frame.current = null;
          }
          if (d.mode === 'pan')
            onView(
              panView(d.view, (p.x - d.x) / w, (p.y - d.y) / h, axes, duration),
            );
          if (
            d.mode === 'zoom' &&
            (axes === 'y' || Math.abs(p.x - d.x) > 4) &&
            (axes === 'x' || Math.abs(p.y - d.y) > 4)
          ) {
            const tx = (x: number) =>
              d.view.x[0] + ((x - left) / w) * (d.view.x[1] - d.view.x[0]);
            const ty = (y: number) =>
              d.view.y[1] - ((y - top) / h) * (d.view.y[1] - d.view.y[0]);
            onView({
              x:
                axes === 'y'
                  ? d.view.x
                  : clampTime(
                      [tx(Math.min(d.x, p.x)), tx(Math.max(d.x, p.x))],
                      duration,
                    ),
              y:
                axes === 'x'
                  ? d.view.y
                  : [ty(Math.max(d.y, p.y)), ty(Math.min(d.y, p.y))],
            });
          }
          if (e.currentTarget.hasPointerCapture(e.pointerId))
            e.currentTarget.releasePointerCapture(e.pointerId);
        }}
        onPointerCancel={() => {
          drag.current = null;
          setBox(null);
          if (frame.current !== null) {
            cancelAnimationFrame(frame.current);
            frame.current = null;
          }
        }}
        onDoubleClick={onFit}
        onKeyDown={(e) => {
          if (e.key === 'Home') {
            e.preventDefault();
            e.stopPropagation();
            onFit();
          }
          if (
            ['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown'].includes(e.key)
          ) {
            e.preventDefault();
            e.stopPropagation();
            onView(
              panView(
                view,
                e.key === 'ArrowLeft' ? 0.1 : e.key === 'ArrowRight' ? -0.1 : 0,
                e.key === 'ArrowUp' ? 0.1 : e.key === 'ArrowDown' ? -0.1 : 0,
                axes,
                duration,
              ),
            );
          }
        }}
      />
      {box && (
        <div
          className="di-zoom-box"
          style={{
            left: axes === 'y' ? left : Math.min(box.x, box.x2),
            top: axes === 'x' ? top : Math.min(box.y, box.y2),
            width: axes === 'y' ? w : Math.abs(box.x - box.x2),
            height: axes === 'x' ? h : Math.abs(box.y - box.y2),
          }}
        />
      )}
      <div id={id} className="di-cursor-readout">
        {cursor !== null && (
          <>
            t = {number(time[cursor])} s ·{' '}
            {traces
              .map((t) => `${t.name}: ${number(t.values[cursor])} ${t.unit}`)
              .join(' · ')}
          </>
        )}
      </div>
    </div>
  );
}
