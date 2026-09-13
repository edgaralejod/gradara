'use client';
import { memo, useEffect } from 'react';
import {
  NodeResizer,
  useUpdateNodeInternals,
  type NodeProps,
  type Node,
} from '@xyflow/react';
import { domainColors } from '@/lib/gradara/model';
import { minimumBlockSize, type BlockNodeData } from '@/lib/gradara/canvas';
import { portOffset, portSide } from '@/lib/gradara/ports';
import { BlockSymbol } from './block-symbol';
export type { BlockNodeData } from '@/lib/gradara/canvas';
function BlockNode({ id, data, selected }: NodeProps<Node<BlockNodeData>>) {
  const d = data.definition;
  const sum = d.kind === 'sum' || d.kind === 'subtract';
  const gain = d.kind === 'gain';
  const minimal =
    sum ||
    gain ||
    [
      'constant',
      'step',
      'integrator',
      'saturation',
      'ground',
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
      'resistor',
      'capacitor',
      'inductor',
      'diode',
    ].includes(d.kind);
  const updateInternals = useUpdateNodeInternals();
  const signature = JSON.stringify(d.ports);
  useEffect(() => {
    const frame = requestAnimationFrame(() => updateInternals(id));
    return () => cancelAnimationFrame(frame);
  }, [id, signature, updateInternals]);
  const min = minimumBlockSize(d.kind);
  return (
    <div
      className={`engineering-block notation-${sum ? 'sum' : gain ? 'gain' : d.kind} ${selected ? 'is-selected' : ''} ${minimal ? 'minimal-ports' : ''}`}
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
      <svg
        className="block-outline"
        viewBox="0 0 100 100"
        preserveAspectRatio="none"
        aria-hidden="true"
      >
        {sum ? (
          <ellipse cx="50" cy="50" rx="47" ry="47" />
        ) : gain ? (
          <polygon points="2,3 98,50 2,97" />
        ) : d.kind === 'mux' ? (
          <polygon points="8,4 96,22 96,78 8,96" />
        ) : d.kind === 'demux' ? (
          <polygon points="4,22 92,4 92,96 4,78" />
        ) : ['ground', 'resistor', 'capacitor', 'inductor', 'diode'].includes(
            d.kind,
          ) ? null : (
          <rect x="1" y="1" width="98" height="98" rx="1" />
        )}
      </svg>
      <div className="block-symbol">
        <BlockSymbol definition={d} />
      </div>
      <div className="block-name" title={d.name}>
        {d.name}
      </div>
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
            <span
              className={`port-label port-${side} ${sum && port.direction === 'input' ? 'sum-sign' : ''}`}
              style={{ ...location, color: domainColors[port.domain] }}
            >
              {port.name}
            </span>
          </div>
        );
      })}
    </div>
  );
}
export default memo(BlockNode);
