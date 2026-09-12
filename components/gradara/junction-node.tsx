'use client';
import { memo } from 'react';
import { Handle, Position, type Node, type NodeProps } from '@xyflow/react';
import { domainColors, type Domain } from '@/lib/gradara/model';
import { TAP_HANDLE } from '@/lib/gradara/net';

export type TapData = { domain: Domain };
function JunctionNode({ data, selected }: NodeProps<Node<TapData, 'tap'>>) {
  return (
    <div
      className={`wire-tap ${selected ? 'is-selected' : ''}`}
      style={{ '--port-color': domainColors[data.domain] } as React.CSSProperties}
      title="Node · drop a wire here, or drag to move the branch"
    >
      <Handle
        id={TAP_HANDLE}
        type="source"
        position={Position.Top}
        className="tap-handle"
      />
    </div>
  );
}
export default memo(JunctionNode);
