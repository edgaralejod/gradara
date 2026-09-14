import {
  applyNodeChanges,
  type Node,
  type NodeChange,
  type NodePositionChange,
} from '@xyflow/react';
import type { Block, Definition, Domain, Project } from './model';
import { TAP_SIZE } from './net';
import { minimumDesignedSize, snapBlockPosition } from './block-design';

export type BlockNodeData = {
  definition: Definition;
  labelOffset?: Block['labelOffset'];
};
export type BlockCanvasNode = Node<BlockNodeData, 'block'>;
export type CanvasNode = BlockCanvasNode | Node<{ domain: Domain }, 'tap'>;
export type BlockLayout = Pick<Block, 'id' | 'position'> & {
  size: { width: number; height: number };
};

const compactKinds = new Set([
  'step',
  'constant',
  'integrator',
  'saturation',
  'ramp',
  'sine',
  'pulse',
  'clock',
  'abs',
  'sign',
  'sqrt',
  'unaryMinus',
  'sineOp',
  'cosineOp',
  'derivative',
  'delay',
  'unitDelay',
  'zoh',
  'deadzone',
  'relay',
  'display',
  'terminator',
]);
export function minimumBlockSize(definition: Definition) {
  return minimumDesignedSize(definition);
}
/** Unsized v1 documents keep their original geometry. New insertions persist defaultBlockSize. */
export function blockSize(block: Block) {
  if (block.size) return block.size;
  const kind = block.definition.kind;
  if (kind === 'sum' || kind === 'subtract') return { width: 36, height: 36 };
  if (kind === 'gain') return { width: 72, height: 64 };
  if (kind === 'ground') return { width: 48, height: 40 };
  if (kind === 'scope') return { width: 92, height: 64 };
  if (kind === 'subsystem') return { width: 150, height: 92 };
  if (kind === 'mux' || kind === 'demux') return { width: 48, height: 72 };
  if (['resistor', 'capacitor', 'inductor', 'diode'].includes(kind))
    return { width: 80, height: 44 };
  if (compactKinds.has(kind)) return { width: 64, height: 56 };
  if (['pid', 'pi', 'filter', 'secondOrder', 'currentPI'].includes(kind))
    return { width: 96, height: 70 };
  return { width: 120, height: 90 };
}

const samePosition = (a: Block['position'], b: Block['position']) =>
  a.x === b.x && a.y === b.y;
const sameSize = (a: BlockLayout['size'], b: BlockLayout['size']) =>
  a.width === b.width && a.height === b.height;

/** Keep renderer measurements and in-flight gestures when the document has not changed them. */
export function reconcileNodes(
  nodes: CanvasNode[],
  previousBlocks: Block[],
  blocks: Block[],
  selectedIds: string[],
): BlockCanvasNode[] {
  const previousNodes = nodes.filter(
    (n): n is BlockCanvasNode => n.type !== 'tap',
  );
  const current = new Map(previousNodes.map((n) => [n.id, n]));
  const previous = new Map(previousBlocks.map((b) => [b.id, b]));
  const selected = new Set(selectedIds);
  const next = blocks.map((b) => {
    const n = current.get(b.id);
    const before = previous.get(b.id);
    const size = blockSize(b);
    const position =
      n && before && samePosition(before.position, b.position)
        ? n.position
        : b.position;
    const preserveSize = n && before && sameSize(blockSize(before), size);
    const width = preserveSize ? n.width : size.width;
    const height = preserveSize ? n.height : size.height;
    const isSelected = selected.has(b.id);
    if (
      n &&
      position === n.position &&
      width === n.width &&
      height === n.height &&
      n.selected === isSelected &&
      n.data.definition === b.definition &&
      n.data.labelOffset === b.labelOffset
    )
      return n;
    return {
      ...n,
      id: b.id,
      type: 'block' as const,
      position,
      width,
      height,
      measured: n?.measured,
      selected: isSelected,
      data:
        n?.data.definition === b.definition &&
        n.data.labelOffset === b.labelOffset
          ? n.data
          : { definition: b.definition, labelOffset: b.labelOffset },
      ariaLabel: b.definition.name,
    };
  });
  if (
    next.length === previousNodes.length &&
    next.every((n, i) => n === previousNodes[i])
  )
    return nodes.some((n) => n.type === 'tap')
      ? previousNodes
      : (nodes as BlockCanvasNode[]);
  return next;
}

