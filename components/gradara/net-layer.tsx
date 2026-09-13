'use client';
import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
} from 'react';
import { ViewportPortal, useReactFlow, useStore } from '@xyflow/react';
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
  moveVertex,
  snappedSegment,
} from '@/lib/gradara/net-edit';
import { resetWireRoute } from '@/lib/gradara/wires';
import { PencilLine, Route, Trash2, Check, X } from 'lucide-react';

type Props = {
  project: Project;
  selected: string[];
  onSelect: (ids: string[]) => void;
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
export default function NetLayer(props: Props) {
  const flow = useReactFlow();
  const nodes = useStore((s) => s.nodes);
  const zoom = useStore((s) => s.transform[2]);
  const scene = useMemo(
    () => ({
      ...props.project,
      blocks: props.project.blocks.map((b) => {
        const node = nodes.find((n) => n.id === b.id);
        return node
          ? {
              ...b,
              position: node.position,
              size: {
                width:
                  node.measured?.width ?? node.width ?? b.size?.width ?? 64,
                height:
                  node.measured?.height ?? node.height ?? b.size?.height ?? 64,
              },
            }
          : b;
      }),
    }),
    [props.project, nodes],
  );
  const latest = useRef({ ...props, scene });
  useLayoutEffect(() => {
    latest.current = { ...props, scene };
  }, [props, scene]);
  const session = useRef(new NetSession(scene));
  const gesture = useRef<Gesture | null>(null);
  const svg = useRef<SVGSVGElement>(null);
  const frame = useRef<number | null>(null);
  const commands = useRef<(action: string) => void>(() => {});
  const [view, setView] = useState(() => viewOf(new NetSession(scene)));
  const [message, setMessage] = useState('');
  const [hover, setHover] = useState<string | null>(null);
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
    session.current.cancel();
    const root = svg.current?.closest('.react-flow') as HTMLElement | null;
    if (root) root.dataset.wiring = 'idle';
    session.current.project = latest.current.scene;
    gesture.current = null;
    repaint();
  }, [props.project, repaint]);
  useEffect(() => {
    const root = svg.current?.closest('.react-flow') as HTMLElement | null;
    if (!root) return;
    let suppressClick = false;
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
    const commit = (selectId?: string) => {
      const s = session.current;
      // Preserve the document's blocks: transient React Flow measurements are view state.
      if (
        s.project.wires !== latest.current.project.wires ||
        s.project.junctions !== latest.current.project.junctions
      ) {
        latest.current.onCommit({
          ...s.project,
          blocks: latest.current.project.blocks,
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
      if (e.button !== 0) return;
      // A captured drag may not produce a browser click. Never swallow the next gesture.
      if (session.current.mode === 'idle') suppressClick = false;
      const target = e.target as Element;
      if (
        target.closest(
          '.react-flow__controls,.react-flow__minimap,.net-toolbar',
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
      if (endpoint) {
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
          e.shiftKey
            ? [...new Set([...latest.current.selected, g.id!])]
            : [g.id!],
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
      const at = point(e);
      s.zoom = flow.getZoom();
      if (g && Math.hypot(e.clientX - g.screen.x, e.clientY - g.screen.y) > 5)
        g.moved = true;
      if (g?.kind === 'wire' && g.moved && s.mode === 'idle')
        s.pressSegment(g.at);
      if (g?.kind === 'junction' && g.moved) {
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
        const i = g.vertex!;
        const next = {
          x: Math.round(at.x / 4) * 4,
          y: Math.round(at.y / 4) * 4,
        };
        s.project = moveVertex(g.initial, g.id!, i, next);
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
        if (g.moved) commit();
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
      session.current.project = latest.current.scene;
      gesture.current = null;
      suppressClick = false;
      setMessage('');
      refresh();
    };
    const key = (e: KeyboardEvent) => {
      if (
        (e.target as Element)?.closest(
          'input,textarea,[contenteditable=true],[role=dialog]',
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
        } else if (['Delete', 'a', 'd', 'r', '/', 'Enter'].includes(e.key))
          stop(e);
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
        latest.current.onCommit(
          removeSelection(latest.current.project, [], latest.current.selected),
        );
        latest.current.onSelect([]);
      }
    };
    const click = (e: MouseEvent) => {
      if (!root.contains(e.target as Node)) return;
      if ((e.target as Element).closest('.net-toolbar')) {
        suppressClick = false;
        return;
      }
      if (suppressClick || session.current.mode !== 'idle') {
        stop(e);
        suppressClick = false;
      }
    };
    const dblclick = (e: MouseEvent) => {
      if (
        session.current.mode !== 'idle' ||
        (e.target as Element).closest(
          '[data-wire-id],[data-junction-id],[data-port-id]',
        )
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
    root.addEventListener('pointerdown', down, true);
    window.addEventListener('click', click, true);
    root.addEventListener('dblclick', dblclick, true);
    window.addEventListener('pointermove', move, true);
    window.addEventListener('pointerup', up, true);
    window.addEventListener('pointercancel', cancel, true);
    window.addEventListener('keydown', key, true);
    return () => {
      root.removeEventListener('pointerdown', down, true);
      window.removeEventListener('click', click, true);
      root.removeEventListener('dblclick', dblclick, true);
      window.removeEventListener('pointermove', move, true);
      window.removeEventListener('pointerup', up, true);
      window.removeEventListener('pointercancel', cancel, true);
      window.removeEventListener('keydown', key, true);
      if (frame.current !== null) cancelAnimationFrame(frame.current);
    };
  }, [flow, repaint]);

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
  const preview = s.preview;
  const destination =
    s.wireEdit &&
    endpointPoint(
      document,
      s.wireEdit.destination.id,
      s.wireEdit.destination.handle,
    );
  const singleSelection =
    props.selected.length === 1 &&
    paths.some((p) => p.wire.id === props.selected[0]);
  return (
    <>
      <ViewportPortal>
        <svg
          ref={svg}
          className="net-layer"
          width="1"
          height="1"
          aria-label="Model wiring"
          data-mode={s.mode}
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
            const selected = props.selected.includes(w.id);
            return (
              <g
                key={w.id}
                data-wire-id={w.id}
                aria-label={`Wire ${w.source} to ${w.target}`}
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
                className="net-junction"
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
