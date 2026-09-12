import { Position } from '@xyflow/react';
import type { Domain, Junction, Project, Wire } from './model';
import { endpointPoint, isTap, TAP_HANDLE } from './net';
import { linkEnds } from './project';
import { sideToPosition } from './wires';
import {
  ANCHOR_PX,
  CANCEL_PX,
  collectAnchors,
  committedPoints,
  hitPort,
  hitSegment,
  livePath,
  loopRailY,
  pinRubberBand,
  samePt,
  snapToAnchors,
  type Anchor,
  type Pt,
} from './net-draw';

export type SessionMode = 'idle' | 'connecting' | 'drawing';

type End = { id: string; handle: string };

function newId(prefix: string) {
  return `${prefix}_${crypto.randomUUID().replaceAll('-', '').slice(0, 12)}`;
}

function exitOf(
  project: Project,
  end: End,
  toward?: Pt,
): Position {
  if (isTap(project, end.id) && toward) {
    const p = endpointPoint(project, end.id, end.handle);
    if (!p) return Position.Right;
    const dx = toward.x - p.x,
      dy = toward.y - p.y;
    if (Math.abs(dx) >= Math.abs(dy))
      return dx >= 0 ? Position.Right : Position.Left;
    return dy >= 0 ? Position.Bottom : Position.Top;
  }
  const p = endpointPoint(project, end.id, end.handle);
  return p ? sideToPosition(p.side) : Position.Right;
}

function domainOf(project: Project, end: End): Domain {
  if (isTap(project, end.id))
    return project.junctions?.find((j) => j.id === end.id)?.domain ?? 'signal';
  return (
    project.blocks
      .find((b) => b.id === end.id)
      ?.definition.ports.find((p) => p.id === end.handle)?.domain ?? 'signal'
  );
}

/** Pointer-driven net editor. Tests call press/move/click/release with coordinates. */
export class NetSession {
  project: Project;
  mode: SessionMode = 'idle';
  from: End | null = null;
  origin: Pt = { x: 0, y: 0 };
  exit: Position = Position.Right;
  corners: Pt[] = [];
  cursor: Pt = { x: 0, y: 0 };
  guides: Anchor[] = [];
  start: Pt | null = null;
  ignoreWireIds: string[] = [];
  private snapshot: Project | null = null;

  constructor(project: Project) {
    this.project = project;
  }

  preview(): Pt[] {
    if (this.mode === 'idle' || !this.start) return [];
    return livePath(
      this.origin,
      this.cursor,
      this.exit,
      this.corners,
      this.start,
    );
  }

  pressPort(blockId: string, portId: string) {
    const p = endpointPoint(this.project, blockId, portId);
    if (!p) return;
    this.from = { id: blockId, handle: portId };
    this.start = { x: p.x, y: p.y };
    this.origin = { x: p.x, y: p.y };
    this.exit = sideToPosition(p.side);
    this.corners = [];
    this.cursor = { x: p.x, y: p.y };
    this.guides = [];
    this.ignoreWireIds = [];
    this.mode = 'connecting';
  }

  pressJunction(id: string, toward?: Pt) {
    const p = endpointPoint(this.project, id, TAP_HANDLE);
    if (!p) return;
    this.from = { id, handle: TAP_HANDLE };
    this.start = { x: p.x, y: p.y };
    this.origin = { x: p.x, y: p.y };
    this.cursor = toward ?? { x: p.x, y: p.y };
    this.exit = exitOf(this.project, this.from, this.cursor);
    this.corners = [];
    this.guides = [];
    this.ignoreWireIds = this.project.wires
      .filter((w) => w.source === id || w.target === id)
      .map((w) => w.id);
    this.mode = 'connecting';
  }

  /** Grab a segment: create a junction (the only time a node graphic appears). */
  pressSegment(at: Pt) {
    const hit = hitSegment(this.project, at);
    if (!hit) return false;
    const spliced = this.spliceAt(hit.wireId, hit.point);
    if (!spliced) return false;
    this.pressJunction(spliced, at);
    return true;
  }

  move(x: number, y: number) {
    if (this.mode === 'idle') return;
    const raw = { x, y };
    const snapped = snapToAnchors(
      raw,
      collectAnchors(this.project, this.ignoreWireIds),
      ANCHOR_PX,
    );
    this.cursor = snapped.point;
    this.guides = snapped.guides;
    if (this.mode === 'connecting' && this.from && isTap(this.project, this.from.id))
      this.exit = exitOf(this.project, this.from, this.cursor);
  }

