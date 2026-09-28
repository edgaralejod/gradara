'use client';
import { ArrowDown, ArrowUp, Plus, X } from 'lucide-react';
import { domainColors, domainLabels } from '@/lib/gradara/model';
import type { Block, Domain, Project } from '@/lib/gradara/model';
import { boundaryBlocks, type BoundaryKind } from '@/lib/gradara/hierarchy';
import {
  addInstancePort,
  editInstancePort,
  editPort,
  instancePortBlocks,
  portSummary,
  portTypes,
  type PortRole,
  removeInstancePort,
  type PortChange,
  type Side,
} from '@/lib/gradara/subsystem-ports';

const sides: Side[] = ['left', 'right', 'top', 'bottom'];
const sideLabels: Record<Side, string> = {
  left: 'Left',
  right: 'Right',
  top: 'Top',
  bottom: 'Bottom',
};
const roleLabels: Record<PortRole, string> = {
  input: 'Input',
  output: 'Output',
};

function RoleSelect({
  value,
  onChange,
  label,
}: {
  value: PortRole;
  onChange: (r: PortRole) => void;
  label?: string;
}) {
  return (
    <select
      aria-label={label}
      value={value}
      onChange={(e) => onChange(e.target.value as PortRole)}
    >
      {(['input', 'output'] as const).map((r) => (
        <option key={r} value={r}>
          {roleLabels[r]}
        </option>
      ))}
    </select>
  );
}

/** What a port carries: signal, Boolean, or a physical domain (which makes it a terminal). */
function TypeSelect({
  value,
  onChange,
  label,
}: {
  value: Domain;
  onChange: (d: Domain) => void;
  label?: string;
}) {
  return (
    <select
      aria-label={label}
      value={value}
      onChange={(e) => onChange(e.target.value as Domain)}
    >
      {portTypes.map((d) => (
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
      <div className="field-row">
        <span>Port</span>
        <RoleSelect
          label="Port"
          value={port.role}
          onChange={(role) => change({ role })}
        />
      </div>
      <div className="field-row">
        <span>Type</span>
        <TypeSelect
          label="Type"
          value={port.domain}
          onChange={(type) => change({ type })}
        />
      </div>
      <label className="field-row">
        <span>Name</span>
        <input
          id="port-name-field"
          key={port.name}
          defaultValue={port.name}
          onBlur={(e) => change({ name: e.target.value })}
          onKeyDown={(e) => {
            if (e.key === 'Enter') e.currentTarget.blur();
          }}
        />
      </label>
      <label className="field-row">
        <span>Number</span>
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
        The name shows on the subsystem block. A physical type makes the port a
        terminal. A new port takes the type of the first thing you wire to it;
        changing its port or type later removes its wires.
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
          <button
            type="button"
            onClick={() =>
              onCommit(
                (p) => addInstancePort(p, block.id, { kind: 'inport' }).project,
              )
            }
          >
            <Plus size={11} />
            Input
          </button>
          <button
            type="button"
            onClick={() =>
              onCommit(
                (p) =>
                  addInstancePort(p, block.id, { kind: 'outport' }).project,
              )
            }
          >
            <Plus size={11} />
            Output
          </button>
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
              title={`${roleLabels[port.role]} · ${domainLabels[port.domain]}`}
            >
              {port.role === 'input' ? 'In' : 'Out'}
              {port.kind === 'connport' ? '' : port.number}
            </span>
            <input
              key={port.name}
              aria-label={`Name of ${port.role} ${port.number ?? ''}`}
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
            <RoleSelect
              label={`Is ${port.name} an input or an output`}
              value={port.role}
              onChange={(role) => edit(port.id, { role })}
            />
            <TypeSelect
              label={`Type of ${port.name}`}
              value={port.domain}
              onChange={(type) => edit(port.id, { type })}
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
