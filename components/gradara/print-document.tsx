'use client';
import { memo, useCallback, useMemo } from 'react';
import { ReactFlow, ReactFlowProvider } from '@xyflow/react';
import BlockNode from './block-node';
import NetLayer from './net-layer';
import NoteLayer from './note-layer';
import { SubsystemLookupContext } from './subsystem-preview';
import { findSubsystem } from '@/lib/gradara/hierarchy';
import { reconcileNodes } from '@/lib/gradara/canvas';
import { domainColors, type Project } from '@/lib/gradara/model';
import { emptySelection } from '@/lib/gradara/selection';
import { effective, formatSeconds, formatTolerance, isFixed } from '@/lib/gradara/solver';
import { SOLVERS } from '@/lib/gradara/solver-docs';
import {
  DOMAIN_NAMES,
  PAGE_MARGIN_MM,
  PAPER,
  pageBox,
  parameterRows,
  sheetDomains,
  sheetFit,
  type PrintOptions,
  type PrintPage,
} from '@/lib/gradara/print';

const nodeTypes = { block: BlockNode };
const noop = () => {};
const NO_SELECTION = emptySelection();

/**
 * One sheet drawn as the canvas draws it (the same block and wire components),
 * fitted into its page box, with every interaction off.
 */
const PrintSheet = memo(function PrintSheet({
  page,
  options,
}: {
  page: PrintPage;
  options: PrintOptions;
}) {
  const nodes = useMemo(
    () =>
      reconcileNodes([], [], page.sheet.blocks, []).map((n) => ({
        ...n,
        draggable: false,
        selectable: false,
        focusable: false,
      })),
    [page.sheet.blocks],
  );
  const fit = useMemo(() => sheetFit(page, options.paper), [page, options.paper]);
  const box = pageBox(options.paper).diagram;
  return (
    <div className="print-diagram" style={{ width: box.width, height: box.height }}>
      <ReactFlowProvider>
        <ReactFlow
          nodes={nodes}
          edges={[]}
          nodeTypes={nodeTypes}
          defaultViewport={fit}
          minZoom={0.02}
          maxZoom={1}
          nodesDraggable={false}
          nodesConnectable={false}
          nodesFocusable={false}
          edgesFocusable={false}
          elementsSelectable={false}
          panOnDrag={false}
          panOnScroll={false}
          zoomOnScroll={false}
          zoomOnPinch={false}
          zoomOnDoubleClick={false}
          preventScrolling={false}
          selectionOnDrag={false}
          deleteKeyCode={null}
          selectionKeyCode={null}
          multiSelectionKeyCode={null}
          proOptions={{ hideAttribution: true }}
        >
          <NoteLayer
            notes={page.sheet.annotations ?? []}
            editable={false}
            editing={null}
            onEditingChange={noop}
            onChange={noop}
          />
          <NetLayer
            project={page.sheet}
            selected={[]}
            selection={NO_SELECTION}
            groupSelection={false}
            onRegionSelect={noop}
            onSelect={noop}
            onDeleteSelection={noop}
            onCommit={noop}
          />
        </ReactFlow>
      </ReactFlowProvider>
    </div>
  );
});

function runSettings(doc: Project) {
  const run = effective(doc.duration, doc.simulation);
  const solver = SOLVERS[run.solver].name;
  const detail = isFixed(run.solver)
    ? `step ${formatSeconds(run.step ?? doc.duration / run.points)}`
    : `tolerance ${formatTolerance(run.tolerance)}`;
  return `Stop time ${formatSeconds(doc.duration)} · ${solver}, ${detail}`;
}

/** One sheet's page: header, the diagram, and a footer with the legend and run settings. */
export function SheetPage({
  doc,
  page,
  index,
  count,
  options,
  printed,
}: {
  doc: Project;
  page: PrintPage;
  index: number;
  count: number;
  options: PrintOptions;
  printed: Date;
}) {
  const box = pageBox(options.paper);
  const date = printed.toLocaleDateString(undefined, { year: 'numeric', month: 'short', day: 'numeric' });
  return (
    <section className="print-page" style={{ width: box.width, height: box.height }}>
      <header className="print-header">
        <div>
          <strong>{page.title}</strong>
          <span>
            {page.where ? page.where : 'Top level'}
            {page.variant ? ` · variant ${page.variant}` : ''}
            {page.also.length ? ` · also used as ${page.also.join(', ')}` : ''}
          </span>
        </div>
        <span className="print-sheet-number">
          {doc.name} · sheet {index + 1} of {count}
        </span>
      </header>
      <PrintSheet page={page} options={options} />
      <footer className="print-footer">
        <span className="print-legend">
          {sheetDomains(page.sheet).map((d) => (
            <span key={d}>
              <i style={{ background: domainColors[d] }} />
              {DOMAIN_NAMES[d]}
            </span>
          ))}
        </span>
        <span>
          {runSettings(doc)} · {date} · Gradara
        </span>
      </footer>
    </section>
  );
}

/**
 * The printed design: a page per sheet (header, diagram, footer with the legend
 * and run settings), each followed by its parameter table when asked for.
 */
export default function PrintDocument({
  doc,
  pages,
  options,
  printed,
}: {
  doc: Project;
  pages: PrintPage[];
  options: PrintOptions;
  /** When the print was made, for the footer. */
  printed: Date;
}) {
  const lookup = useCallback((ref: string) => findSubsystem(doc, ref), [doc]);
  const box = pageBox(options.paper);
  return (
    <SubsystemLookupContext.Provider value={lookup}>
      <div className="print-document">
        <style>{`@page { size: ${PAPER[options.paper].css}; margin: ${PAGE_MARGIN_MM}mm; }`}</style>
        {pages.map((page, i) => {
          const rows = options.parameters ? parameterRows(page.sheet) : [];
          return (
            <div key={page.key} className="print-sheet">
              <SheetPage doc={doc} page={page} index={i} count={pages.length} options={options} printed={printed} />
              {rows.length > 0 && (
                <section className="print-parameters" style={{ width: box.width }}>
                  <h2>
                    {page.title} · parameters
                    <span>{page.where || 'Top level'}</span>
                  </h2>
                  <table>
                    <thead>
                      <tr>
                        <th>Block</th>
                        <th>Parameter</th>
                        <th>Value</th>
                        <th>Unit</th>
                      </tr>
                    </thead>
                    <tbody>
                      {rows.map((row, k) => {
                        const same = k > 0 && rows[k - 1].block === row.block;
                        return (
                          <tr key={k} className={same ? 'is-same' : ''}>
                            <td>{same ? '' : row.block}</td>
                            <td>{row.parameter}</td>
                            <td>{row.value}</td>
                            <td>{row.unit}</td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </section>
              )}
            </div>
          );
        })}
      </div>
    </SubsystemLookupContext.Provider>
  );
}
