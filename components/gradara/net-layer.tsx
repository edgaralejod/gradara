'use client';
import {
  useCallback,
  useContext,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
} from 'react';
import {
  ViewportPortal,
  useReactFlow,
  useStore,
  useStoreApi,
} from '@xyflow/react';
import { domainColors, type Project } from '@/lib/gradara/model';
import { endpointPoint, endpointPort, isTap } from '@/lib/gradara/net';
import { NetSession } from '@/lib/gradara/net-session';
import {
  polylineOfWire,
  hitPort,
  hitSegment,
  type Anchor,
} from '@/lib/gradara/net-draw';
import { pointsToPath, type Pt } from '@/lib/gradara/routing';
import { removeSelection } from '@/lib/gradara/project';
import {
  editingAnchors,
  snappedVertex,
  snappedSegment,
} from '@/lib/gradara/net-edit';
import { resetWireRoute } from '@/lib/gradara/wires';
import { normalizeJunctions } from '@/lib/gradara/net-layout';
import { blockSize } from '@/lib/gradara/canvas';
import {
  layoutSelection,
  resolveSelection,
  translateSelection,
  selectionInRect,
  type ModelSelection,
} from '@/lib/gradara/selection';
import { PencilLine, Route, Trash2, Check, X } from 'lucide-react';
import { SelectionPreviewContext } from './selection-preview-context';
import { netForWire, renameNet } from '@/lib/gradara/net-registry';
import { netDisplayName } from '@/lib/gradara/names';
import {
  labelPosition,
  nearestLabelAnchor,
  setNetLabel,
  type LabelAnchor,
} from '@/lib/gradara/net-label';
import NetLabel from './net-label';

type Props = {
  project: Project;
  selected: string[];
  selection: ModelSelection;
  groupSelection: boolean;
  onRegionSelect: (selection: ModelSelection) => void;
  onSelect: (ids: string[], additive?: boolean) => void;
  onDeleteSelection: () => void;
  onCommit: (project: Project) => void;
};
type Gesture = {
  kind:
    | 'wire'
    | 'junction'
    | 'vertex'
    | 'drawing'
    | 'port'
    | 'segment'
    | 'endpoint';
  selection?: ModelSelection;
  id?: string;
  vertex?: number;
  segment?: number;
  anchors?: Anchor[];
  pointer: number;
  at: Pt;
  screen: Pt;
  initial: Project;
  moved: boolean;
};

function viewOf(session: NetSession, editing = false) {
  return {
    mode: session.mode,
    project: session.project,
    preview: session.preview(),
    guides: session.guides,
    corners: [...session.corners],
    target: session.target,
    domain: session.domain,
    cursor: session.cursor,
    editing,
    wireEdit: session.editing,
  };
}

