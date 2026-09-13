import { Position } from '@xyflow/react';
import type { Domain, Junction, Project, Wire } from './model';
import {
  connectionError,
  endpointPoint,
  isTap,
  netKeys,
  TAP_HANDLE,
} from './net';
import { linkEnds, pruneJunctions } from './project';
import { sideToPosition } from './ports';
import { routeBetween, segmentExit, simplifyPoints } from './routing';
import {
  ANCHOR_PX,
  CANCEL_PX,
  collectAnchors,
  overlapsDifferentNet,
  hitPort,
  hitSegment,
  livePath,
  loopRailY,
  pinRubberBand,
  polylineOfWire,
  samePt,
  snapToAnchors,
  type Anchor,
  type Pt,
} from './net-draw';

export type SessionMode = 'idle' | 'connecting' | 'drawing';
export type End = { id: string; handle: string };
export type WireEdit = {
  kind: 'reconnect' | 'redraw';
  wire: Wire;
  endpoint: 'source' | 'target';
  destination: End;
  originalPoints: Pt[];
  index: number;
};
export type SnapTarget = {
  point: Pt;
  end: End;
  wireId?: string;
  error: string | null;
};
const newId = (prefix: string) =>
  `${prefix}_${crypto.randomUUID().replaceAll('-', '').slice(0, 12)}`;
function domainOf(p: Project, end: End): Domain {
  return (
    p.junctions?.find((j) => j.id === end.id)?.domain ??
    p.blocks
      .find((b) => b.id === end.id)
      ?.definition.ports.find((p) => p.id === end.handle)?.domain ??
    'signal'
  );
}

/** One transaction from pointer-down to commit. No React, DOM, or history side effects. */
export class NetSession {
  project: Project;
  mode: SessionMode = 'idle';
  editing: WireEdit | null = null;
  from: End | null = null;
  origin: Pt = { x: 0, y: 0 };
  exit = Position.Right;
  corners: Pt[] = [];
  cursor: Pt = { x: 0, y: 0 };
  guides: Anchor[] = [];
  start: Pt | null = null;
  ignoreWireIds: string[] = [];
  target: SnapTarget | null = null;
  zoom = 1;
  private snapshot: Project | null = null;
  private anchors: Anchor[] = [];
  private pins: { corners: Pt[]; origin: Pt; exit: Position }[] = [];
  private raw: Pt = { x: 0, y: 0 };