  /** Release after a drag. Empty space → drawing. Port/junction/segment → commit. */
  release(at?: Pt) {
    if (this.mode !== 'connecting' || !this.from || !this.start) return;
    if (at) this.move(at.x, at.y);
    if (
      Math.hypot(this.cursor.x - this.start.x, this.cursor.y - this.start.y) <
      CANCEL_PX
    ) {
      this.cancel();
      return;
    }
    if (this.tryFinish(this.cursor)) return;
    this.mode = 'drawing';
  }

  /** Click while drawing: pin a vertex (never a junction) or finish on a target. */
  click(at: Pt) {
    if (this.mode === 'idle') return;
    this.move(at.x, at.y);
    if (this.tryFinish(this.cursor)) return;
    if (this.mode === 'connecting') {
      this.mode = 'drawing';
    }
    const pin = pinRubberBand(this.origin, this.cursor, this.exit);
    const added = pin.points.slice(0, -1);
    this.corners = [...this.corners, ...added, pin.origin];
    this.origin = pin.origin;
    this.exit = pin.exit;
  }

  unpin() {
    if (this.mode !== 'drawing' || !this.corners.length) return;
    this.corners = this.corners.slice(0, -1);
    const last = this.corners.at(-1) ?? this.start;
    if (last) this.origin = last;
  }

  cancel() {
    if (this.snapshot) this.project = this.snapshot;
    this.snapshot = null;
    this.mode = 'idle';
    this.from = null;
    this.corners = [];
    this.guides = [];
    this.ignoreWireIds = [];
    this.start = null;
  }

  tryFinish(at: Pt): boolean {
    if (!this.from) return false;
    const port = hitPort(this.project, at);
    if (
      port &&
      !(port.id === this.from.id && port.handle === this.from.handle)
    ) {
      this.commitTo(port);
      return true;
    }
    const seg = hitSegment(this.project, at, 10, this.ignoreWireIds);
    if (seg) {
      const jid = this.spliceAt(seg.wireId, seg.point);
      if (jid) {
        this.commitTo({ id: jid, handle: TAP_HANDLE });
        return true;
      }
    }
    return false;
  }

  commitTo(to: End) {
    if (!this.from) return;
    const vertices = this.corners.length ? [...this.corners] : undefined;
    this.project = linkEnds(this.project, this.from, to, vertices);
    this.snapshot = null;
    this.mode = 'idle';
    this.from = null;
    this.corners = [];
    this.guides = [];
    this.ignoreWireIds = [];
    this.start = null;
  }

  spliceAt(wireId: string, at: Pt): string | null {
    const wire = this.project.wires.find((w) => w.id === wireId);
    if (!wire) return null;
    if (!this.snapshot) this.snapshot = structuredClone(this.project);
    const domain = domainOf(this.project, {
      id: wire.source,
      handle: wire.sourceHandle,
    });
    const id = newId('j');
    const tap: Junction = {
      id,
      position: { x: at.x, y: at.y },
      domain,
    };
    const rest = this.project.wires.filter((w) => w.id !== wireId);
    const a: Wire = {
      id: wire.id,
      source: wire.source,
      sourceHandle: wire.sourceHandle,
      target: id,
      targetHandle: TAP_HANDLE,
    };
    const b: Wire = {
      id: newId('w'),
      source: id,
      sourceHandle: TAP_HANDLE,
      target: wire.target,
      targetHandle: wire.targetHandle,
    };
    this.project = {
      ...this.project,
      junctions: [...(this.project.junctions ?? []), tap],
      wires: [...rest, a, b],
    };
    this.ignoreWireIds = [a.id, b.id];
    return id;
  }

  moveJunction(id: string, x: number, y: number) {
    this.project = {
      ...this.project,
      junctions: (this.project.junctions ?? []).map((j) =>
        j.id === id ? { ...j, position: { x, y } } : j,
      ),
    };
  }

  pathPoints(wireId: string) {
    const w = this.project.wires.find((x) => x.id === wireId);
    if (!w) return [];
    return committedPoints(
      this.project,
      w.source,
      w.sourceHandle,
      w.target,
      w.targetHandle,
      w.waypoints,
    );
  }

  junctionCount() {
    return this.project.junctions?.length ?? 0;
  }
}

export function hasJunctionGraphic(project: Project) {
  return (project.junctions?.length ?? 0) > 0;
}

export { samePt, loopRailY };
