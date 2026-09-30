'use client';
import { ArrowDown, ArrowUp, Minus, Plus, X } from 'lucide-react';
import type { Block, Port, Project } from '@/lib/gradara/model';
import {
  busPortCount,
  busPortsWithCount,
  ELEMENT_NAME,
  elementNames,
  MAX_BUS_PORTS,
  MIN_BUS_PORTS,
  renamedBusInput,
  selectedIndices,
  selectorPorts,
  widthOf,
  withBusPorts,
} from '@/lib/gradara/buses';

const plural = (n: number, word: string) => `${n} ${word}${n === 1 ? '' : 's'}`;

/**
 * The Signals section for Mux, Demux, Bus Creator, and Bus Selector, as their
 * Simulink dialogs: how many signals a Mux joins or a Demux splits, the names a
 * Bus Creator gives, and the signals a Bus Selector picks. Every change is one
 * undoable edit; widths then follow the wiring (lib/gradara/buses.ts).
 */
export function BusSignalsPanel({
  block,
  onCommit,
}: {
  block: Block;
  onCommit: (change: (p: Project) => Project) => void;
}) {
  const d = block.definition;
  const inputs = d.ports.filter((p) => p.direction === 'input');
  const outputs = d.ports.filter((p) => p.direction === 'output');
  const apply = (ports: Port[]) =>
    onCommit((p) => withBusPorts(p, block.id, ports));
  return (
    <div className="inspector-section bus-section">
      <div className="section-label">Signals</div>
      {d.kind === 'mux' || d.kind === 'demux' ? (
        <CountPanel
          block={block}
          label={d.kind === 'mux' ? 'Inputs' : 'Outputs'}
          onCount={(n) => apply(busPortsWithCount(d, n))}
          carried={d.kind === 'mux' ? widthOf(outputs[0]) : widthOf(inputs[0])}
        />
      ) : d.kind === 'busCreator' ? (
        <CreatorPanel block={block} onPorts={apply} />
      ) : (
        <SelectorPanel block={block} onPorts={apply} />
      )}
    </div>
  );
}

function Stepper({
  value,
  min,
  max,
  label,
  onChange,
}: {
  value: number;
  min: number;
  max: number;
  label: string;
  onChange: (n: number) => void;
}) {
  return (
    <span className="bus-stepper">
      <button
        type="button"
        aria-label={`Fewer ${label.toLowerCase()}`}
        disabled={value <= min}
        onClick={() => onChange(value - 1)}
      >
        <Minus size={11} />
      </button>
      <input
        key={value}
        aria-label={label}
        inputMode="numeric"
        defaultValue={value}
        onBlur={(e) => {
          const n = Number(e.target.value);
          if (Number.isFinite(n) && n !== value)
            onChange(Math.max(min, Math.min(max, Math.round(n))));
          else e.target.value = String(value);
        }}
        onKeyDown={(e) => {
          if (e.key === 'Enter') e.currentTarget.blur();
        }}
      />
      <button
        type="button"
        aria-label={`More ${label.toLowerCase()}`}
        disabled={value >= max}
        onClick={() => onChange(value + 1)}
      >
        <Plus size={11} />
      </button>
    </span>
  );
}

function CountPanel({
  block,
  label,
  carried,
  onCount,
}: {
  block: Block;
  label: string;
  carried: number;
  onCount: (n: number) => void;
}) {
  const d = block.definition;
  const n = busPortCount(d);
  const mux = d.kind === 'mux';
  const fits = carried > 1 && carried % n === 0;
  return (
    <>
      <div className="field-row">
        <span>{label}</span>
        <Stepper
          value={n}
          min={MIN_BUS_PORTS}
          max={MAX_BUS_PORTS}
          label={label}
          onChange={onCount}
        />
      </div>
      <p className="size-hint">
        {mux
          ? `The output carries ${plural(carried, 'signal')}: the inputs in order. An input can be a vector itself.`
          : carried > 1
            ? fits
              ? `The input carries ${plural(carried, 'signal')}; each output takes ${carried / n === 1 ? 'one' : `${carried / n}, as a vector`}.`
              : `The input carries ${plural(carried, 'signal')}, which do not split into ${n} equal parts.`
            : 'Connect a vector from a Mux or a bus. Its signals are split into equal parts, in order.'}
      </p>
      {!mux && carried > 1 && carried !== n && carried <= MAX_BUS_PORTS && (
        <button
          type="button"
          className="bus-match"
          onClick={() => onCount(carried)}
        >
          Match incoming: {plural(carried, 'output')}
        </button>
      )}
    </>
  );
}

