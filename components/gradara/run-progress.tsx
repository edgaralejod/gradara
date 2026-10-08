'use client';
import { useEffect, useState } from 'react';
import { Check, Square } from 'lucide-react';
import {
  STEPS,
  barFraction,
  elapsedText,
  leftText,
  phaseLabel,
  secondsLeft,
  simulatedText,
  stepIndex,
  type RunTrack,
} from '@/lib/gradara/run-progress';

/**
 * How far the running simulation has got: the step it is on (translate,
 * compile, simulate, read results), a bar that fills with simulated time,
 * elapsed time and, once there is enough to go on, the time left. Floats over
 * the canvas in the Diagram, and fills the empty Data Inspector in Results.
 */
export default function RunProgress({
  track,
  variant,
  onStop,
}: {
  track: RunTrack;
  variant: 'floating' | 'panel';
  onStop?: () => void;
}) {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const timer = window.setInterval(() => setNow(Date.now()), 500);
    return () => window.clearInterval(timer);
  }, []);
  const step = stepIndex(track.stage.phase);
  const fraction = barFraction(track);
  const percent = fraction === undefined ? undefined : Math.floor(fraction * 100);
  const meta = [
    simulatedText(track),
    `${elapsedText(track, now)} elapsed`,
    leftText(secondsLeft(track, now)),
  ].filter(Boolean);
  return (
    <section className={`run-progress is-${variant}`} aria-label="Simulation progress">
      <div className="rp-head">
        <strong>
          {track.label && <span className="rp-label">{track.label}</span>}
          <span aria-live="polite">{phaseLabel(track.stage.phase)}</span>
        </strong>
        {percent !== undefined && <span className="rp-percent">{percent}%</span>}
        {onStop && (
          <button type="button" className="rp-stop" onClick={onStop} title="Stop the simulation">
            <Square size={9} fill="currentColor" aria-hidden="true" />
            Stop
          </button>
        )}
      </div>
      <progress
        className="sr-only"
        aria-label="Simulation progress"
        max={100}
        {...(percent === undefined ? {} : { value: percent })}
      />
      <div className={`rp-bar ${fraction === undefined ? 'is-indeterminate' : ''}`} aria-hidden="true">
        <i style={fraction === undefined ? undefined : { transform: `scaleX(${fraction})` }} />
      </div>
      <div className="rp-meta">{meta.join(' · ')}</div>
      <ol className="rp-steps" aria-label="Steps">
        {STEPS.map((s, i) => (
          <li
            key={s.id}
            className={i < step ? 'is-done' : i === step ? 'is-active' : undefined}
            aria-current={i === step ? 'step' : undefined}
          >
            <span className="rp-dot" aria-hidden="true">
              {i < step && <Check size={8} strokeWidth={3} />}
            </span>
            {s.label}
          </li>
        ))}
      </ol>
    </section>
  );
}
