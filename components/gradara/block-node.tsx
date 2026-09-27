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
  const signature = JSON.stringify([d.ports, data.rotation]);
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
  const bounds = {
    width:
      width ?? blockSize({ id, definition: d, position: { x: 0, y: 0 } }).width,
    height:
      height ??
      blockSize({ id, definition: d, position: { x: 0, y: 0 } }).height,
  };
  return (
    <div
      className={`engineering-block notation-${sum ? 'sum' : d.kind} ${selected ? 'is-selected' : ''}`}
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
      <div
        className="rotated-block-face"
        style={{
          position: 'absolute',
          left: '50%',
          top: '50%',
          pointerEvents: 'none',
          width: rotation % 180 ? bounds.height : bounds.width,
          height: rotation % 180 ? bounds.width : bounds.height,
          transform: `translate(-50%, -50%) rotate(${rotation}deg)`,
        }}
      >
        <BlockFace definition={d} />
      </div>
      {d.subsystem?.variants && (
        <VariantSwitch
          id={id}
          variants={d.subsystem.variants}
          active={d.subsystem.active}
        />
      )}
      {/* A subsystem port shows its name inside its pill. */}
      {!d.boundary && (
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
        const { side, offset } = portPlacement(d, port, rotation);
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
          </div>
        );
      })}
    </div>
  );
}
export default memo(BlockNode);
