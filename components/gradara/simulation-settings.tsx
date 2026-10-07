'use client';
import { useEffect, useId, useRef, useState } from 'react';
import { CircleHelp, RotateCcw } from 'lucide-react';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import {
  DEFAULTS,
  SOLVER_IDS,
  TOLERANCE,
  cleanSettings,
  consequence,
  effective,
  formatSeconds,
  formatTolerance,
  isDefault,
  isFixed,
  settingsProblems,
  type SettingsField,
  type SimulationSettings,
  type SolverId,
} from '@/lib/gradara/solver';
import { FIELDS, SOLVERS, SOLVER_LINE } from '@/lib/gradara/solver-docs';

/** Each power of ten in the allowed range, plus a document's own value when it is not one. */
function toleranceChoices(current: number): number[] {
  const out: number[] = [];
  for (let e = Math.round(Math.log10(TOLERANCE.max)); e >= Math.round(Math.log10(TOLERANCE.min)); e--)
    out.push(Number(`1e${e}`));
  if (!out.includes(current)) out.push(current);
  return out.sort((a, b) => b - a);
}

/** A help button that opens a short explanation next to the field. */
function FieldHelp({
  title,
  paragraphs,
  onGuide,
}: {
  title: string;
  paragraphs: string[];
  onGuide: () => void;
}) {
  return (
    <Popover>
      <PopoverTrigger
        className="sim-help"
        aria-label={`About ${title}`}
        title={`About ${title}`}
      >
        <CircleHelp size={13} />
      </PopoverTrigger>
      <PopoverContent side="left" align="start" className="sim-popover">
        <strong>{title}</strong>
        {paragraphs.map((p, i) => (
          <p key={i}>{p}</p>
        ))}
        <button type="button" className="sim-guide-link" onClick={onGuide}>
          Open the simulation settings guide
        </button>
      </PopoverContent>
    </Popover>
  );
}

/**
 * A seconds field where blank means automatic. Text that is not a positive
 * number is reported, never replaced by the automatic value.
 */
function OptionalSeconds({
  value,
  auto,
  label,
  onChange,
  onValidity,
}: {
  value: number | undefined;
  auto: string;
  label: string;
  onChange: (value: number | undefined) => void;
  onValidity: (valid: boolean) => void;
}) {
  const [text, setText] = useState(value === undefined ? '' : String(value));
  // A new value from outside (undo, Defaults) replaces the text, unless the text already says it.
  const [shown, setShown] = useState(value);
  if (shown !== value) {
    setShown(value);
    if (!(text.trim() !== '' && Number(text) === value)) setText(value === undefined ? '' : String(value));
  }
  const parsed = (raw: string) => {
    if (raw.trim() === '') return undefined;
    const n = Number(raw);
    return Number.isFinite(n) && n > 0 && n <= 86400 ? n : null;
  };
  const valid = parsed(text) !== null;
  const report = useRef(onValidity);
  useEffect(() => {
    report.current = onValidity;
  });
  useEffect(() => {
    report.current(valid);
  }, [valid]);
  useEffect(() => () => report.current(true), []);
  const commit = () => {
    const next = parsed(text);
    if (next !== null && next !== value) onChange(next);
  };
  return (
    <input
      className="sim-input"
      type="text"
      inputMode="decimal"
      aria-label={label}
      aria-invalid={!valid || undefined}
      placeholder={auto}
      value={text}
      onChange={(e) => setText(e.target.value)}
      onBlur={commit}
      onKeyDown={(e) => {
        if (e.key === 'Enter') commit();
        if (e.key === 'Escape') setText(value === undefined ? '' : String(value));
      }}
    />
  );
}

/**
 * The model's solver settings, in the inspector under Stop time. Every field
 * says what it does in one line, has a help button with more, and the line at
 * the bottom says what the current values mean for the run.
 */
