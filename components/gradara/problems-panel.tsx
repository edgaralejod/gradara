'use client';
import { useRef, useState, type ReactNode } from 'react';
import {
  ChevronRight,
  CircleAlert,
  CircleCheck,
  Info,
  Sparkles,
  TriangleAlert,
} from 'lucide-react';
import type { Diagnostic } from '@/lib/gradara/api';
import { domainColors, type Project } from '@/lib/gradara/model';

export type ProblemSection = {
  id: string;
  title: string;
  note?: string;
  stale?: boolean;
  items: Diagnostic[];
};

const SOURCE_LABELS: Record<Diagnostic['source'], string> = {
  validation: 'Validation',
  safety: 'Safety',
  compiler: 'Compiler',
  runtime: 'Runtime',
  engine: 'Engine',
};

function SeverityIcon({ severity }: { severity: Diagnostic['severity'] }) {
  if (severity === 'error')
    return <CircleAlert size={14} className="problem-icon is-error" aria-label="Error" />;
  if (severity === 'warning')
    return <TriangleAlert size={14} className="problem-icon is-warning" aria-label="Warning" />;
  return <Info size={14} className="problem-icon is-info" aria-label="Note" />;
}

export default function ProblemsPanel({
  project,
  sections,
  onSelect,
  onAsk,
  empty,
}: {
  project: Project;
  sections: ProblemSection[];
  onSelect: (diagnostic: Diagnostic, blockIds?: string[]) => void;
  onAsk?: (diagnostic: Diagnostic) => void;
  empty?: ReactNode;
}) {
  const [expanded, setExpanded] = useState<Set<string>>(new Set());
  const rows = useRef<(HTMLButtonElement | null)[]>([]);
  const blocks = new Map(project.blocks.map((b) => [b.id, b]));
  const visible = sections.filter((s) => s.items.length);
  const toggle = (key: string) =>
    setExpanded((current) => {
      const next = new Set(current);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });

  if (!visible.length)
    return (
      <div className="problems-empty">
        <CircleCheck size={16} />
        {empty ?? 'No problems. Run the model to check it in OpenModelica.'}
      </div>
    );

  const offsets = visible.map((_, i) =>
    visible.slice(0, i).reduce((sum, s) => sum + s.items.length, 0),
  );
  return (
    <div className="problems-panel">
      {visible.map((section, sectionIndex) => (
        <section key={section.id} className={section.stale ? 'is-stale' : ''}>
          <h3 className="problems-section">
            {section.title}
            <span>{section.items.length}</span>
            {section.note && <em>{section.note}</em>}
          </h3>
          <ul>
            {section.items.map((d, itemIndex) => {
              const position = offsets[sectionIndex] + itemIndex;
              const key = `${section.id}:${d.id}`;
              const open = expanded.has(key);
              const expandable = !!(d.detail || d.hint);
              const portNames = new Map(
                d.ports.map((p) => {
                  const block = blocks.get(p.blockId);
                  const port = block?.definition.ports.find((x) => x.id === p.portId);
                  return [`${p.blockId}.${p.portId}`, port ? `${block!.definition.name}.${port.name}` : p.portId];
                }),
              );
              return (
                <li key={key} className={`problem is-${d.severity} ${open ? 'is-open' : ''}`}>
                  <div className="problem-row">
                    <button
                      type="button"
                      className="problem-expand"
                      aria-label={open ? 'Hide details' : 'Show details'}
                      aria-expanded={open}
                      disabled={!expandable}
                      onClick={() => toggle(key)}
                    >
                      {expandable && <ChevronRight size={12} />}
                    </button>
                    <button
                      type="button"
                      ref={(el) => {
                        rows.current[position] = el;
                      }}
                      className="problem-main"
                      title={d.blockIds.length ? 'Select on the canvas' : undefined}
                      onClick={() => onSelect(d)}
                      onKeyDown={(e) => {
                        if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
                          e.preventDefault();
                          rows.current[position + (e.key === 'ArrowDown' ? 1 : -1)]?.focus();
                        } else if (e.key === ' ' && expandable) {
                          e.preventDefault();
                          toggle(key);
                        }
                      }}
                    >
                      <SeverityIcon severity={d.severity} />
                      <span className="problem-message">{d.message}</span>
                    </button>
                    <span className="problem-source">{SOURCE_LABELS[d.source]}</span>
                    <span className="problem-chips">
                      {d.ports.length
                        ? d.ports.map((p) => {
                            const block = blocks.get(p.blockId);
                            return (
                              <button
                                type="button"
                                key={`${p.blockId}.${p.portId}`}
                                className="problem-chip"
                                onClick={() => onSelect(d, [p.blockId])}
                              >
                                <i
                                  style={{
                                    background: block ? domainColors[block.definition.domain] : undefined,
                                  }}
                                />
                                {portNames.get(`${p.blockId}.${p.portId}`)}
                              </button>
                            );
                          })
                        : d.blockIds.map((id) => {
                            const block = blocks.get(id);
                            if (!block) return null;
                            return (
                              <button
                                type="button"
                                key={id}
                                className="problem-chip"
                                onClick={() => onSelect(d, [id])}
                              >
                                <i style={{ background: domainColors[block.definition.domain] }} />
                                {block.definition.name}
                              </button>
                            );
                          })}
                    </span>
                    {onAsk && d.severity !== 'info' && (
                      <button
                        type="button"
                        className="problem-ask"
                        title="Ask AI about this problem"
                        aria-label="Ask AI about this problem"
                        onClick={() => onAsk(d)}
                      >
                        <Sparkles size={12} />
                      </button>
                    )}
                  </div>
                  {open && (
                    <div className="problem-detail">
                      {d.hint && <p className="problem-hint">{d.hint}</p>}
                      {d.detail && <pre>{d.detail}</pre>}
                    </div>
                  )}
                </li>
              );
            })}
          </ul>
        </section>
      ))}
    </div>
  );
}
