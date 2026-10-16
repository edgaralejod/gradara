'use client';
import { memo, useContext, useEffect, useRef, useState } from 'react';
import {
  NodeResizer,
  ViewportPortal,
  useUpdateNodeInternals,
  type NodeProps,
  type Node,
} from '@xyflow/react';
import { domainColors } from '@/lib/gradara/model';
import {
  blockSize,
  minimumBlockSize,
  type BlockNodeData,
} from '@/lib/gradara/canvas';
import { portPlacement } from '@/lib/gradara/ports';
import { isTagKind, tagDefinition } from '@/lib/gradara/tag-blocks';
import { partnerKind } from '@/lib/gradara/tag-edit';
import { defaultBlockSize } from '@/lib/gradara/block-design';
import { TagCanvasContext } from './tag-canvas-context';
import { BlockFace } from './block-face';
import BlockLabel from './block-label';
import { VariantSwitchContext } from './variant-switch-context';
import { SubsystemPreview } from './subsystem-preview';
export type { BlockNodeData } from '@/lib/gradara/canvas';
/** The segmented switch above a subsystem with variants: the active one is always visible. */
function VariantSwitch({
  id,
  variants,
  active,
}: {
  id: string;
  variants: { id: string; name: string }[];
  active?: string;
}) {
  const choose = useContext(VariantSwitchContext);
  return (
    <div className="variant-switch nodrag nopan">
      {variants.map((v) => (
        <button
          key={v.id}
          type="button"
          aria-pressed={v.id === active}
          className={v.id === active ? 'is-active' : ''}
          title={v.id === active ? `${v.name} (active)` : `Switch to ${v.name}`}
          onPointerDown={(e) => e.stopPropagation()}
          onDoubleClick={(e) => e.stopPropagation()}
          onClick={(e) => {
            e.stopPropagation();
            if (v.id !== active) choose?.(id, v.id);
          }}
        >
          {v.name}
        </button>
      ))}
    </div>
  );
}

function BlockNode({
  id,
  data,
  selected,
  width,
  height,
  positionAbsoluteX,
  positionAbsoluteY,
}: NodeProps<Node<BlockNodeData>>) {
  const d = data.definition;
  const sum = d.kind === 'sum' || d.kind === 'subtract';
  const updateInternals = useUpdateNodeInternals();
  const signature = JSON.stringify([d.ports, data.rotation, data.flip]);
  useEffect(() => {
    const frame = requestAnimationFrame(() => updateInternals(id));
    return () => cancelAnimationFrame(frame);
  }, [id, signature, updateInternals]);
  // Hovering a subsystem for a moment shows a small drawing of its inside.
  const [preview, setPreview] = useState(false);
  const hoverTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const hover = d.subsystem
    ? {
        onPointerEnter: () => {
          hoverTimer.current = setTimeout(() => setPreview(true), 600);
        },
        onPointerLeave: () => {
          if (hoverTimer.current) clearTimeout(hoverTimer.current);
          setPreview(false);
        },
        onPointerDown: () => {
          if (hoverTimer.current) clearTimeout(hoverTimer.current);
          setPreview(false);
        },
      }
    : {};
  const rotation = data.rotation ?? 0;
  const min = minimumBlockSize(d, rotation);
  const tags = useContext(TagCanvasContext);
  const bounds = {
    width:
      width ?? blockSize({ id, definition: d, position: { x: 0, y: 0 } }).width,
    height:
      height ??
      blockSize({ id, definition: d, position: { x: 0, y: 0 } }).height,
  };
  return (
    <div
      className={`engineering-block notation-${sum ? 'sum' : d.kind} ${selected ? 'is-selected' : ''}${tags?.linked.has(id) ? ' is-tag-linked' : ''}`}
      style={{ '--domain': domainColors[d.domain] } as React.CSSProperties}
      {...hover}
    >
      {preview && d.subsystem && !selected && (
        <ViewportPortal>
          <div
            className="subsystem-preview-anchor"
            style={{
              left: positionAbsoluteX + bounds.width / 2,
              top: positionAbsoluteY + bounds.height,
            }}
          >
            <SubsystemPreview subsystemRef={d.subsystem.ref} />
          </div>
        </ViewportPortal>
      )}
      <NodeResizer
        isVisible={selected}
        minWidth={min.width}
        minHeight={min.height}
        maxWidth={1200}
        maxHeight={1200}
        color="#2477b5"
        keepAspectRatio={sum}
      />
      <BlockFace
        definition={d}
        size={
          rotation % 180
            ? { width: bounds.height, height: bounds.width }
            : bounds
        }
        rotation={rotation}
        flip={data.flip}
      />
      {tags && (
        <TagPartner
          id={id}
          definition={d}
          rotation={rotation}
          flip={data.flip}
          bounds={bounds}
          onAdd={tags.addPartner}
        />
      )}
      {d.subsystem?.variants && (
        <VariantSwitch
          id={id}
          variants={d.subsystem.variants}
          active={d.subsystem.active}
        />
      )}
      {/* A subsystem port shows its name inside its pill. */}
      {!d.boundary && !isTagKind(d.kind) && (
        <ViewportPortal>
          <div
            className={`block-label-anchor engineering-label notation-${sum ? 'sum' : d.kind}`}
            style={{
              left:
                positionAbsoluteX +
                (width ??
                  blockSize({ id, definition: d, position: { x: 0, y: 0 } })
                    .width) /
                  2,
              top:
                positionAbsoluteY +
                (height ??
                  blockSize({ id, definition: d, position: { x: 0, y: 0 } })
                    .height),
            }}
          >
            <BlockLabel id={id} name={d.name} offset={data.labelOffset} />
          </div>
        </ViewportPortal>
      )}
      {d.ports.map((port) => {
        const { side, offset } = portPlacement(
          d,
          port,
          rotation,
          bounds,
          data.flip,
        );
        const location =
          side === 'left' || side === 'right'
            ? { top: `${offset}%` }
            : { left: `${offset}%` };
        return (
          <div key={port.id}>
            <button
              type="button"
              data-block-id={id}
              data-port-id={port.id}
              aria-label={`${d.name}: ${port.name} (${port.domain} ${port.direction})`}
              style={
                {
                  ...location,
                  '--port-color': domainColors[port.domain],
                } as React.CSSProperties & { '--port-color': string }
              }
              className={`react-flow__handle react-flow__handle-${side} diagram-port nodrag nopan ${port.direction === 'physical' ? 'physical-port' : ''}`}
              title={`${port.name} · ${port.domain} ${port.direction === 'physical' ? 'connection' : port.direction}${port.unit ? ' · ' + port.unit : ''}`}
            />
            {data.terminated?.includes(port.id) && (
              <Terminator side={side} offset={offset} />
            )}
          </div>
        );
      })}
    </div>
  );
}
/**
 * Simulink's hover action on a Goto: a faded From with the same tag waits past the
 * flag's tip, joined by a dashed lead; clicking it adds that From. A label offers another
 * label the same way. Only for a flag that points left or right.
 */
