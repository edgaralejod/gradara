import type { CSSProperties } from 'react';
import { domainColors, type Definition } from '@/lib/gradara/model';
import {
  blockShape,
  defaultBlockSize,
  showPortLabel,
  sideOf,
} from '@/lib/gradara/block-design';
import { portOffset } from '@/lib/gradara/ports';
import { BlockSymbol } from './block-symbol';

/** The sole visual renderer. Port interaction and labels outside the body belong to the canvas. */
export function BlockFace({
  definition: d,
  thumbnail = false,
}: {
  definition: Definition;
  thumbnail?: boolean;
}) {
  const shape = blockShape(d);
  const inset = (side: string) =>
    shape !== 'box'
      ? undefined
      : Math.max(
          8,
          ...d.ports
            .filter((p) => sideOf(p) === side && showPortLabel(d, p))
            .map((p) =>
              side === 'left' || side === 'right'
                ? Math.min(42, 12 + p.name.length * 7)
                : 24,
            ),
        );
  return (
    <span
      className={`block-face shape-${shape}`}
      style={
        {
          '--domain': domainColors[d.domain],
          '--well-left': `${inset('left') ?? 8}px`,
          '--well-right': `${inset('right') ?? 8}px`,
          '--well-top': `${inset('top') ?? 8}px`,
          '--well-bottom': `${inset('bottom') ?? 8}px`,
        } as CSSProperties
      }
      aria-hidden="true"
    >
      <svg
        className="block-outline"
        viewBox="0 0 100 100"
        preserveAspectRatio="none"
      >
        {shape === 'sum' ? (
          <ellipse cx="50" cy="50" rx="49" ry="49" />
        ) : shape === 'gain' ? (
          <polygon points="1,1 99,50 1,99" />
        ) : shape === 'mux' ? (
          <polygon points="1,1 99,25 99,75 1,99" />
        ) : shape === 'demux' ? (
          <polygon points="1,25 99,1 99,99 1,75" />
        ) : shape === 'physical' || shape === 'ground' ? null : (
          <rect x="1" y="1" width="98" height="98" rx="1" />
        )}
      </svg>
      <span className="block-symbol">
        <BlockSymbol definition={d} thumbnail={thumbnail} />
      </span>
      {d.ports
        .filter((p) => showPortLabel(d, p))
        .map((p) => {
          const side = sideOf(p),
            offset = portOffset(d, p);
          return (
            <span
              key={p.id}
              className={`port-label port-${side}${shape === 'sum' ? ' sum-sign' : ''}`}
              style={{
                [side === 'left' || side === 'right' ? 'top' : 'left']:
                  `${offset}%`,
                color: domainColors[p.domain],
              }}
            >
              {p.name}
            </span>
          );
        })}
    </span>
  );
}

/** Exact canvas face, uniformly scaled in the library; never a second icon implementation. */
export function BlockPreview({
  definition,
  miniature = false,
  compact = false,
}: {
  definition: Definition;
  miniature?: boolean;
  compact?: boolean;
}) {
  const size = defaultBlockSize(definition);
  const scale = miniature
    ? Math.min(
        0.7,
        (compact ? 36 : 56) / size.width,
        (compact ? 28 : 42) / size.height,
      )
    : 1;
  return (
    <span
      className={`block-preview${miniature ? ' is-miniature' : ''}`}
      style={{ width: size.width * scale, height: size.height * scale }}
      aria-hidden="true"
    >
      <span
        className="block-preview-body"
        style={
          {
            ...size,
            transform: `scale(${scale})`,
            '--domain': domainColors[definition.domain],
            '--preview-text': `${12 / scale}px`,
          } as CSSProperties
        }
      >
        <BlockFace definition={definition} thumbnail={miniature} />
        {definition.ports.map((p) => {
          const side = sideOf(p),
            offset = portOffset(definition, p);
          return (
            <span
              key={p.id}
              className={`preview-terminal terminal-${side} ${p.direction === 'physical' ? 'is-physical' : ''}`}
              style={
                {
                  [side === 'left' || side === 'right' ? 'top' : 'left']:
                    `${offset}%`,
                  '--port-color': domainColors[p.domain],
                } as CSSProperties
              }
            />
          );
        })}
      </span>
    </span>
  );
}