function CreatorPanel({
  block,
  onPorts,
}: {
  block: Block;
  onPorts: (ports: Port[]) => void;
}) {
  const d = block.definition;
  const inputs = d.ports.filter((p) => p.direction === 'input');
  const output = d.ports.find((p) => p.direction === 'output');
  const move = (i: number, by: number) => {
    const next = [...inputs];
    [next[i], next[i + by]] = [next[i + by], next[i]];
    onPorts([...next, ...(output ? [output] : [])]);
  };
  return (
    <>
      <div className="instance-ports-head">
        <span>Names</span>
        <span className="instance-ports-add">
          <button
            type="button"
            disabled={inputs.length >= MAX_BUS_PORTS}
            onClick={() => onPorts(busPortsWithCount(d, inputs.length + 1))}
          >
            <Plus size={11} />
            Signal
          </button>
        </span>
      </div>
      <ol className="bus-list">
        {inputs.map((p, i) => {
          const taken = inputs.some((q) => q !== p && q.name === p.name);
          const bad = !ELEMENT_NAME.test(p.name) || taken;
          return (
            <li key={p.id}>
              <span className="bus-index">{i + 1}</span>
              <input
                key={p.name}
                aria-label={`Name of input ${i + 1}`}
                aria-invalid={bad || undefined}
                title={
                  taken
                    ? 'Another input has this name.'
                    : bad
                      ? 'Use a letter, then letters, digits, or _.'
                      : undefined
                }
                defaultValue={p.name}
                onBlur={(e) => {
                  const name = e.target.value.trim();
                  if (name && name !== p.name)
                    onPorts(renamedBusInput(d, p.id, name));
                  else e.target.value = p.name;
                }}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') e.currentTarget.blur();
                }}
              />
              <span className="bus-width">
                {widthOf(p) > 1 ? `bus of ${widthOf(p)}` : ''}
              </span>
              <span className="instance-port-tools">
                <button
                  type="button"
                  aria-label={`Move ${p.name} up`}
                  disabled={i === 0}
                  onClick={() => move(i, -1)}
                >
                  <ArrowUp size={11} />
                </button>
                <button
                  type="button"
                  aria-label={`Move ${p.name} down`}
                  disabled={i === inputs.length - 1}
                  onClick={() => move(i, 1)}
                >
                  <ArrowDown size={11} />
                </button>
                <button
                  type="button"
                  aria-label={`Remove ${p.name}`}
                  disabled={inputs.length <= MIN_BUS_PORTS}
                  onClick={() => onPorts(d.ports.filter((q) => q.id !== p.id))}
                >
                  <X size={11} />
                </button>
              </span>
            </li>
          );
        })}
      </ol>
      <p className="size-hint">
        The bus carries {plural(widthOf(output), 'signal')}. Each input’s name
        travels with it; a bus plugged into an input keeps its signals under
        that name, such as <code>motor.speed</code>.
      </p>
    </>
  );
}

/** A bus's signals and the sub-buses above them (motor for motor.speed), in bus order. */
function choices(bus: Port | undefined) {
  const seen = new Set<string>();
  const out: { name: string; depth: number; group: boolean }[] = [];
  for (const e of bus ? elementNames(bus) : []) {
    const parts = e.split('.');
    parts.forEach((_, i) => {
      const name = parts.slice(0, i + 1).join('.');
      if (seen.has(name)) return;
      seen.add(name);
      out.push({ name, depth: i, group: i < parts.length - 1 });
    });
  }
  return out;
}

function SelectorPanel({
  block,
  onPorts,
}: {
  block: Block;
  onPorts: (ports: Port[]) => void;
}) {
  const d = block.definition;
  const bus = d.ports.find((p) => p.direction === 'input');
  const outputs = d.ports.filter((p) => p.direction === 'output');
  const selected = outputs.map((p) => p.name);
  const set = (names: string[]) => onPorts(selectorPorts(d, names));
  const options = choices(bus);
  const move = (i: number, by: number) => {
    const next = [...selected];
    [next[i], next[i + by]] = [next[i + by], next[i]];
    set(next);
  };
  return (
    <>
      <div className="instance-ports-head">
        <span>On the bus</span>
      </div>
      {options.length ? (
        <ul className="bus-choices">
          {options.map((o) => (
            <li key={o.name} style={{ paddingLeft: o.depth * 14 }}>
              <label>
                <input
                  type="checkbox"
                  checked={selected.includes(o.name)}
                  disabled={selected.length === 1 && selected[0] === o.name}
                  onChange={(e) =>
                    set(
                      e.target.checked
                        ? [...selected, o.name]
                        : selected.filter((n) => n !== o.name),
                    )
                  }
                />
                <span>{o.name.split('.').pop()}</span>
                {o.group && (
                  <span className="bus-width">
                    all {selectedIndices(bus, o.name).length}, as a vector
                  </span>
                )}
              </label>
            </li>
          ))}
        </ul>
      ) : (
        <p className="size-hint">
          Connect a bus from a Bus Creator (or a Mux) to choose its signals.
        </p>
      )}
      <div className="instance-ports-head">
        <span>Outputs</span>
      </div>
      <ol className="bus-list">
        {outputs.map((p, i) => {
          const missing =
            options.length > 0 && !selectedIndices(bus, p.name).length;
          return (
            <li key={p.id} className={missing ? 'is-missing' : undefined}>
              <span className="bus-index">{i + 1}</span>
              <span className="bus-name" title={p.name}>
                {p.name}
              </span>
              <span className="bus-width">
                {missing
                  ? 'not on the bus'
                  : widthOf(p) > 1
                    ? `vector of ${widthOf(p)}`
                    : ''}
              </span>
              <span className="instance-port-tools">
                <button
                  type="button"
                  aria-label={`Move ${p.name} up`}
                  disabled={i === 0}
                  onClick={() => move(i, -1)}
                >
                  <ArrowUp size={11} />
                </button>
                <button
                  type="button"
                  aria-label={`Move ${p.name} down`}
                  disabled={i === outputs.length - 1}
                  onClick={() => move(i, 1)}
                >
                  <ArrowDown size={11} />
                </button>
                <button
                  type="button"
                  aria-label={`Remove ${p.name}`}
                  disabled={outputs.length <= 1}
                  onClick={() => set(selected.filter((n) => n !== p.name))}
                >
                  <X size={11} />
                </button>
              </span>
            </li>
          );
        })}
      </ol>
      <p className="size-hint">
        Each selected signal is an output, labeled with its name. Removing one
        removes its wire.
      </p>
    </>
  );
}
