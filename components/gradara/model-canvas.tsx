'use client';
import {
  useCallback,
  useEffect,
  useLayoutEffect,
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
import JunctionNode from './junction-node';
import SignalEdge from './signal-edge';
import {
  CanvasGestures,
  reconcileNodes,
  type BlockLayout,
  type CanvasNode,
} from '@/lib/gradara/canvas';
import type { Block, Junction } from '@/lib/gradara/model';
import { TAP_SIZE } from '@/lib/gradara/net';

const edgeTypes = { signal: SignalEdge };
const nodeTypes = { block: BlockNode, tap: JunctionNode };
const noJunctions: Junction[] = [];

function sameTap(a: CanvasNode | undefined, b: Junction, selected: boolean) {
  return (
    a?.type === 'tap' &&
    a.position.x === b.position.x - TAP_SIZE / 2 &&
    a.position.y === b.position.y - TAP_SIZE / 2 &&
    a.selected === selected &&
    a.data.domain === b.domain
  );
}
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
  junctions?: Junction[];
  selectedIds: string[];
  onSelectedIdsChange: (ids: string[]) => void;
  onLayout: (layouts: BlockLayout[]) => void;
};

/** Pointer-rate state belongs to the canvas, not autosave, history, inspector, or plots. */
export default function ModelCanvas({
  blocks,
  junctions = noJunctions,
  selectedIds,
  onSelectedIdsChange,
  onLayout,
  ...props
}: Props) {
  const [nodes, setNodes] = useState<CanvasNode[]>(() =>
    reconcileNodes([], [], blocks, selectedIds),
  );
  const nodesRef = useRef(nodes);
  const previousBlocks = useRef(blocks);
  const gestures = useRef(new CanvasGestures());
  const paintFrame = useRef<number | null>(null);
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
    const selected = new Set(selectedIds);
    const existing = new Map(nodesRef.current.map((n) => [n.id, n]));
    const taps = junctions.map((j) => {
      const prev = existing.get(j.id);
      if (sameTap(prev, j, selected.has(j.id))) return prev!;
      return {
        id: j.id,
        type: 'tap' as const,
        position: {
          x: j.position.x - TAP_SIZE / 2,
          y: j.position.y - TAP_SIZE / 2,
        },
        width: TAP_SIZE,
        height: TAP_SIZE,
        selected: selected.has(j.id),
        data: { domain: j.domain },
        draggable: true,
        connectable: true,
      };
    });
    previousBlocks.current = blocks;
    const next = [...blocksNodes, ...taps];
    if (
      next.length === nodesRef.current.length &&
      next.every((n, i) => n === nodesRef.current[i])
    )
      return;
    nodesRef.current = next;
    setNodes(next);
  }, [blocks, junctions, selectedIds]);

  const onNodesChange = useCallback(
    (changes: NodeChange<CanvasNode>[]) => {
      const { nodes: next, layouts } = gestures.current.apply(
        changes,
        nodesRef.current,
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
    [onSelectedIdsChange, onLayout],
  );

  return (
    <ReactFlow
      {...props}
      nodes={nodes}
      nodeTypes={nodeTypes}
      edgeTypes={edgeTypes}
      onNodesChange={onNodesChange}
    >
      <InitialViewport
        blockIds={[...blocks.map((b) => b.id), ...junctions.map((j) => j.id)].join(
          '|',
        )}
      />
      {props.children}
    </ReactFlow>
  );
}
