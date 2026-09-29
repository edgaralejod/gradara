'use client';
import { Fragment, useState } from 'react';
import {
  ArrowLeft,
  ArrowRight,
  ArrowUp,
  ChevronRight,
  PanelLeft,
  Boxes,
  Box,
} from 'lucide-react';
import type { Project } from '@/lib/gradara/model';
import {
  breadcrumb,
  hierarchyTree,
  type HierarchyNode,
} from '@/lib/gradara/hierarchy';

const samePath = (a: string[], b: string[]) =>
  a.length === b.length && a.every((x, i) => x === b[i]);

function Tree({
  node,
  scope,
  depth,
  onNavigate,
}: {
  node: HierarchyNode;
  scope: string[];
  depth: number;
  onNavigate: (path: string[]) => void;
}) {
  const here = samePath(node.path, scope);
  return (
    <li>
      <button
        type="button"
        className={here ? 'is-current' : ''}
        aria-current={here ? 'page' : undefined}
        style={{ paddingLeft: 6 + depth * 14 }}
        title={node.name}
        onClick={() => onNavigate(node.path)}
      >
        {depth === 0 ? <Boxes size={13} /> : <Box size={13} />}
        <span className="hierarchy-name">
          {depth === 0 ? 'Top level' : node.name}
        </span>
        {node.variant && (
          <span className="hierarchy-variant">{node.variant}</span>
        )}
      </button>
      {node.children.length > 0 && (
        <ul>
          {node.children.map((child) => (
            <Tree
              key={child.path.join('/')}
              node={child}
              scope={scope}
              depth={depth + 1}
              onNavigate={onNavigate}
            />
          ))}
        </ul>
      )}
    </li>
  );
}

/**
 * Simulink's explorer bar over the canvas: back, forward, and up to the parent, the
 * path to the open subsystem (click a level to go there), and the Model Browser: the
 * whole hierarchy as a tree you can jump through.
 */
export default function HierarchyBar({
  doc,
  scope,
  canBack,
  canForward,
  onBack,
  onForward,
  onNavigate,
}: {
  doc: Project;
  scope: string[];
  canBack: boolean;
  canForward: boolean;
  onBack: () => void;
  onForward: () => void;
  onNavigate: (path: string[]) => void;
}) {
  const [browser, setBrowser] = useState(false);
  const crumbs = breadcrumb(doc, scope);
  const tree = browser ? hierarchyTree(doc) : undefined;
  return (
    <div className="hierarchy-bar-wrap">
      <nav className="hierarchy-bar" aria-label="Model hierarchy">
        <button
          type="button"
          className={browser ? 'is-on' : ''}
          aria-pressed={browser}
          title="Model hierarchy"
          aria-label="Show the model hierarchy"
          onClick={() => setBrowser((b) => !b)}
        >
          <PanelLeft size={14} />
        </button>
        <button
          type="button"
          title="Back"
          aria-label="Back"
          disabled={!canBack}
          onClick={onBack}
        >
          <ArrowLeft size={14} />
        </button>
        <button
          type="button"
          title="Forward"
          aria-label="Forward"
          disabled={!canForward}
          onClick={onForward}
        >
          <ArrowRight size={14} />
        </button>
        <button
          type="button"
          title="Up to parent · Esc or ⌘/Ctrl + ↑"
          aria-label="Up to parent"
          disabled={!scope.length}
          onClick={() => onNavigate(scope.slice(0, -1))}
        >
          <ArrowUp size={14} />
        </button>
        <span className="hierarchy-path">
          {crumbs.map((crumb, i) => (
            <Fragment key={crumb.path.join('/') || 'top'}>
              {i > 0 && <ChevronRight size={12} />}
              {i === crumbs.length - 1 ? (
                <span aria-current="page">
                  {i === 0 ? 'Top level' : crumb.name}
                </span>
              ) : (
                <button type="button" onClick={() => onNavigate(crumb.path)}>
                  {i === 0 ? 'Top level' : crumb.name}
                </button>
              )}
            </Fragment>
          ))}
        </span>
      </nav>
      {tree && (
        <div className="hierarchy-tree" aria-label="Model hierarchy">
          <ul>
            <Tree node={tree} scope={scope} depth={0} onNavigate={onNavigate} />
          </ul>
          {!tree.children.length && (
            <p className="size-hint">
              No subsystems yet. Select blocks and press ⌘G, or add a Subsystem
              from the library.
            </p>
          )}
        </div>
      )}
    </div>
  );
}
