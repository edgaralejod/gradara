'use client';
import { memo, useEffect } from 'react';
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
import { portOffset, portSide } from '@/lib/gradara/ports';
import { BlockFace } from './block-face';
import BlockLabel from './block-label';
export type { BlockNodeData } from '@/lib/gradara/canvas';
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
  const signature = JSON.stringify(d.ports);
  useEffect(() => {
    const frame = requestAnimationFrame(() => updateInternals(id));
    return () => cancelAnimationFrame(frame);
  }, [id, signature, updateInternals]);
  const min = minimumBlockSize(d);
  return (
    <div
      className={`engineering-block notation-${sum ? 'sum' : d.kind} ${selected ? 'is-selected' : ''}`}
      style={{ '--domain': domainColors[d.domain] } as React.CSSProperties}
    >
      <NodeResizer
        isVisible={selected}
        minWidth={min.width}
        minHeight={min.height}
        maxWidth={1200}
        maxHeight={1000}
        color="#2477b5"
        keepAspectRatio={sum}
      />
      <BlockFace definition={d} />
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
      {d.ports.map((port) => {
        const side = portSide(port);
        const offset = portOffset(d, port);
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