/** A resize/move is one document transaction; measurement notifications are never edits. */
export function applyLayout(project: Project, layouts: BlockLayout[]): Project {
  const updates = new Map(layouts.map((l) => [l.id, l]));
  let changed = false;
  const blocks = project.blocks.map((block) => {
    const layout = updates.get(block.id);
    if (!layout) return block;
    const positionChanged = !samePosition(block.position, layout.position);
    const sizeChanged = !sameSize(blockSize(block), layout.size);
    if (!positionChanged && !sizeChanged) return block;
    changed = true;
    return {
      ...block,
      position: positionChanged ? layout.position : block.position,
      ...(sizeChanged ? { size: layout.size } : {}),
    };
  });
  let junctions = project.junctions ?? [];
  let tapsMoved = false;
  junctions = junctions.map((j) => {
    const layout = updates.get(j.id);
    if (!layout) return j;
    const center = {
      x: layout.position.x + TAP_SIZE / 2,
      y: layout.position.y + TAP_SIZE / 2,
    };
    if (center.x === j.position.x && center.y === j.position.y) return j;
    tapsMoved = true;
    return { ...j, position: center };
  });
  if (!changed && !tapsMoved) return project;
  return {
    ...project,
    ...(changed ? { blocks } : {}),
    ...(tapsMoved ? { junctions } : {}),
  };
}

/** Tracks gesture completion independently of React renders and callback ordering. */
export class CanvasGestures {
  private dragging = new Set<string>();
  private resizing = new Set<string>();
  private dirty = new Set<string>();
  private moveOrigins = new Map<string, Block['position']>();

  apply(
    changes: NodeChange<CanvasNode>[],
    nodes: CanvasNode[],
    snapPositions:
      | boolean
      | ((
          node: CanvasNode,
          position: Block['position'],
        ) => Block['position']) = false,
  ): {
    nodes: CanvasNode[];
    layouts: BlockLayout[];
  } {
    if (snapPositions) {
      // Snap one anchor, then the existing group logic applies its delta rigidly.
      const anchor = changes.find(
        (c) => c.type === 'position' && c.position && c.dragging !== undefined,
      );
      const node =
        anchor && 'id' in anchor
          ? nodes.find((n) => n.id === anchor.id)
          : undefined;
      if (node && anchor?.type === 'position' && anchor.position) {
        const position =
          typeof snapPositions === 'function'
            ? snapPositions(node, anchor.position)
            : snapBlockPosition(anchor.position, {
                width: node.width ?? 80,
                height: node.height ?? 64,
              });
        changes = changes.map((c) => (c === anchor ? { ...c, position } : c));
      }
    }
    const positions = changes.filter(
      (c): c is NodePositionChange =>
        c.type === 'position' && !!c.position && c.dragging !== undefined,
    );
    // React Flow grid-snaps each node independently. A group must instead keep
    // its original spacing, including off-grid port-aligned blocks.
    if (positions.length > 1) {
      for (const c of positions)
        if (!this.moveOrigins.has(c.id)) {
          const node = nodes.find((n) => n.id === c.id);
          if (node) this.moveOrigins.set(c.id, node.position);
        }
      const anchor = positions[0];
      const origin = this.moveOrigins.get(anchor.id);
      if (origin && anchor.type === 'position' && anchor.position) {
        const delta = {
          x: anchor.position.x - origin.x,
          y: anchor.position.y - origin.y,
        };
        changes = changes.map((c) => {
          const from = 'id' in c ? this.moveOrigins.get(c.id) : undefined;
          return c.type === 'position' && c.position && from
            ? { ...c, position: { x: from.x + delta.x, y: from.y + delta.y } }
            : c;
        });
      }
    }
    const next = applyNodeChanges(changes, nodes);
    for (const change of changes) {
      if (change.type === 'position' && change.position) {
        this.dirty.add(change.id);
        if (change.dragging) this.dragging.add(change.id);
        else if (change.dragging === false) this.dragging.delete(change.id);
      }
      if (change.type === 'dimensions' && change.resizing !== undefined) {
        this.dirty.add(change.id);
        if (change.resizing) this.resizing.add(change.id);
        else this.resizing.delete(change.id);
      }
      if (change.type === 'remove') {
        this.dirty.delete(change.id);
        this.dragging.delete(change.id);
        this.resizing.delete(change.id);
      }
    }
    const layouts: BlockLayout[] = [];
    if (!this.dragging.size && !this.resizing.size && this.dirty.size) {
      for (const n of next)
        if (this.dirty.has(n.id)) {
          layouts.push({
            id: n.id,
            position: n.position,
            size: { width: n.width!, height: n.height! },
          });
        }
      this.dirty.clear();
      this.moveOrigins.clear();
    }
    return { nodes: next, layouts };
  }
}
