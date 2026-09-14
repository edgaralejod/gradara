'use client';
import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
} from 'react';
import {
  ReactFlow,
  useNodesInitialized,
  useReactFlow,
  useStore,
  type ReactFlowProps,
  type NodeChange,
} from '@xyflow/react';
import BlockNode from './block-node';
import { snapDraggedBlockPosition } from '@/lib/gradara/placement';
import { LabelEditingContext } from './label-editing-context';
import {
  CanvasGestures,
  reconcileNodes,
  type BlockLayout,
  type CanvasNode,
} from '@/lib/gradara/canvas';
import type { Block, Project } from '@/lib/gradara/model';
import type { ModelSelection } from '@/lib/gradara/selection';
import CopyDragLayer from './copy-drag-layer';
import {
  SelectionPreviewContext,
  type SelectionPreview,
} from './selection-preview-context';

const nodeTypes = { block: BlockNode };
function InitialViewport({ blockIds }: { blockIds: string }) {
  const documentReady = useStore(
    (s) => s.nodes.map((n) => n.id).join('|') === blockIds,
  );
  const initialized = useNodesInitialized();
  const hasViewport = useStore((s) => s.width > 0 && s.height > 0);
  const flow = useReactFlow();
  const fitted = useRef(false);
  useEffect(() => {
    if (!documentReady || !initialized || !hasViewport || fitted.current)
      return;
    const frame = requestAnimationFrame(() => {
      fitted.current = true;
      void flow.fitView({ padding: 0.16, maxZoom: 1.15 });
    });
    return () => cancelAnimationFrame(frame);
  }, [documentReady, initialized, hasViewport, flow]);
  return null;
}
type Props = Omit<
  ReactFlowProps<CanvasNode>,
  'nodes' | 'onNodesChange' | 'nodeTypes'
> & {
  blocks: Block[];
  project: Project;
  selection: ModelSelection;
  onCopyDrop: (preview: SelectionPreview) => void;
  selectedIds: string[];
  onSelectedIdsChange: (ids: string[]) => void;
  onLayout: (layouts: BlockLayout[]) => void;
  onLabelOffset: (id: string, offset: Block['labelOffset']) => void;
  onLabelSelect: (id: string) => void;
};

/** Pointer-rate state belongs to the canvas, not autosave, history, inspector, or plots. */
export default function ModelCanvas({
  blocks: documentBlocks,
  selectedIds: documentSelectedIds,
  project,
  selection,
  onCopyDrop,
  onSelectedIdsChange,
  onLayout,
  onLabelOffset,
  onLabelSelect,
  ...props
}: Props) {
  const [preview, setPreview] = useState<SelectionPreview | null>(null);
  const blocks = preview?.project.blocks ?? documentBlocks;
  const selectedIds = preview?.selection.blockIds ?? documentSelectedIds;
  const [nodes, setNodes] = useState<CanvasNode[]>(() =>
    reconcileNodes([], [], blocks, selectedIds),
  );
  const nodesRef = useRef(nodes);
  const previousBlocks = useRef(blocks);
  const gestures = useRef(new CanvasGestures());
  const paintFrame = useRef<number | null>(null);
  const labelEditing = useMemo(
    () => ({ onMove: onLabelOffset, onSelect: onLabelSelect }),
    [onLabelOffset, onLabelSelect],
  );
  useEffect(
    () => () => {
      if (paintFrame.current !== null) cancelAnimationFrame(paintFrame.current);
    },
    [],
  );
  useLayoutEffect(() => {
    const blocksNodes = reconcileNodes(
      nodesRef.current,
      previousBlocks.current,
      blocks,
      selectedIds,
    );
    previousBlocks.current = blocks;
    const next = blocksNodes;
    if (
      next.length === nodesRef.current.length &&
      next.every((n, i) => n === nodesRef.current[i])
    )
      return;
    nodesRef.current = next;
    setNodes(next);
  }, [blocks, selectedIds]);

  const onNodesChange = useCallback(
    (changes: NodeChange<CanvasNode>[]) => {
      const { nodes: next, layouts } = gestures.current.apply(
        changes,
        nodesRef.current,
        (node, position) => {
          const snapped = snapDraggedBlockPosition(
            project,
            node.id,
            position,
            documentSelectedIds,
          );
          return snapped;
        },
      );
      nodesRef.current = next;
      // Measurement callbacks run inside ResizeObserver delivery. Paint on the
      // next frame, never trigger another layout while that delivery is active.
      if (paintFrame.current === null) {
        paintFrame.current = requestAnimationFrame(() => {
          paintFrame.current = null;
          setNodes(nodesRef.current);
        });
      }
      if (changes.some((c) => c.type === 'select')) {
        const ids = next.filter((n) => n.selected).map((n) => n.id);
        onSelectedIdsChange(ids);
      }
      if (layouts.length) onLayout(layouts);
    },
    [onSelectedIdsChange, onLayout, project, documentSelectedIds],
  );

  return (
    <SelectionPreviewContext.Provider value={preview}>
      <LabelEditingContext.Provider value={labelEditing}>
        <ReactFlow
          {...props}
          snapToGrid={false}
          nodes={nodes}
          nodeTypes={nodeTypes}
          onNodesChange={onNodesChange}
        >
          <InitialViewport blockIds={blocks.map((b) => b.id).join('|')} />
          <CopyDragLayer
            project={project}
            selection={selection}
            onPreview={setPreview}
            onCommit={onCopyDrop}
          />
          {props.children}
          {preview && (
            <div className="copy-drag-hint">
              Copy{' '}
              {preview.selection.blockIds.length === 1 ? 'block' : 'selection'}{' '}
              · Release to place · Esc to cancel
            </div>
          )}
        </ReactFlow>
      </LabelEditingContext.Provider>
    </SelectionPreviewContext.Provider>
  );
}
