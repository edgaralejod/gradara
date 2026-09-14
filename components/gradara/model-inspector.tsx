'use client';
import { useRef, useState } from 'react';
import { Box, Check, Copy, Focus, Network, Search } from 'lucide-react';
import { domainColors, type Project } from '@/lib/gradara/model';
import type { NetDescription } from '@/lib/gradara/net-registry';
import type { ModelSelection } from '@/lib/gradara/selection';
import { Button } from '@/components/ui/button';

export function ModelExplorer({
  project,
  nets,
  selection,
  onBlock,
  onNet,
  onModel,
}: {
  project: Project;
  nets: NetDescription[];
  selection: ModelSelection;
  onBlock: (id: string) => void;
  onNet: (id: string) => void;
  onModel: () => void;
}) {
  const [query, setQuery] = useState('');
  const q = query.trim().toLowerCase();
  const blocks = project.blocks.filter((b) =>
    `${b.definition.name} ${b.definition.kind} ${b.id} ${b.definition.domain}`
      .toLowerCase()
      .includes(q),
  );
  const filteredNets = nets.filter(
    ({ net, name, automaticName, domain, ports }) =>
      `${name} ${automaticName} ${net.id} ${(net.aliases ?? []).join(' ')} ${domain} ${ports.map((p) => `${p.blockName} ${p.portId}`).join(' ')}`
        .toLowerCase()
        .includes(q),
  );
  return (
    <div className="model-explorer">
      <button
        className="explorer-root"
        onClick={onModel}
        title="Model properties"
      >
        <Network size={14} />
        <strong>{project.name}</strong>
        <span>
          {project.blocks.length} blocks · {nets.length} nets
        </span>
      </button>
      <label className="explorer-search">
        <Search size={13} />
        <input
          aria-label="Search model"
          placeholder="Find blocks, nets, or IDs…"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
        />
        <kbd>⌕</kbd>
      </label>
      <div className="explorer-list" aria-label="Model elements">
        <details open>
          <summary>
            Blocks <span>{blocks.length}</span>
          </summary>
          {blocks.map((b) => (
            <button
              key={b.id}
              className="explorer-row"
              aria-label={`Inspect block ${b.definition.name}`}
              aria-pressed={selection.blockIds.includes(b.id)}
              onClick={() => onBlock(b.id)}
              title={`${b.definition.name} · ${b.id}`}
            >
              <Box
                size={13}
                style={{ color: domainColors[b.definition.domain] }}
              />
              <span>{b.definition.name}</span>
              <small>{b.definition.kind}</small>
            </button>
          ))}
        </details>
        <details open>
          <summary>
            Nets <span>{filteredNets.length}</span>
          </summary>
          {filteredNets.map(({ net, name, domain, ports }) => (
            <button
              key={net.id}
              className="explorer-row"
              aria-label={`Inspect net ${name}`}
              aria-pressed={selection.wireIds.some((id) =>
                net.wireIds.includes(id),
              )}
              onClick={() => onNet(net.id)}
              title={`${net.id}\n${ports.map((p) => `${p.blockName}.${p.portId}`).join(' ↔ ')}`}
            >
              <span
                className="explorer-net-icon"
                style={{ color: domainColors[domain] }}
              >
                ⎯
              </span>
              <span className="explorer-net-name">
                <strong>{name}</strong>
                <small>{netDestinations(net.anchor, ports)}</small>
              </span>
              {!net.name && <small className="auto-name-badge">Auto</small>}
            </button>
          ))}
        </details>
        {q && !blocks.length && !filteredNets.length && (
          <p className="explorer-empty">No elements match “{query}”.</p>
        )}
        {!project.blocks.length && !q && (
          <p className="explorer-empty">
            Add blocks and connect their ports to build a model.
          </p>
        )}
      </div>
    </div>
  );
}

function netDestinations(anchor: string, ports: NetDescription['ports']) {
  const destinations = ports.filter((p) => p.key !== anchor);
  if (!destinations.length) return 'No other terminal';
  const first = destinations[0];
  const arrow = first.direction === 'physical' ? '↔' : '→';
  return `${arrow} ${first.blockName}.${first.portId}${destinations.length > 1 ? ` + ${destinations.length - 1}` : ''}`;
}

