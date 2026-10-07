'use client';
// SPDX-License-Identifier: Apache-2.0
import { useEffect, useState } from 'react';
import { Activity, CircleAlert, LoaderCircle } from 'lucide-react';
import { api } from '@/lib/gradara/api';
import { bySignal, type RunDigest } from '@/lib/gradara/run-digest';
import { formatNumber } from '@/lib/gradara/results-discussion';

const t = (seconds: number | undefined) =>
  seconds === undefined ? '—' : `${formatNumber(seconds)} s`;
const v = (value: number | undefined, unit: string) =>
  value === undefined ? '—' : `${formatNumber(value)}${unit ? ` ${unit}` : ''}`;

/**
 * The Run summary: the numbers a person reads off the plots, computed on this
 * computer from the full stored runs (no AI). Clicking a time shows it on the plot.
 */
export default function RunSummary({
  modelId,
  runIds,
  baseline,
  signals,
  window,
  titles,
  colors,
  onFocus,
}: {
  modelId: string;
  runIds: string[];
  baseline?: string;
  signals: string[];
  window?: [number, number];
  titles: Record<string, string>;
  colors: Record<string, string>;
  /** Show a time or a stretch of one run's signal on the plot. */
  onFocus: (runId: string, key: string, target: { at?: number; window?: [number, number] }) => void;
}) {
  const request = JSON.stringify({
    modelId,
    runIds,
    baseline: baseline ?? null,
    signals,
    window: window ?? null,
  });
  const [state, setState] = useState<{ key: string; digest?: RunDigest; error?: string } | null>(null);
  useEffect(() => {
    const abort = new AbortController();
    // Wait for zooming and ticking to settle before asking for a new summary.
    const timer = setTimeout(() => {
      api<RunDigest>('/results/digest', { method: 'POST', body: request, signal: abort.signal })
        .then((digest) => setState({ key: request, digest }))
        .catch((e: Error) => {
          if (e.name !== 'AbortError') setState({ key: request, error: e.message });
        });
    }, 250);
    return () => {
      clearTimeout(timer);
      abort.abort();
    };
  }, [request]);
  const current = state?.key === request ? state : null;
  const digest = current?.digest;
  const idOf = (label: string) => digest?.runs.find((r) => r.label === label)?.id ?? '';
  const runName = (label: string) => titles[idOf(label)] ?? `Run ${label}`;
  const swatch = (label: string) => (
    <i className="summary-swatch" style={{ background: colors[idOf(label)] ?? '#637987' }} />
  );
  return (
    <section className="run-summary" aria-label="Run summary">
      <header className="run-summary-head">
        <Activity size={14} aria-hidden="true" />
        <div>
          <strong>Run summary</strong>
          <span>
            Computed on this computer from the full stored runs
            {digest && !digest.wholeRun ? ` · ${t(digest.window[0])} to ${t(digest.window[1])}` : ' · whole run'}.
            Click a time to show it on the plot.
          </span>
        </div>
      </header>
      {!current ? (
        <p className="run-summary-note">
          <LoaderCircle size={13} className="spin" /> Summarizing the runs…
        </p>
      ) : current.error ? (
        <p className="run-summary-note is-error" role="alert">
          <CircleAlert size={13} /> {current.error}
        </p>
      ) : digest ? (
        <div className="run-summary-body">
          {bySignal(digest).map((group) => {
            const events = digest.events.filter((e) => e.signal === group.key);
            return (
              <section key={group.key} className="summary-signal">
                <h3>
                  {group.name}
                  {group.unit && <small>{group.unit}</small>}
                </h3>
                <div className="summary-table-wrap">
                  <table className="summary-table">
                    <thead>
                      <tr>
                        <th scope="col">Run</th>
                        <th scope="col">Minimum</th>
                        <th scope="col">Maximum</th>
                        <th scope="col">Mean</th>
                        <th scope="col">RMS</th>
                        <th scope="col">Final</th>
                        <th scope="col">Steady · ripple</th>
                        <th scope="col">Settles</th>
                        <th scope="col">Overshoot</th>
                      </tr>
                    </thead>
                    <tbody>
                      {group.rows.map((row) => (
                        <tr key={row.run}>
                          <th scope="row">
                            {swatch(row.run)}
                            {runName(row.run)}
                          </th>
                          <td>
                            {v(row.stats.min, group.unit)}{' '}
                            <button type="button" onClick={() => onFocus(idOf(row.run), group.key, { at: row.stats.tMin })}>
                              at {t(row.stats.tMin)}
                            </button>
                          </td>
                          <td>
                            {v(row.stats.max, group.unit)}{' '}
                            <button type="button" onClick={() => onFocus(idOf(row.run), group.key, { at: row.stats.tMax })}>
                              at {t(row.stats.tMax)}
                            </button>
                          </td>
                          <td>{v(row.stats.mean, group.unit)}</td>
                          <td>{v(row.stats.rms, group.unit)}</td>
                          <td>{v(row.stats.final, group.unit)}</td>
                          <td>
                            {v(row.steady.value, group.unit)} · {v(row.steady.ripple, group.unit)}
                          </td>
                          <td>
                            {row.steady.settlingTime === undefined ? (
                              'not settled'
                            ) : (
                              <button
                                type="button"
                                onClick={() => onFocus(idOf(row.run), group.key, { at: row.steady.settlingTime })}
                              >
                                {t(row.steady.settlingTime)}
                              </button>
                            )}
                          </td>
                          <td>
                            {row.steady.overshootPercent === undefined
                              ? '—'
                              : `${formatNumber(row.steady.overshootPercent)} %`}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
                {events.length > 0 && (
                  <ul className="summary-events">
                    {events.map((e, i) => (
                      <li key={i}>
                        {swatch(e.run)}
                        <button type="button" onClick={() => onFocus(idOf(e.run), group.key, { window: [e.t0, e.t1] })}>
                          {e.kind} · {t(e.t0)}
                          {e.t1 > e.t0 ? `–${t(e.t1)}` : ''}
                        </button>
                        <span>{e.detail}</span>
                      </li>
                    ))}
                  </ul>
                )}
              </section>
            );
          })}
          {digest.comparison.length > 0 && (
            <section className="summary-signal">
              <h3>Differences from {runName(digest.comparison[0].baseline)}</h3>
              <div className="summary-table-wrap">
                <table className="summary-table">
                  <thead>
                    <tr>
                      <th scope="col">Signal</th>
                      <th scope="col">Run</th>
                      <th scope="col">Largest difference</th>
                      <th scope="col">RMS difference</th>
                    </tr>
                  </thead>
                  <tbody>
                    {digest.comparison.map((c, i) => {
                      const unit = digest.signals.find((s) => s.key === c.signal)?.unit ?? '';
                      const name = digest.signals.find((s) => s.key === c.signal)?.name ?? c.signal;
                      return (
                        <tr key={i}>
                          <th scope="row">{name}</th>
                          <td>
                            {swatch(c.run)}
                            {runName(c.run)}
                          </td>
                          <td>
                            {v(c.signedAtMax, unit)}{' '}
                            <button type="button" onClick={() => onFocus(idOf(c.run), c.signal, { at: c.at })}>
                              at {t(c.at)}
                            </button>
                          </td>
                          <td>{v(c.rmsDifference, unit)}</td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            </section>
          )}
          {digest.parameters.length > 0 && (
            <section className="summary-signal">
              <h3>Parameters that differ</h3>
              <ul className="summary-list">
                {digest.parameters.map((p, i) => (
                  <li key={i}>
                    {swatch(p.run)}
                    {runName(p.run)}: {p.block}
                    {p.change
                      ? ` ${p.change}`
                      : ` · ${p.parameter}: ${p.from} → ${p.to}${p.unit ? ` ${p.unit}` : ''}`}
                  </li>
                ))}
              </ul>
            </section>
          )}
          {digest.missing.length > 0 && (
            <p className="run-summary-note">
              Not in every run: {digest.missing.map((m) => `${m.signal} (run ${runName(m.run)})`).join(', ')}.
            </p>
          )}
          {digest.warnings.length > 0 && (
            <section className="summary-signal">
              <h3>Solver warnings in {runName('A')}</h3>
              <ul className="summary-list">
                {digest.warnings.map((w, i) => (
                  <li key={i}>{w}</li>
                ))}
              </ul>
            </section>
          )}
          {!digest.signals.length && (
            <p className="run-summary-note">Plot a signal to summarize it, or log signal nets and run again.</p>
          )}
        </div>
      ) : null}
    </section>
  );
}
