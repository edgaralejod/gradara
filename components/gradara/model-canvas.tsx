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
  useStoreApi,
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
import { sheetBounds } from '@/lib/gradara/sheet-bounds';
import type { ModelSelection } from '@/lib/gradara/selection';
import CopyDragLayer from './copy-drag-layer';
import {
  SelectionPreviewContext,
  type SelectionPreview,
} from './selection-preview-context';

const nodeTypes = { block: BlockNode };
export const FIT_VIEW = { padding: 0.16, maxZoom: 1.15 };
/** Ask the open canvas to fit the whole sheet (the fit button, or a tap on Space). */
export const FIT_VIEW_EVENT = 'gradara:fit-view';

type ViewState = {
  /** The view shows the whole sheet and should keep doing so when the canvas resizes. */
  fitted: boolean;
};

/**
 * Screen space kept clear when fitting: the zoom controls on the left, the Ask agent
 * button above, the hint line below, plus a margin so nothing touches an edge.
 */
const FIT_INSET = { left: 56, right: 56, top: 60, bottom: 44 };

/**
 * Frame the whole sheet: blocks, names, wires (loops around the blocks included), and
 * notes, clear of the canvas overlays, with the zoom capped so a small sheet is not
 * blown up.
 */
function fitSheet(
  flow: ReturnType<typeof useReactFlow>,
  project: React.RefObject<Project>,
  size: { width: number; height: number },
  duration = 0,
) {
  const bounds = sheetBounds(project.current);
  if (!bounds || !size.width || !size.height)
    return void flow.fitView({ ...FIT_VIEW, duration });
  const width = Math.max(80, size.width - FIT_INSET.left - FIT_INSET.right);
  const height = Math.max(80, size.height - FIT_INSET.top - FIT_INSET.bottom);
  const zoom = Math.max(
    0.25,
    Math.min(
      FIT_VIEW.maxZoom,
      width / Math.max(1, bounds.width),
      height / Math.max(1, bounds.height),
    ),
  );
  void flow.setViewport(
    {
      x: FIT_INSET.left + (width - bounds.width * zoom) / 2 - bounds.x * zoom,
      y: FIT_INSET.top + (height - bounds.height * zoom) / 2 - bounds.y * zoom,
      zoom,
    },
    { duration },
  );
}

/**
 * Keep the model in view when the space around the canvas changes (library,
 * inspector, or Problems dock opened or closed, window resized). A fitted view
 * refits; a view the user panned or zoomed keeps the same point at its center.
 */
function ViewportKeeper({
  view,
  project,
}: {
  view: React.RefObject<ViewState>;
  project: React.RefObject<Project>;
}) {
  const width = useStore((s) => s.width);
  const height = useStore((s) => s.height);
  const flow = useReactFlow();
  const store = useStoreApi();
  const last = useRef<{ width: number; height: number } | null>(null);
  useEffect(() => {
    const fit = () => {
      view.current.fitted = true;
      fitSheet(flow, project, store.getState(), 200);
    };
    window.addEventListener(FIT_VIEW_EVENT, fit);
    return () => window.removeEventListener(FIT_VIEW_EVENT, fit);
  }, [flow, view, project, store]);
  useEffect(() => {
    const previous = last.current;
    last.current = { width, height };
    if (!previous || !width || !height) return;
    if (previous.width === width && previous.height === height) return;
    // Wait for the layout to settle (panels slide), then adjust once.
    const timer = setTimeout(() => {
      if (view.current.fitted) {
        fitSheet(flow, project, { width, height }, 150);
        return;
      }
      const { x, y, zoom } = flow.getViewport();
      void flow.setViewport({
        x: x + (width - previous.width) / 2,
        y: y + (height - previous.height) / 2,
        zoom,
      });
    }, 80);
    return () => clearTimeout(timer);
  }, [width, height, flow, view, project]);
  return null;
}

function InitialViewport({
  blockIds,
  sheet = '',
  view,
  project,
}: {
  blockIds: string;
  sheet?: string;
  view: React.RefObject<ViewState>;
  project: React.RefObject<Project>;
}) {
  const documentReady = useStore(
    (s) => s.nodes.map((n) => n.id).join('|') === blockIds,
  );
  const initialized = useNodesInitialized();
  const hasViewport = useStore((s) => s.width > 0 && s.height > 0);
  const flow = useReactFlow();
  const store = useStoreApi();
  // Fit once per sheet: on open, and again when entering or leaving a subsystem.
  const fitted = useRef<string | null>(null);
  useEffect(() => {
    if (
      !documentReady ||
      !initialized ||
      !hasViewport ||
      fitted.current === sheet
    )
      return;
    const frame = requestAnimationFrame(() => {
      fitted.current = sheet;
      view.current.fitted = true;
      fitSheet(flow, project, store.getState());
    });
    return () => cancelAnimationFrame(frame);
  }, [
    documentReady,
    initialized,
    hasViewport,
    flow,
    sheet,
    view,
    project,
    store,
  ]);
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
  /** The open sheet (subsystem path); the view refits when it changes. */
  sheet?: string;
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
  sheet,
  ...props
}: Props) {
  const [preview, setPreview] = useState<SelectionPreview | null>(null);
  const view = useRef<ViewState>({ fitted: true });
  // What fit to view frames: the sheet as drawn, read when a fit happens.
  const latestProject = useRef(project);
  useEffect(() => {
    latestProject.current = project;
  }, [project]);
  const { onMoveStart, onMoveEnd } = props;
  const moveStart = useCallback<NonNullable<ReactFlowProps['onMoveStart']>>(
    (event, viewport) => {
      // A pan or zoom by the user ends the fitted state; programmatic moves carry no event.
      if (event) view.current.fitted = false;
      onMoveStart?.(event, viewport);
    },
    [onMoveStart],
  );
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
          onMoveStart={moveStart}
          onMoveEnd={onMoveEnd}
        >
          <ViewportKeeper view={view} project={latestProject} />
          <InitialViewport
            blockIds={blocks.map((b) => b.id).join('|')}
            sheet={sheet}
            view={view}
            project={latestProject}
          />
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