  constructor(project: Project) {
    this.project = project;
  }
  get domain() {
    return this.from ? domainOf(this.project, this.from) : 'signal';
  }
  preview(): Pt[] {
    if (this.mode === 'idle' || !this.start) return [];
    if (this.target && !this.target.error) {
      const to = endpointPoint(
        this.project,
        this.target.end.id,
        this.target.end.handle,
      )!;
      const entry =
        this.target.wireId || isTap(this.project, this.target.end.id)
          ? undefined
          : sideToPosition(to.side);
      return simplifyPoints([
        this.start,
        ...this.corners,
        ...routeBetween(
          this.origin,
          this.cursor,
          this.exit,
          entry,
          this.corners.length ? 0 : 20,
        ).slice(1),
      ]);
    }
    return livePath(
      this.origin,
      this.cursor,
      this.exit,
      this.corners,
      this.start,
    );
  }
  private begin(end: End, toward?: Pt) {
    const p = endpointPoint(this.project, end.id, end.handle);
    if (!p) return;
    this.snapshot ??= this.project;
    this.from = end;
    this.start = this.origin = this.cursor = { x: p.x, y: p.y };
    this.raw = this.cursor;
    this.exit =
      isTap(this.project, end.id) && toward
        ? segmentExit(p, toward)
        : sideToPosition(p.side);
    this.corners = [];
    this.pins = [];
    this.guides = [];
    this.target = null;
    const own = netKeys(this.project, end);
    this.ignoreWireIds = this.project.wires
      .filter((w) =>
        own.has(
          isTap(this.project, w.source)
            ? `j:${w.source}`
            : `${w.source}.${w.sourceHandle}`,
        ),
      )
      .map((w) => w.id);
    this.anchors = collectAnchors(this.project, this.ignoreWireIds, own);
    this.mode = 'connecting';
  }
  pressPort(blockId: string, portId: string) {
    this.begin({ id: blockId, handle: portId });
  }
  pressJunction(id: string, toward?: Pt) {
    this.begin({ id, handle: TAP_HANDLE }, toward);
  }
  pressSegment(at: Pt) {
    const hit = hitSegment(this.project, at, 10 / this.zoom);
    if (!hit) return false;
    const end = this.spliceAt(hit.wireId, hit.point);
    if (!end) return false;
    this.begin(end, at);
    return true;
  }
  /** Detach only the edited path in the draft; the committed document stays intact. */
  reconnect(wireId: string, endpoint: 'source' | 'target') {
    if (this.mode !== 'idle') this.cancel();
    const wire = this.project.wires.find((w) => w.id === wireId);
    if (!wire) return false;
    const original = this.project;
    const points = polylineOfWire(original, wireId);
    const fixed =
      endpoint === 'target'
        ? { id: wire.source, handle: wire.sourceHandle }
        : { id: wire.target, handle: wire.targetHandle };
    const destination =
      endpoint === 'target'
        ? { id: wire.target, handle: wire.targetHandle }
        : { id: wire.source, handle: wire.sourceHandle };
    this.snapshot = original;
    this.project = {
      ...original,
      wires: original.wires.filter((w) => w.id !== wireId),
    };
    const oriented = endpoint === 'target' ? points : [...points].reverse();
    this.begin(fixed, oriented[1]);
    this.editing = {
      kind: 'reconnect',
      wire,
      endpoint,
      destination,
      originalPoints: points,
      index: original.wires.indexOf(wire),
    };
    // Retain the fixed part of a hand-routed wire. Only its final leg rubber-bands.
    if (wire.waypoints?.length && oriented.length > 3) {
      this.corners = oriented.slice(1, -2);
      this.origin = this.corners.at(-1) ?? this.start!;
      this.exit = segmentExit(oriented[oriented.length - 4], this.origin);
    }
    return true;
  }
  redraw(wireId: string) {
    if (!this.reconnect(wireId, 'target')) return false;
    this.editing!.kind = 'redraw';
    this.corners = [];
    this.pins = [];
    this.origin = this.start!;
    const first = this.editing!.originalPoints;
    this.exit = isTap(this.project, this.from!.id)
      ? segmentExit(first[0], first[1])
      : sideToPosition(
          endpointPoint(this.project, this.from!.id, this.from!.handle)!.side,
        );
    this.mode = 'drawing';
    return true;
  }
  finishRedraw() {
    if (this.editing?.kind === 'redraw')
      this.commitTo(this.editing.destination);
  }
  private targetError(to: End) {
    if (this.editing?.kind === 'redraw')
      return to.id === this.editing.destination.id &&
        to.handle === this.editing.destination.handle
        ? null
        : 'Finish at the highlighted endpoint, or press Enter.';
    return this.from ? connectionError(this.project, this.from, to) : null;
  }
  move(x: number, y: number) {
    if (this.mode === 'idle' || !this.from) return;
    this.raw = { x, y };
    // Hit tests use the raw pointer. Alignment guides cannot manufacture a connection.
    const port = hitPort(this.project, this.raw, 12 / this.zoom);
    const segment =
      port || this.editing?.kind === 'redraw'
        ? undefined
        : hitSegment(this.project, this.raw, 8 / this.zoom, this.ignoreWireIds);
    this.target = null;
    if (
      port &&
      !(port.id === this.from.id && port.handle === this.from.handle)
    ) {
      const end = { id: port.id, handle: port.handle };
      this.target = {
        end,
        point: endpointPoint(this.project, end.id, end.handle)!,
        error: this.targetError(end),
      };
    } else if (segment) {
      const wire = this.project.wires.find((w) => w.id === segment.wireId)!;
      const end = { id: wire.source, handle: wire.sourceHandle };
      this.target = {
        end,
        point: segment.point,
        wireId: wire.id,
        error: this.targetError(end),
      };
    }
    const snapped = snapToAnchors(
      this.raw,
      [
        { axis: 'x', value: this.origin.x },
        { axis: 'y', value: this.origin.y },
        ...this.anchors,
      ],
      ANCHOR_PX / this.zoom,
    );
    this.cursor = this.target?.point ?? snapped.point;
    this.guides = this.target ? [] : snapped.guides;
    if (!this.corners.length && isTap(this.project, this.from.id))
      this.exit = segmentExit(this.origin, this.cursor);
  }
  release(at?: Pt) {
    if (this.mode !== 'connecting' || !this.start) return;
    if (at) this.move(at.x, at.y);
    if (
      !this.editing &&
      Math.hypot(this.raw.x - this.start.x, this.raw.y - this.start.y) *
        this.zoom <
        CANCEL_PX
    ) {
      this.cancel();
      return;
    }
    this.mode = 'drawing';
    this.tryFinish();
  }
  click(at: Pt) {
    if (this.mode === 'idle') return;
    this.move(at.x, at.y);
    if (this.tryFinish()) return;
    this.mode = 'drawing';
    this.pins.push({
      corners: [...this.corners],
      origin: this.origin,
      exit: this.exit,
    });
    const pin = pinRubberBand(
      this.origin,
      this.cursor,
      this.exit,
      this.pins.length > 1 ? 0 : 20,
    );
    this.corners.push(...pin.points);
    this.origin = pin.origin;
    this.exit = pin.exit;
  }
  unpin() {
    const pin = this.pins.pop();
    if (!pin) return;
    this.corners = pin.corners;
    this.origin = pin.origin;
    this.exit = pin.exit;
    this.move(this.raw.x, this.raw.y);
  }
  cancel() {
    if (this.snapshot) this.project = this.snapshot;
    this.reset();
  }
  private reset() {
    this.snapshot = null;
    this.editing = null;
    this.mode = 'idle';
    this.from = null;
    this.corners = [];
    this.pins = [];
    this.guides = [];
    this.ignoreWireIds = [];
    this.start = null;
    this.target = null;
  }
  tryFinish(at?: Pt): boolean {
    if (at) this.move(at.x, at.y);
    if (!this.from || !this.target) return false;
    if (this.target.error) throw new Error(this.target.error);
    const before = this.project;
    try {
      const to = this.target.wireId
        ? this.spliceAt(this.target.wireId, this.target.point)
        : this.target.end;
      if (!to) return false;
      this.commitTo(to);
      return true;
    } catch (error) {
      this.project = before;
      throw error;
    }
  }
  commitTo(to: End) {
    if (!this.from) return;
    const error = this.targetError(to);
    if (error) throw new Error(error);
    const point = endpointPoint(this.project, to.id, to.handle)!;
    const entry = isTap(this.project, to.id)
      ? undefined
      : sideToPosition(point.side);
    const vertices = this.corners.length
      ? simplifyPoints([
          this.start!,
          ...this.corners,
          ...routeBetween(
            this.origin,
            point,
            this.exit,
            entry,
            this.corners.length ? 0 : 20,
          ).slice(1),
        ]).slice(1, -1)
      : undefined;
    let next: Project;
    if (this.editing) {
      const edit = this.editing;
      if (
        edit.kind === 'reconnect' &&
        to.id === edit.destination.id &&
        to.handle === edit.destination.handle &&
        !this.pins.length
      ) {
        this.project = this.snapshot!;
        this.reset();
        return;
      }
      const replacement: Wire =
        edit.kind === 'redraw'
          ? { ...edit.wire, waypoints: vertices }
          : {
              ...edit.wire,
              ...(edit.endpoint === 'source'
                ? { source: to.id, sourceHandle: to.handle }
                : { target: to.id, targetHandle: to.handle }),
              waypoints:
                edit.endpoint === 'source'
                  ? vertices?.slice().reverse()
                  : vertices,
            };
      const wires = [...this.project.wires];
      wires.splice(edit.index, 0, replacement);
      next = { ...this.project, wires };
      if (vertices?.length && overlapsDifferentNet(next, replacement.id))
        throw new Error(
          'This route overlaps another net. Move a bend or use Auto route.',
        );
      if (edit.kind === 'reconnect')
        next = pruneJunctions(next, replacement.id);
    } else {
      next = linkEnds(this.project, this.from, to, vertices);
      if (vertices?.length && overlapsDifferentNet(next, next.wires.at(-1)!.id))
        throw new Error(
          'This route overlaps another net. Move a bend or drop on the wire to join it.',
        );
    }
    this.project = next;
    this.reset();
  }
  /** Split the exact rendered polyline, retaining every bend on both halves. */
  spliceAt(wireId: string, at: Pt): End | null {
    const wire = this.project.wires.find((w) => w.id === wireId);
    if (!wire) return null;
    const points = polylineOfWire(this.project, wireId);
    if (samePt(at, points[0]))
      return { id: wire.source, handle: wire.sourceHandle };
    if (samePt(at, points.at(-1)!))
      return { id: wire.target, handle: wire.targetHandle };
    const segment = points.findIndex((a, i) => {
      const b = points[i + 1];
      if (!b) return false;
      return (
        at.x >= Math.min(a.x, b.x) - 0.000001 &&
        at.x <= Math.max(a.x, b.x) + 0.000001 &&
        at.y >= Math.min(a.y, b.y) - 0.000001 &&
        at.y <= Math.max(a.y, b.y) + 0.000001
      );
    });
    if (segment < 0) return null;
    const hit = { point: at, segment };
    this.snapshot ??= this.project;
    const id = newId('j');
    const junction: Junction = {
      id,
      position: hit.point,
      domain: domainOf(this.project, {
        id: wire.source,
        handle: wire.sourceHandle,
      }),
    };
    const a: Wire = {
      ...wire,
      target: id,
      targetHandle: TAP_HANDLE,
      waypoints: simplifyPoints([
        ...points.slice(0, hit.segment + 1),
        hit.point,
      ]).slice(1, -1),
    };
    const b: Wire = {
      ...wire,
      id: newId('w'),
      source: id,
      sourceHandle: TAP_HANDLE,
      waypoints: simplifyPoints([
        hit.point,
        ...points.slice(hit.segment + 1),
      ]).slice(1, -1),
    };
    this.project = {
      ...this.project,
      junctions: [...(this.project.junctions ?? []), junction],
      wires: this.project.wires.flatMap((w) =>
        w.id === wireId ? [a, b] : [w],
      ),
    };
    return { id, handle: TAP_HANDLE };
  }
  moveJunction(id: string, x: number, y: number) {
    const old = this.project;
    this.project = {
      ...old,
      junctions: old.junctions?.map((j) =>
        j.id === id ? { ...j, position: { x, y } } : j,
      ),
      wires: old.wires.map((w) => {
        if (w.source !== id && w.target !== id) return w;
        const pts = polylineOfWire(old, w.id);
        const start = w.source === id;
        const p = start ? pts[0] : pts.at(-1)!;
        const neighbor = start ? pts[1] : pts.at(-2)!;
        const horizontal = p.y === neighbor.y;
        const middle = start ? { x: neighbor.x, y } : { x: neighbor.x, y };
        if (!horizontal) {
          middle.x = x;
          middle.y = neighbor.y;
        }
        const moved = start
          ? [{ x, y }, middle, ...pts.slice(1)]
          : [...pts.slice(0, -1), middle, { x, y }];
        return { ...w, waypoints: simplifyPoints(moved).slice(1, -1) };
      }),
    };
  }
  pathPoints(wireId: string) {
    return polylineOfWire(this.project, wireId);
  }
  junctionCount() {
    return this.project.junctions?.length ?? 0;
  }
}
export function hasJunctionGraphic(project: Project) {
  return (
    project.junctions?.some(
      (j) =>
        project.wires.filter((w) => w.source === j.id || w.target === j.id)
          .length >= 3,
    ) ?? false
  );
}
export { samePt, loopRailY };