export default function SimulationSettingsPanel({
  duration,
  settings,
  onChange,
  onValidity,
  onGuide,
}: {
  duration: number;
  settings: SimulationSettings | undefined;
  /** One undoable model change; undefined restores the defaults. */
  onChange: (settings: SimulationSettings | undefined) => void;
  /** False while a field holds text that is not a value, or the settings cannot run. */
  onValidity: (valid: boolean) => void;
  /** Open the full guide, optionally at one symptom. */
  onGuide: (topic?: string) => void;
}) {
  const id = useId();
  const solver = settings?.solver ?? DEFAULTS.solver;
  const fixed = isFixed(solver);
  const run = effective(duration, settings);
  const [badFields, setBadFields] = useState<Partial<Record<SettingsField, boolean>>>({});
  const problems = settingsProblems(duration, settings);
  const valid = !Object.values(badFields).some(Boolean) && problems.length === 0;
  const report = useRef(onValidity);
  useEffect(() => {
    report.current = onValidity;
  });
  useEffect(() => {
    report.current(valid);
  }, [valid]);
  useEffect(() => () => report.current(true), []);
  const set = (patch: SimulationSettings) => onChange(cleanSettings({ ...settings, ...patch }));
  const validity = (field: SettingsField) => (ok: boolean) =>
    setBadFields((b) => (!!b[field] === !ok ? b : { ...b, [field]: !ok }));
  const result = consequence(duration, settings);
  const fieldRow = (field: SettingsField, control: React.ReactNode, error?: string) => {
    const text = FIELDS[field];
    return (
      <div className="sim-row" key={field}>
        <span className="sim-label">
          {text.label}
          {text.unit && <small>{text.unit}</small>}
        </span>
        <div className="sim-control">{control}</div>
        <FieldHelp title={text.label} paragraphs={text.help} onGuide={() => onGuide()} />
        <p className="sim-line">{text.line}</p>
        {error && (
          <p role="alert" className="field-error sim-error">
            {error}
          </p>
        )}
      </div>
    );
  };
  const problemFor = (field: SettingsField) => problems.find((p) => p.field === field)?.message;
  return (
    <section className="sim-settings" aria-labelledby={`${id}-title`}>
      <div className="sim-head">
        <span id={`${id}-title`} className="sim-title">
          Simulation
        </span>
        {!isDefault(duration, settings) && (
          <button
            type="button"
            className="sim-reset"
            title="Use the default solver settings"
            onClick={() => onChange(undefined)}
          >
            <RotateCcw size={11} />
            Defaults
          </button>
        )}
        <button
          type="button"
          className="sim-help"
          aria-label="Simulation settings guide"
          title="Simulation settings guide"
          onClick={() => onGuide()}
        >
          <CircleHelp size={13} />
        </button>
      </div>
      <div className="sim-row is-wide">
        <label htmlFor={`${id}-solver`} className="sim-label">
          Solver
        </label>
        <FieldHelp
          title="Solver"
          paragraphs={[SOLVER_LINE, ...SOLVER_IDS.map((s) => `${SOLVERS[s].name}: ${SOLVERS[s].whenToUse}`)]}
          onGuide={() => onGuide()}
        />
        <select
          id={`${id}-solver`}
          className="sim-select"
          value={solver}
          onChange={(e) => {
            const next = e.target.value as SolverId;
            set({ solver: next === DEFAULTS.solver ? undefined : next });
          }}
        >
          {(['Variable step', 'Fixed step'] as const).map((group) => (
            <optgroup key={group} label={group}>
              {SOLVER_IDS.filter((s) => isFixed(s) === (group === 'Fixed step')).map((s) => (
                <option key={s} value={s}>
                  {SOLVERS[s].name}
                  {s === DEFAULTS.solver ? ' (default)' : ''}
                </option>
              ))}
            </optgroup>
          ))}
        </select>
        <p className="sim-line">{SOLVERS[solver].whenToUse}</p>
      </div>
      {fixed ? (
        fieldRow(
          'step',
          <OptionalSeconds
            key={`step-${solver}`}
            label="Step size in seconds"
            value={settings?.step}
            auto={`auto · ${formatSeconds(duration / DEFAULTS.points)}`}
            onChange={(step) => set({ step })}
            onValidity={validity('step')}
          />,
          badFields.step ? 'Enter a step above 0 s, or leave it blank.' : problemFor('step'),
        )
      ) : (
        <>
          {fieldRow(
            'tolerance',
            <select
              className="sim-select"
              aria-label="Solver tolerance"
              value={String(run.tolerance)}
              onChange={(e) => {
                const tolerance = Number(e.target.value);
                set({ tolerance: tolerance === DEFAULTS.tolerance ? undefined : tolerance });
              }}
            >
              {toleranceChoices(run.tolerance).map((t) => (
                <option key={t} value={String(t)}>
                  {formatTolerance(t)}
                  {t === DEFAULTS.tolerance ? ' (default)' : ''}
                </option>
              ))}
            </select>,
          )}
          {fieldRow(
            'maxStep',
            <OptionalSeconds
              label="Maximum step in seconds"
              value={settings?.maxStep}
              auto="auto"
              onChange={(maxStep) => set({ maxStep })}
              onValidity={validity('maxStep')}
            />,
            badFields.maxStep ? 'Enter a step above 0 s, or leave it blank.' : undefined,
          )}
          {fieldRow(
            'outputInterval',
            <OptionalSeconds
              label="Output interval in seconds"
              value={settings?.outputInterval}
              auto={`auto · ${formatSeconds(duration / DEFAULTS.points)}`}
              onChange={(outputInterval) => set({ outputInterval })}
              onValidity={validity('outputInterval')}
            />,
            badFields.outputInterval
              ? 'Enter an interval above 0 s, or leave it blank.'
              : problemFor('outputInterval'),
          )}
        </>
      )}
      <p className="sim-consequence" aria-live="polite">
        {result.text}
        {run.maxStep !== undefined && !fixed ? `; no step longer than ${formatSeconds(run.maxStep)}` : ''}.
      </p>
      {result.warning && !problems.length && (
        <p className="sim-warning" aria-live="polite">
          {result.warning}
        </p>
      )}
    </section>
  );
}