/** The sole wiring pointer owner. Pointer-rate state stays below the workbench. */
export default function NetLayer(baseProps: Props) {
  const copyPreview = useContext(SelectionPreviewContext);
  const props = useMemo(
    () =>
      copyPreview
        ? {
            ...baseProps,
            ...copyPreview,
            selected: copyPreview.selection.wireIds,
            groupSelection: true,
          }
        : baseProps,
    [baseProps, copyPreview],
  );
  const flow = useReactFlow();
  const store = useStoreApi();
  // ViewportPortal mounts after React Flow publishes its DOM root. Observe that
  // root directly so new/switched models rebind listeners even when `flow` stays
  // stable in the shared provider; reading the portal's SVG ref once can miss it.
  const canvasRoot = useStore((s) => s.domNode);
  const nodes = useStore((s) => s.nodes);
  const zoom = useStore((s) => s.transform[2]);
  const scene = useMemo(
    () =>
      normalizeJunctions(
        layoutSelection(
          props.project,
          props.project.blocks.map((b) => {
            const node = nodes.find((n) => n.id === b.id);
            return node
              ? {
                  id: b.id,
                  position: node.position,
                  size: {
                    width:
                      node.measured?.width ?? node.width ?? b.size?.width ?? 64,
                    height:
                      node.measured?.height ??
                      node.height ??
                      b.size?.height ??
                      64,
                  },
                }
              : { id: b.id, position: b.position, size: blockSize(b) };
          }),
          props.selection,
          false,
        ),
      ),
    [props, nodes],
  );
  const selectedGeometry = useMemo(
    () => resolveSelection(props.project, props.selection),
    [props],
  );
  const latest = useRef({ ...props, scene });
  useLayoutEffect(() => {
    latest.current = { ...props, scene };
  }, [props, scene]);
  const session = useRef(new NetSession(scene));
  const gesture = useRef<Gesture | null>(null);
  const frame = useRef<number | null>(null);
  const commands = useRef<(action: string) => void>(() => {});
  const [view, setView] = useState(() => viewOf(new NetSession(scene)));
  const [message, setMessage] = useState('');
  const [hover, setHover] = useState<string | null>(null);
  const [editingNet, setEditingNet] = useState<{
    id: string;
    anchor: LabelAnchor;
  } | null>(null);
  const repaint = useCallback(() => {
    if (frame.current === null)
      frame.current = requestAnimationFrame(() => {
        frame.current = null;
        setView(
          viewOf(
            session.current,
            gesture.current?.kind === 'junction' ||
              gesture.current?.kind === 'vertex' ||
              gesture.current?.kind === 'segment',
          ),
        );
      });
  }, []);
  useEffect(() => {
    // Observe the same marquee as React Flow, in world coordinates. Wires are
    // rendered in SVG, so React Flow cannot add them to its node selection.
    return store.subscribe((state, previous) => {
      const rect = state.userSelectionRect;
      if (
        !state.userSelectionActive ||
        !rect ||
        rect === previous.userSelectionRect
      )
        return;
      const [x, y, z] = state.transform;
      latest.current.onRegionSelect(
        selectionInRect(latest.current.project, {
          x: (rect.x - x) / z,
          y: (rect.y - y) / z,
          width: rect.width / z,
          height: rect.height / z,
        }),
      );
    });
  }, [store]);
  useEffect(() => {
    session.current.cancel();
    const root = store.getState().domNode;
    if (root) root.dataset.wiring = 'idle';
    session.current.project = latest.current.scene;
    gesture.current = null;
    repaint();
  }, [props.project, repaint, canvasRoot, store]);
  useEffect(() => {
    const root = store.getState().domNode;
    if (!root) return;
    let suppressClick = false;
    let lastWireClick: {
      id: string;
      time: number;
      x: number;
      y: number;
    } | null = null;
    const stop = (e: Event) => {
      e.preventDefault();
      e.stopPropagation();
      e.stopImmediatePropagation();
    };
    const point = (e: PointerEvent) =>
      flow.screenToFlowPosition(
        { x: e.clientX, y: e.clientY },
        { snapToGrid: false },
      );
    const refresh = () => {
      root.dataset.wiring = session.current.mode;
      repaint();
    };
    const commit = (selectId?: string, includeBlocks = false) => {
      const s = session.current;
      // Preserve the document's blocks: transient React Flow measurements are view state.
      if (
        s.project.wires !== latest.current.project.wires ||
        s.project.junctions !== latest.current.project.junctions ||
        (includeBlocks && s.project.blocks !== latest.current.project.blocks)
      ) {
        latest.current.onCommit({
          ...s.project,
          blocks: includeBlocks
            ? s.project.blocks
            : latest.current.project.blocks,
        });
        if (selectId && s.project.wires.some((w) => w.id === selectId))
          latest.current.onSelect([selectId]);
      }
      setMessage('');
      refresh();
    };
    const attempt = (action: () => void) => {
      const editedId = session.current.editing?.wire.id;
      const wasDrawing = session.current.mode !== 'idle';
      try {
        action();
        setMessage('');
        if (session.current.mode === 'idle')
          commit(
            editedId ??
              (wasDrawing
                ? session.current.project.wires.at(-1)?.id
                : undefined),
          );
      } catch (error) {
        setMessage((error as Error).message);
      }
      refresh();
    };
    const down = (e: PointerEvent) => {
      if (e.button !== 0 || !root.contains(e.target as Node)) return;
      if (root.dataset.copying) return;
      // A captured drag may not produce a browser click. Never swallow the next gesture.
      if (session.current.mode === 'idle') suppressClick = false;
      const target = e.target as Element;
      if (
        target.closest(
          '.react-flow__controls,.react-flow__minimap,.net-toolbar,.block-name,.net-label',
        )
      )
        return;
      const s = session.current;
      s.zoom = flow.getZoom();
      const at = point(e);
      if (s.mode !== 'idle') {
        stop(e);
        suppressClick = true;
        gesture.current = {
          kind: 'drawing',
          pointer: e.pointerId,
          at,
          screen: { x: e.clientX, y: e.clientY },
          initial: s.project,
          moved: false,
        };
        attempt(() => s.click(at));
        return;
      }
      const port = target.closest<HTMLElement>('[data-port-id]');
      const junction = target.closest<SVGElement>('[data-junction-id]');
      const vertex = target.closest<SVGElement>('[data-wire-vertex]');
      const endpoint = target.closest<SVGElement>('[data-wire-end]');
      const segment = target.closest<SVGElement>('[data-wire-segment]');
      const wire = target.closest<SVGElement>('[data-wire-id]');
      const near =
        !junction && !vertex && !endpoint && !segment
          ? hitPort(latest.current.scene, at, 9 / s.zoom)
          : undefined;
      const pin =
        !endpoint && !segment && port
          ? { id: port.dataset.blockId!, handle: port.dataset.portId! }
          : near && !isTap(latest.current.scene, near.id)
            ? near
            : undefined;
      if (!pin && !junction && !wire && !vertex) return;
      stop(e);
      // Transfer keyboard ownership from a previously focused block label.
      root.tabIndex = -1;
      root.focus({ preventScroll: true });
      suppressClick = true;
      setMessage('');
      s.project = latest.current.scene;
      const g: Gesture = {
        kind: 'port',
        pointer: e.pointerId,
        at,
        screen: { x: e.clientX, y: e.clientY },
        initial: s.project,
        moved: false,
      };
      const selected = resolveSelection(
        latest.current.project,
        latest.current.selection,
      );
      const groupHit =
        !e.altKey &&
        !e.shiftKey &&
        !e.metaKey &&
        !e.ctrlKey &&
        latest.current.groupSelection &&
        ((wire && selected.wireIds.includes(wire.dataset.wireId!)) ||
          (junction &&
            selected.junctionIds.includes(junction.dataset.junctionId!)));
      if (groupHit) {
        g.kind = 'segment';
        g.id = wire?.dataset.wireId;
        g.selection = latest.current.selection;
        g.initial = latest.current.project;
      } else if (endpoint) {
        g.kind = 'endpoint';
        g.id = endpoint.dataset.wireId;
        s.reconnect(g.id!, endpoint.dataset.wireEnd as 'source' | 'target');
        s.move(at.x, at.y);
      } else if (pin) s.pressPort(pin.id, pin.handle);
      else if (junction) {
        g.kind = 'junction';
        g.id = junction.dataset.junctionId;
        if (e.altKey) {
          s.pressJunction(g.id!, at);
          g.kind = 'port';
        }
      } else if (vertex) {
        g.kind = 'vertex';
        g.id = vertex.dataset.wireId;
        g.vertex = Number(vertex.dataset.wireVertex);
        g.anchors = editingAnchors(s.project, g.id!);
      } else {
        g.kind =
          !e.altKey &&
          (segment || latest.current.selected.includes(wire!.dataset.wireId!))
            ? 'segment'
            : 'wire';
        g.id = wire!.dataset.wireId;
        if (g.kind === 'segment') {
          g.segment = segment
            ? Number(segment.dataset.wireSegment)
            : hitSegment(
                s.project,
                at,
                12 / s.zoom,
                s.project.wires.filter((w) => w.id !== g.id).map((w) => w.id),
              )?.segment;
          g.anchors = editingAnchors(s.project, g.id!);
        }
        latest.current.onSelect(
          e.shiftKey || e.metaKey || e.ctrlKey
            ? [...new Set([...latest.current.selected, g.id!])]
            : [g.id!],
          e.shiftKey || e.metaKey || e.ctrlKey,
        );
      }
      gesture.current = g;
      root.setPointerCapture(e.pointerId);
      refresh();
    };
    const move = (e: PointerEvent) => {
      const s = session.current,
        g = gesture.current;
      if (g && g.pointer !== e.pointerId) return;
      if (!g && s.mode === 'idle') return;
      // The wiring gesture owns movement as well as the press/release. Letting
      // React Flow see these moves can activate a pending marquee selection.
      stop(e);
      const at = point(e);
      s.zoom = flow.getZoom();
      if (g && Math.hypot(e.clientX - g.screen.x, e.clientY - g.screen.y) > 5)
        g.moved = true;
      if (g?.kind === 'wire' && g.moved && s.mode === 'idle')
        s.pressSegment(g.at);
      if (g?.selection && g.moved) {
        const delta = {
          x: Math.round((at.x - g.at.x) / 4) * 4,
          y: Math.round((at.y - g.at.y) / 4) * 4,
        };
        s.project = translateSelection(g.initial, g.selection, delta);
        const positions = new Map(
          s.project.blocks.map((b) => [b.id, b.position]),
        );
        flow.setNodes((nodes) =>
          nodes.map((n) =>
            positions.has(n.id) ? { ...n, position: positions.get(n.id)! } : n,
          ),
        );
      } else if (g?.kind === 'junction' && g.moved) {
        const old = g.initial.junctions?.find((j) => j.id === g.id);
        if (!old) return;
        s.project = g.initial;
        s.moveJunction(
          g.id!,
          Math.round((old.position.x + at.x - g.at.x) / 4) * 4,
          Math.round((old.position.y + at.y - g.at.y) / 4) * 4,
        );
      } else if (g?.kind === 'segment' && g.moved && g.segment !== undefined) {
        const a = polylineOfWire(g.initial, g.id!)[g.segment];
        const result = snappedSegment(
          g.initial,
          g.id!,
          g.segment,
          { x: a.x + at.x - g.at.x, y: a.y + at.y - g.at.y },
          s.zoom,
          g.anchors,
        );
        s.project = result.project;
        s.guides = result.guides;
        s.cursor = at;
      } else if (g?.kind === 'vertex' && g.moved) {
        const result = snappedVertex(
          g.initial,
          g.id!,
          g.vertex!,
          at,
          s.zoom,
          g.anchors,
        );
        s.project = result.project;
        s.guides = result.guides;
        s.cursor = at;
      } else if (s.mode !== 'idle') s.move(at.x, at.y);
      refresh();
    };
    const up = (e: PointerEvent) => {
      const g = gesture.current;
      if (!g || g.pointer !== e.pointerId) return;
      stop(e);
      gesture.current = null;
      if (root.hasPointerCapture(e.pointerId))
        root.releasePointerCapture(e.pointerId);
      const s = session.current;
      // Pointer capture retargets the browser's dblclick to the canvas root.
      // Recognize clicks here, where the originally hit wire is still known.
      if (!g.moved && g.id && (g.kind === 'wire' || g.kind === 'segment')) {
        if (
          lastWireClick?.id === g.id &&
          e.timeStamp - lastWireClick.time < 450 &&
          Math.hypot(e.clientX - lastWireClick.x, e.clientY - lastWireClick.y) <
            6
        ) {
          lastWireClick = null;
          nameWire(g.id, point(e));
          refresh();
          return;
        }
        lastWireClick = {
          id: g.id,
          time: e.timeStamp,
          x: e.clientX,
          y: e.clientY,
        };
      } else lastWireClick = null;
      if (g.kind === 'drawing') {
        refresh();
        return;
      }
      if (
        g.kind === 'junction' ||
        g.kind === 'vertex' ||
        g.kind === 'segment'
      ) {
        s.guides = [];
        if (g.moved) commit(undefined, !!g.selection);
        else if (g.kind === 'junction') {
          s.pressJunction(g.id!);
          s.mode = 'drawing';
          refresh();
        }
        return;
      }
      if (s.mode === 'connecting') {
        if (!g.moved && g.kind === 'port') s.mode = 'drawing';
        else if (!g.moved && g.kind === 'endpoint') s.cancel();
        else attempt(() => s.release(point(e)));
      }
      refresh();
    };
    const cancel = () => {
      const g = gesture.current;
      if (g && root.hasPointerCapture(g.pointer))
        root.releasePointerCapture(g.pointer);
      session.current.cancel();
      if (g?.selection) {
        const positions = new Map(
          g.initial.blocks.map((b) => [b.id, b.position]),
        );
        flow.setNodes((nodes) =>
          nodes.map((n) =>
            positions.has(n.id) ? { ...n, position: positions.get(n.id)! } : n,
          ),
        );
      }
      session.current.project = latest.current.scene;
      gesture.current = null;
      suppressClick = false;
      setMessage('');
      refresh();
    };
    const key = (e: KeyboardEvent) => {
      if (
        (e.target as Element)?.closest(
          'input,textarea,[contenteditable=true],[role=dialog],.block-name,.net-label',
        )
      )
        return;
      const s = session.current;
      if (s.mode !== 'idle' || gesture.current) {
        if (
          e.key === 'Escape' ||
          ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'z')
        ) {
          stop(e);
          cancel();
        } else if (e.key === 'Backspace') {
          stop(e);
          s.unpin();
          setMessage('');
          refresh();
        } else if (e.key === 'Enter' && s.editing?.kind === 'redraw') {
          stop(e);
          attempt(() => s.finishRedraw());
        } else if (
          e.metaKey ||
          e.ctrlKey ||
          ['Delete', 'a', 'd', 'r', '/', 'Enter'].includes(e.key)
        )
          stop(e);
      } else if (e.key === 'F2' && latest.current.selected.length === 1) {
        stop(e);
        commands.current('name');
      } else if (
        e.key.toLowerCase() === 'd' &&
        !e.metaKey &&
        !e.ctrlKey &&
        latest.current.selected.length === 1
      ) {
        stop(e);
        commands.current('redraw');
      } else if (
        (e.key === 'Delete' || e.key === 'Backspace') &&
        latest.current.selected.length
      ) {
        stop(e);
        latest.current.onDeleteSelection();
      }
    };
    const click = (e: MouseEvent) => {
      if (!root.contains(e.target as Node)) return;
      if ((e.target as Element).closest('.net-toolbar,.net-label')) {
        suppressClick = false;
        return;
      }
      if (suppressClick || session.current.mode !== 'idle') {
        stop(e);
        suppressClick = false;
      }
    };
    const nameWire = (id: string, at?: Pt) => {
      const p = latest.current.scene,
        net = netForWire(p, id);
      if (!net) return;
      const anchor = at
        ? nearestLabelAnchor(p, net, at)
        : labelPosition(p, net)?.anchor;
      if (anchor)
        setEditingNet({
          id: net.id,
          anchor: net.name ? anchor : { ...anchor, side: 1 },
        });
    };
    const dblclick = (e: MouseEvent) => {
      const target = e.target as Element;
      if (target.closest('.net-label')) return;
      const wire = target.closest<SVGElement>('[data-wire-id]');
      if (
        session.current.mode === 'idle' &&
        wire &&
        !target.closest('[data-wire-end]')
      ) {
        stop(e);
        nameWire(
          wire.dataset.wireId!,
          flow.screenToFlowPosition(
            { x: e.clientX, y: e.clientY },
            { snapToGrid: false },
          ),
        );
      } else if (
        session.current.mode !== 'idle' ||
        target.closest('[data-junction-id],[data-port-id]')
      )
        stop(e);
    };
    commands.current = (action) => {
      const s = session.current;
      const id = latest.current.selected[0];
      if (action === 'cancel') {
        cancel();
        return;
      }
      if (action === 'finish') {
        attempt(() => s.finishRedraw());
        return;
      }
      if (s.mode !== 'idle' || !id) return;
      s.project = latest.current.scene;
      s.zoom = flow.getZoom();
      if (action === 'name') nameWire(id);
      if (action === 'redraw') {
        s.redraw(id);
        setMessage('');
        refresh();
      }
      if (action === 'auto') {
        s.project = resetWireRoute(s.project, id);
        commit();
      }
      if (action === 'delete') {
        s.project = removeSelection(s.project, [], latest.current.selected);
        commit();
        latest.current.onSelect([]);
      }
    };
    // React's delegated capture handlers run above .react-flow in the DOM.
    // Claim wiring presses at window capture, before Pane can start selecting
    // (or Shift-selecting) underneath a wire gesture. Unclaimed presses pass on.
    window.addEventListener('pointerdown', down, true);
    window.addEventListener('click', click, true);
    root.addEventListener('dblclick', dblclick, true);
    window.addEventListener('pointermove', move, true);
    window.addEventListener('pointerup', up, true);
    window.addEventListener('pointercancel', cancel, true);
    window.addEventListener('blur', cancel);
    window.addEventListener('keydown', key, true);
    return () => {
      window.removeEventListener('pointerdown', down, true);
      window.removeEventListener('click', click, true);
      root.removeEventListener('dblclick', dblclick, true);
      window.removeEventListener('pointermove', move, true);
      window.removeEventListener('pointerup', up, true);
      window.removeEventListener('pointercancel', cancel, true);
      window.removeEventListener('blur', cancel);
      window.removeEventListener('keydown', key, true);
      if (frame.current !== null) cancelAnimationFrame(frame.current);
      frame.current = null;
    };
  }, [flow, repaint, canvasRoot, store]);

  const s = view;
  const drawing = s.mode !== 'idle';
  const document = drawing || view.editing ? view.project : scene;
  const paths = useMemo(
    () =>
      document.wires.map((w) => ({
        wire: w,
        points: polylineOfWire(document, w.id),
        color:
          domainColors[
            endpointPort(document, w.source, w.sourceHandle, 'source')
              ?.domain ?? 'signal'
          ],
      })),
    [document],
  );
  const wireNets = useMemo(
    () =>
      new Map(
        (document.nets ?? []).flatMap((n) =>
          n.wireIds.map((id) => [id, n] as const),
        ),
      ),
    [document.nets],
  );
  const preview = s.preview;
  const destination =
    s.wireEdit &&
    endpointPoint(
      document,
      s.wireEdit.destination.id,
      s.wireEdit.destination.handle,
    );
  const singleSelection =
    !props.groupSelection &&
    props.selection.blockIds.length === 0 &&
    props.selected.length === 1 &&
    paths.some((p) => p.wire.id === props.selected[0]);
  return (
    <>
      <ViewportPortal>
        <svg
          className="net-layer"
          width="1"
          height="1"
          aria-label="Model wiring"
          data-mode={s.mode}
          data-group-selection={props.groupSelection || undefined}
        >
          <defs>
            <marker
              id="net-arrow"
              viewBox="0 0 10 10"
              refX="9"
              refY="5"
              markerWidth="6"
              markerHeight="6"
              orient="auto-start-reverse"
            >
              <path d="M 0 1 L 9 5 L 0 9 z" fill="context-stroke" />
            </marker>
          </defs>
          {s.wireEdit && (
            <path
              className="net-ghost"
              d={pointsToPath(s.wireEdit.originalPoints)}
            />
          )}
          {paths.map(({ wire: w, points, color }) => {
            const selected = selectedGeometry.wireIds.includes(w.id);
            return (
              <g
                key={w.id}
                data-wire-id={w.id}
                data-net-id={wireNets.get(w.id)?.id}
                data-net-name={
                  wireNets.get(w.id)
                    ? netDisplayName(document, wireNets.get(w.id)!)
                    : undefined
                }
                aria-label={`${wireNets.get(w.id) ? netDisplayName(document, wireNets.get(w.id)!) : 'Connection'} · ${wireNets.get(w.id)?.id ?? w.id}`}
                className={`net-wire ${selected ? 'is-selected' : ''} ${hover === w.id ? 'is-hovered' : ''}`}
                style={{ color }}
                onPointerEnter={() => setHover(w.id)}
                onPointerLeave={() => setHover(null)}
              >
                <path className="net-wire-halo" d={pointsToPath(points)} />
                <path
                  className="net-wire-ink"
                  d={pointsToPath(points)}
                  markerEnd={
                    endpointPort(document, w.target, w.targetHandle, 'target')
                      ?.direction === 'input' &&
                    !document.junctions?.some((j) => j.id === w.target)
                      ? 'url(#net-arrow)'
                      : undefined
                  }
                />
                {points.slice(0, -1).map((a, i) => (
                  <path
                    key={`hit-${i}`}
                    className={`net-wire-hit ${selected ? (a.y === points[i + 1].y ? 'axis-h' : 'axis-v') : ''}`}
                    d={pointsToPath([a, points[i + 1]])}
                  />
                ))}
                {selected &&
                  !props.groupSelection &&
                  !drawing &&
                  points
                    .slice(1, -1)
                    .map((p, i) => (
                      <rect
                        key={i}
                        data-wire-vertex={i + 1}
                        data-wire-id={w.id}
                        className="net-vertex"
                        x={p.x - 4 / zoom}
                        y={p.y - 4 / zoom}
                        width={8 / zoom}
                        height={8 / zoom}
                      />
                    ))}
              </g>
            );
          })}
          {(document.junctions ?? [])
            .filter(
              (j) =>
                document.wires.filter(
                  (w) => w.source === j.id || w.target === j.id,
                ).length >= 3,
            )
            .map((j) => (
              <g
                key={j.id}
                data-junction-id={j.id}
                className={`net-junction ${selectedGeometry.junctionIds.includes(j.id) ? 'is-selected' : ''}`}
                aria-label="Junction: drag to move, click to branch, Alt-drag to branch"
              >
                <title>Drag to move · Click or Alt-drag to branch</title>
                <circle
                  className="net-junction-hit"
                  cx={j.position.x}
                  cy={j.position.y}
                  r={10 / zoom}
                />
                <circle
                  cx={j.position.x}
                  cy={j.position.y}
                  r={3.3 / zoom}
                  fill={domainColors[j.domain]}
                />
              </g>
            ))}
          {!drawing &&
            !props.groupSelection &&
            paths
              .filter((p) => props.selected.includes(p.wire.id))
              .map(({ wire: w, points }) => (
                <g key={`handles-${w.id}`} className="net-edit-handles">
                  {points.slice(0, -1).map((a, i) => {
                    const b = points[i + 1];
                    if (Math.hypot(b.x - a.x, b.y - a.y) * zoom < 44)
                      return null;
                    const horizontal = a.y === b.y;
                    return (
                      <rect
                        key={i}
                        data-wire-id={w.id}
                        data-wire-segment={i}
                        className={`net-segment-grip ${horizontal ? 'axis-h' : 'axis-v'}`}
                        x={(a.x + b.x) / 2 - (horizontal ? 6 : 3) / zoom}
                        y={(a.y + b.y) / 2 - (horizontal ? 3 : 6) / zoom}
                        width={(horizontal ? 12 : 6) / zoom}
                        height={(horizontal ? 6 : 12) / zoom}
                        rx={2 / zoom}
                      >
                        <title>
                          Drag to move this segment · Alt-drag to branch
                        </title>
                      </rect>
                    );
                  })}
                  {(['source', 'target'] as const).map((end) => {
                    const p = end === 'source' ? points[0] : points.at(-1);
                    return (
                      p && (
                        <g
                          key={end}
                          data-wire-id={w.id}
                          data-wire-end={end}
                          className="net-endpoint"
                          aria-label={`Reconnect ${end} of ${w.id}`}
                        >
                          <title>Drag to reconnect this end</title>
                          <circle
                            className="net-endpoint-hit"
                            cx={p.x}
                            cy={p.y}
                            r={9 / zoom}
                          />
                          <circle
                            className="net-endpoint-dot"
                            cx={p.x}
                            cy={p.y}
                            r={4.5 / zoom}
                          />
                        </g>
                      )
                    );
                  })}
                </g>
              ))}
          {drawing && destination && (
            <circle
              className="net-destination"
              cx={destination.x}
              cy={destination.y}
              r={11 / zoom}
            />
          )}
          {s.guides.map((g, i) => (
            <line
              key={i}
              x1={g.axis === 'x' ? g.value : s.cursor.x - 260 / zoom}
              x2={g.axis === 'x' ? g.value : s.cursor.x + 260 / zoom}
              y1={g.axis === 'y' ? g.value : s.cursor.y - 260 / zoom}
              y2={g.axis === 'y' ? g.value : s.cursor.y + 260 / zoom}
              className="net-guide"
            />
          ))}
          {preview.length > 1 && (
            <path
              d={pointsToPath(preview)}
              className={`net-live ${s.target?.error ? 'is-invalid' : ''}`}
              style={{ stroke: domainColors[s.domain] }}
            />
          )}
          {drawing &&
            s.corners
              .filter((_, i) => i === s.corners.length - 1)
              .map((p, i) => (
                <rect
                  key={i}
                  x={p.x - 2.5 / zoom}
                  y={p.y - 2.5 / zoom}
                  width={5 / zoom}
                  height={5 / zoom}
                  className="net-pin"
                />
              ))}
          {drawing && s.target && (
            <g
              className={`net-target ${s.target.error ? 'is-invalid' : ''}`}
              style={{ color: domainColors[s.domain] }}
            >
              <circle
                cx={s.target.point.x}
                cy={s.target.point.y}
                r={9 / zoom}
              />
              <circle
                cx={s.target.point.x}
                cy={s.target.point.y}
                r={3 / zoom}
              />
            </g>
          )}
        </svg>
        {!drawing &&
          (document.nets ?? [])
            .filter((net) => !net.hidden || editingNet?.id === net.id)
            .map((net) => (
              <NetLabel
                key={net.id}
                project={document}
                net={net}
                selected={net.wireIds.some((id) => props.selected.includes(id))}
                color={
                  paths.find((p) => net.wireIds.includes(p.wire.id))?.color ??
                  domainColors.signal
                }
                editing={
                  editingNet?.id === net.id ? editingNet.anchor : undefined
                }
                onEdit={(anchor) => {
                  if (anchor) setEditingNet({ id: net.id, anchor });
                }}
                onCancel={() => setEditingNet(null)}
                onName={(name, anchor) => {
                  setEditingNet(null);
                  const original = latest.current.project;
                  let next = renameNet(original, net.id, name);
                  if (name.trim()) {
                    next = setNetLabel(next, net.id, anchor);
                    if (net.hidden)
                      next = {
                        ...next,
                        nets: next.nets?.map((n) =>
                          n.id === net.id ? { ...n, hidden: false } : n,
                        ),
                      };
                  }
                  if (next !== original) latest.current.onCommit(next);
                }}
                onMove={(anchor) =>
                  latest.current.onCommit(
                    setNetLabel(latest.current.project, net.id, anchor),
                  )
                }
                onSelect={() => latest.current.onSelect(net.wireIds)}
              />
            ))}
      </ViewportPortal>
      {(drawing || singleSelection) && (
        <div
          className={`net-toolbar nodrag nopan ${drawing ? 'is-drawing' : ''}`}
          role="toolbar"
          aria-label="Wire editing"
        >
          {drawing ? (
            <>
              {s.wireEdit?.kind === 'redraw' && (
                <button
                  onClick={() => commands.current('finish')}
                  title="Finish redrawing (Enter)"
                >
                  <Check size={14} />
                  Finish<kbd>↵</kbd>
                </button>
              )}
              <button onClick={() => commands.current('cancel')}>
                <X size={14} />
                Cancel<kbd>Esc</kbd>
              </button>
            </>
          ) : (
            <>
              <span className="net-toolbar-label">Wire</span>
              <button
                onClick={() => commands.current('name')}
                title="Name this net (F2)"
              >
                Name<kbd>F2</kbd>
              </button>
              <button
                onClick={() => commands.current('redraw')}
                title="Redraw the selected wire (D)"
              >
                <PencilLine size={14} />
                Redraw<kbd>D</kbd>
              </button>
              <button
                onClick={() => commands.current('auto')}
                title="Reset to automatic routing (R)"
              >
                <Route size={14} />
                Auto route<kbd>R</kbd>
              </button>
              <button
                className="net-delete"
                onClick={() => commands.current('delete')}
                title="Delete wire"
                aria-label="Delete wire"
              >
                <Trash2 size={14} />
              </button>
              <span className="net-toolbar-tip">Drag segment or end</span>
            </>
          )}
        </div>
      )}
      {drawing && (
        <output
          className={`net-status ${message || s.target?.error ? 'is-invalid' : ''}`}
        >
          <span className="net-status-dot" />
          {message ||
            s.target?.error ||
            (s.wireEdit?.kind === 'redraw'
              ? 'Click to pin bends · Click the highlighted end, or Enter'
              : s.target
                ? s.target.wireId
                  ? 'Release / click to join wire'
                  : 'Release / click to connect'
                : 'Click to pin a bend · Drop on a port or wire')}
          <kbd>⌫</kbd>unpin<kbd>Esc</kbd>cancel
        </output>
      )}
    </>
  );
}