export function NetProperties({
  description,
  project,
  onRename,
  onVisibility,
  onResetLabel,
  onTrace,
  onFocus,
  onBlock,
}: {
  description: NetDescription;
  project: Project;
  onRename: (value: string) => void;
  onVisibility: (visible: boolean) => void;
  onResetLabel: () => void;
  onTrace: () => void;
  onFocus: () => void;
  onBlock: (id: string) => void;
}) {
  const { net, name, automaticName, domain, ports, junctionIds } = description;
  const driver = ports.find((p) => p.direction === 'output');
  const sinks = ports.filter((p) => p.direction !== 'output');
  const physical = ports.some((p) => p.direction === 'physical');
  const duplicateName =
    net.name &&
    project.nets?.some((n) => n.id !== net.id && n.name === net.name);
  const portRows = (items: typeof ports) =>
    items.map((p) => (
      <button
        key={p.key}
        className="net-terminal"
        onClick={() => onBlock(p.blockId)}
        title={p.key}
      >
        <span
          className="port-dot"
          style={{ background: domainColors[p.domain] }}
        />
        <span>
          {p.blockName}
          <code>.{p.portId}</code>
        </span>
        {p.unit && <small>{p.unit}</small>}
      </button>
    ));
  return (
    <>
      <div className="inspector-intro net-properties">
        <span
          className="component-category"
          style={{ color: domainColors[domain] }}
        >
          {domain.toUpperCase()} NET
        </span>
        <NetNameField
          key={`${net.id}:${name}`}
          value={name}
          onCommit={onRename}
        />
        <div className="net-name-mode">
          {net.name ? (
            <button
              type="button"
              onClick={() => onRename('')}
              title={`Use ${automaticName}`}
            >
              Use automatic name
            </button>
          ) : (
            <span>Automatic · follows the connected block</span>
          )}
        </div>
        <IdentityField id={net.id} label="Net ID" />
        <p>
          One connection across {net.wireIds.length} wire{' '}
          {net.wireIds.length === 1 ? 'section' : 'sections'}
          {junctionIds.length
            ? ` and ${junctionIds.length} ${junctionIds.length === 1 ? 'junction' : 'junctions'}`
            : ''}
          .
        </p>
        <div className="net-property-actions">
          <Button variant="outline" size="sm" onClick={onTrace}>
            <Network size={13} />
            Select net
          </Button>
          <Button variant="outline" size="sm" onClick={onFocus}>
            <Focus size={13} />
            Locate
          </Button>
        </div>
      </div>
      <div className="inspector-section net-display-options">
        <div className="section-label">Label</div>
        <label>
          <input
            type="checkbox"
            checked={!net.hidden}
            onChange={(e) => onVisibility(e.target.checked)}
          />
          Show name on diagram
        </label>
        <p className="size-hint">
          Double-click a wire to name it. Drag its label along any branch or to
          either side.
        </p>
        {net.label && (
          <button className="text-action" onClick={onResetLabel}>
            Reset label position
          </button>
        )}
        {duplicateName && (
          <p className="size-hint">
            Another net uses this name. Their IDs remain distinct.
          </p>
        )}
        {!!net.aliases?.length && (
          <p className="size-hint">
            Names retained from merged nets: {net.aliases.join(', ')}
          </p>
        )}
      </div>
      <div className="inspector-section">
        <div className="section-label">
          {physical ? 'Connected terminals' : 'Source'}
        </div>
        {physical ? (
          portRows(ports)
        ) : driver ? (
          portRows([driver])
        ) : (
          <p className="net-open-source">No source connected</p>
        )}
        {!physical && (
          <>
            <div className="section-label net-destination-heading">
              Destinations <span>{sinks.length}</span>
            </div>
            {portRows(sinks)}
          </>
        )}
      </div>
    </>
  );
}

export function IdentityField({ id, label }: { id: string; label: string }) {
  const [copied, setCopied] = useState(false);
  const input = useRef<HTMLInputElement>(null);
  return (
    <div className="identity-field">
      <span>{label}</span>
      <div>
        <input
          ref={input}
          aria-label={label}
          value={id}
          readOnly
          onFocus={(e) => e.currentTarget.select()}
        />
        <button
          aria-label={`Copy ${label.toLowerCase()}`}
          title={copied ? 'Copied' : 'Copy full ID'}
          onClick={() => {
            void navigator.clipboard
              .writeText(id)
              .then(() => {
                setCopied(true);
              })
              .catch(() => {
                input.current?.focus();
                input.current?.select();
              });
          }}
        >
          {copied ? <Check size={12} /> : <Copy size={12} />}
        </button>
      </div>
    </div>
  );
}

function NetNameField({
  value,
  onCommit,
}: {
  value: string;
  onCommit: (value: string) => void;
}) {
  const [draft, setDraft] = useState(value),
    skip = useRef(false);
  const commit = () => {
    if (draft.trim() !== value) onCommit(draft);
  };
  return (
    <label className="net-name-field">
      <span>Net name</span>
      <input
        aria-label="Net name"
        maxLength={120}
        title="Type a custom name, or clear to use the automatic name"
        value={draft}
        onChange={(e) => setDraft(e.target.value)}
        onBlur={() => {
          if (!skip.current) commit();
          skip.current = false;
        }}
        onKeyDown={(e) => {
          if (e.key === 'Enter' || e.key === 'Escape') {
            e.preventDefault();
            skip.current = true;
            if (e.key === 'Enter') commit();
            else setDraft(value);
            e.currentTarget.blur();
          }
        }}
      />
    </label>
  );
}