function TagPartner({
  id,
  definition: d,
  rotation,
  flip,
  bounds,
  onAdd,
}: {
  id: string;
  definition: BlockNodeData['definition'];
  rotation: number;
  flip?: boolean;
  bounds: { width: number; height: number };
  onAdd: (id: string) => void;
}) {
  const kind = partnerKind(d.kind);
  const port = d.ports[0];
  if (!kind || !d.tag || !port) return null;
  const side = portPlacement(d, port, rotation, bounds, flip).side;
  if (side === 'top' || side === 'bottom') return null;
  const partner = tagDefinition(
    kind as 'from' | 'connectionLabel',
    d.tag,
    port.domain,
  );
  const size = defaultBlockSize(partner);
  const label = `Add a ${kind === 'from' ? 'From' : 'label'} [${d.tag}]`;
  return (
    <button
      type="button"
      className={`tag-partner nodrag nopan ${side === 'right' ? 'is-left' : 'is-right'}`}
      style={{ width: size.width, height: size.height }}
      title={label}
      aria-label={label}
      onPointerDown={(e) => e.stopPropagation()}
      onDoubleClick={(e) => e.stopPropagation()}
      onClick={(e) => {
        e.stopPropagation();
        onAdd(id);
      }}
    >
      <BlockFace definition={partner} size={size} />
      <span className="tag-partner-plus" aria-hidden="true">
        +
      </span>
    </button>
  );
}

/** Simulink's terminator, drawn on an output left open on purpose: a stub and a cap. */
function Terminator({
  side,
  offset,
}: {
  side: 'left' | 'right' | 'top' | 'bottom';
  offset: number;
}) {
  const at = {
    right: { left: '100%', top: `${offset}%` },
    left: { left: '0%', top: `${offset}%` },
    top: { left: `${offset}%`, top: '0%' },
    bottom: { left: `${offset}%`, top: '100%' },
  }[side];
  const turn = { right: 0, bottom: 90, left: 180, top: 270 }[side];
  return (
    <svg
      className="port-terminator"
      width="20"
      height="16"
      viewBox="0 0 20 16"
      aria-hidden="true"
      style={{
        ...at,
        transform: `translate(0, -50%) rotate(${turn}deg)`,
      }}
    >
      <title>Unused output (terminated)</title>
      <path d="M0 8H11M11 1.5V14.5M15 4.5V11.5" />
    </svg>
  );
}

export default memo(BlockNode);
