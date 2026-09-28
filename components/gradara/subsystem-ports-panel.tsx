'use client';
import { ArrowDown, ArrowUp, Plus, X } from 'lucide-react';
import { domainColors, domainLabels } from '@/lib/gradara/model';
import type { Block, Domain, Project } from '@/lib/gradara/model';
import { boundaryBlocks, type BoundaryKind } from '@/lib/gradara/hierarchy';
import { boundaryDomains } from '@/lib/gradara/port-blocks';
import {
  addInstancePort,
  editInstancePort,
  editPort,
  instancePortBlocks,
  portKindLabels,
  portSummary,
  removeInstancePort,
  type PortChange,
  type Side,
} from '@/lib/gradara/subsystem-ports';

const kinds: BoundaryKind[] = ['inport', 'outport', 'connport'];
const sides: Side[] = ['left', 'right', 'top', 'bottom'];
const sideLabels: Record<Side, string> = {
  left: 'Left',
  right: 'Right',
  top: 'Top',
  bottom: 'Bottom',
};

/** Signal and Boolean for inputs and outputs; the physical domains for terminals. */
function DomainSelect({
  kind,
  value,
  onChange,
  label,
}: {
  kind: BoundaryKind;
  value: Domain;
  onChange: (d: Domain) => void;
  label: string;
}) {
  return (
    <select
      aria-label={label}
      value={value}
      onChange={(e) => onChange(e.target.value as Domain)}
    >
      {boundaryDomains(kind).map((d) => (
        <option key={d} value={d}>
          {domainLabels[d]}
        </option>
      ))}
    </select>
  );
}

/**
 * Inspector section for a port pill inside a subsystem, like the Simulink Inport,
 * Outport, and Connection Port dialogs: what it is, its number, what it carries, and
 * where it sits on the subsystem block.
 */
export function PortPillPanel({
  view,
  block,
  onCommit,
}: {
  view: Project;
  block: Block;
  onCommit: (change: (p: Project) => Project) => void;
}) {
  const port = portSummary(block);
  const count = boundaryBlocks(view).filter(
    (b) => b.definition.kind === port.kind,
  ).length;
  const change = (c: PortChange) => onCommit((p) => editPort(p, block.id, c));
  return (
    <div className="inspector-section subsystem-section">
      <div className="section-label">Subsystem port</div>
      <label className="field-row">
        <span>Type</span>
        <select
          value={port.kind}
          onChange={(e) => change({ kind: e.target.value as BoundaryKind })}
        >
          {kinds.map((k) => (
            <option key={k} value={k}>
              {portKindLabels[k]}
            </option>
          ))}
        </select>
      </label>
      <label className="field-row">
        <span>Name</span>
        <input
          key={port.name}
          defaultValue={port.name}
          onBlur={(e) => change({ name: e.target.value })}
          onKeyDown={(e) => {
            if (e.key === 'Enter') e.currentTarget.blur();
          }}
        />
      </label>
      <label className="field-row">
        <span>Port number</span>
        <select
          value={port.number ?? 1}
          onChange={(e) => change({ number: Number(e.target.value) })}
        >
          {Array.from({ length: count }, (_, i) => (
            <option key={i} value={i + 1}>
              {i + 1}
            </option>
          ))}
        </select>
      </label>
      <label className="field-row">
        <span>{port.kind === 'connport' ? 'Domain' : 'Carries'}</span>
        <DomainSelect
          kind={port.kind}
          value={port.domain}
          label="Domain"
          onChange={(domain) => change({ domain })}
        />
      </label>
      <label className="field-row">
        <span>Side outside</span>
        <select
          value={port.side}
          onChange={(e) => change({ side: e.target.value as Side })}
        >
          {sides.map((s) => (
            <option key={s} value={s}>
              {sideLabels[s]}
            </option>
          ))}
        </select>
      </label>
      <p className="size-hint">
        The name and number show on the subsystem block. A port takes the domain
        of the first thing you wire to it; changing its type or domain later
        removes its wires.
      </p>
    </div>
  );
}

/**
 * The ports of a selected subsystem block, edited without opening it: rename,
 * retype, move to another side or number, add, and remove.
 */
export function InstancePortsPanel({
  view,
  block,
  onCommit,
  onSelectPort,
}: {
  view: Project;
  block: Block;
  onCommit: (change: (p: Project) => Project) => void;
  onSelectPort?: (portId: string) => void;
}) {
  const ports = instancePortBlocks(view, block).map(portSummary);
  const edit = (id: string, c: PortChange) =>
    onCommit((p) => editInstancePort(p, block.id, id, c));
  const countOf = (kind: BoundaryKind) =>
    ports.filter((p) => p.kind === kind).length;
  return (
    <div className="instance-ports">
      <div className="instance-ports-head">
        <span>Ports</span>
        <span className="instance-ports-add">
          {kinds.map((kind) => (
            <button
              key={kind}
              type="button"
              title={`Add ${portKindLabels[kind].toLowerCase()} port`}
              onClick={() =>
                onCommit((p) => addInstancePort(p, block.id, { kind }).project)
              }
            >
              <Plus size={11} />
              {portKindLabels[kind]}
            </button>
          ))}
        </span>
      </div>
      {!ports.length && (
        <p className="size-hint">
          No ports yet. Add one here, or drop a wire on the block.
        </p>
      )}
      <ol className="instance-port-list">
        {ports.map((port) => (
          <li key={port.id}>
            <span
              className="instance-port-badge"
              style={{ borderColor: domainColors[port.domain] }}
              title={`${portKindLabels[port.kind]} ${port.number ?? ''}`}
            >
              {port.kind === 'inport'
                ? 'In'
                : port.kind === 'outport'
                  ? 'Out'
                  : 'T'}
              {port.number}
            </span>
            <input
              key={port.name}
              aria-label={`Name of ${portKindLabels[port.kind].toLowerCase()} ${port.number}`}
              defaultValue={port.name}
              onFocus={() => onSelectPort?.(port.id)}
              onBlur={(e) => {
                if (e.target.value.trim() !== port.name)
                  edit(port.id, { name: e.target.value });
              }}
              onKeyDown={(e) => {
                if (e.key === 'Enter') e.currentTarget.blur();
              }}
            />
            <DomainSelect
              kind={port.kind}
              value={port.domain}
              label={`What ${port.name} carries`}
              onChange={(domain) => edit(port.id, { domain })}
            />
            <select
              aria-label={`Side of ${port.name}`}
              value={port.side}
              onChange={(e) => edit(port.id, { side: e.target.value as Side })}
            >
              {sides.map((s) => (
                <option key={s} value={s}>
                  {sideLabels[s]}
                </option>
              ))}
            </select>
            <span className="instance-port-tools">
              <button
                type="button"
                aria-label={`Move ${port.name} up`}
                disabled={(port.number ?? 1) <= 1}
                onClick={() =>
                  edit(port.id, { number: (port.number ?? 1) - 1 })
                }
              >
                <ArrowUp size={11} />
              </button>
              <button
                type="button"
                aria-label={`Move ${port.name} down`}
                disabled={(port.number ?? 1) >= countOf(port.kind)}
                onClick={() =>
                  edit(port.id, { number: (port.number ?? 1) + 1 })
                }
              >
                <ArrowDown size={11} />
              </button>
              <button
                type="button"
                aria-label={`Remove ${port.name}`}
                onClick={() =>
                  onCommit((p) => removeInstancePort(p, block.id, port.id))
                }
              >
                <X size={11} />
              </button>
            </span>
          </li>
        ))}
      </ol>
    </div>
  );
}
