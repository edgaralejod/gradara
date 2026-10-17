import type { CSSProperties } from 'react';
import { domainColors, type Definition } from '@/lib/gradara/model';
import {
  blockShape,
  defaultBlockSize,
  showPortLabel,
  sideOf,
} from '@/lib/gradara/block-design';
import {
  orientationOf,
  portPlacement,
  screenSide,
  type Side,
} from '@/lib/gradara/ports';
import { BlockSymbol } from './block-symbol';
import { CircuitSymbol } from './circuit-symbol';
import { isPictorial } from '@/lib/gradara/pictorial';

/**
 * The sole visual renderer. Port interaction and labels outside the body belong to the
 * canvas. A turned or flipped block turns and mirrors its drawing (outline, symbol,
 * leads) but never its text: port names, values and symbols stay upright and are
 * placed at the terminals' sheet positions, as KiCad and Simulink keep them readable.
 */
export function BlockFace({
  definition: d,
  thumbnail = false,
  size = defaultBlockSize(d),
  rotation = 0,
  flip = false,
}: {
  definition: Definition;
  thumbnail?: boolean;
  /** The face before rotation; port captions follow the block's grid ports. */
  size?: { width: number; height: number };
  rotation?: number;
  flip?: boolean;
}) {
  const shape = blockShape(d);
  const o = orientationOf(d, rotation, flip);
  const turned = o.rotation % 180 !== 0;
  const sheet = turned ? { width: size.height, height: size.width } : size;
  // Bus signal names are the content of these blocks: never cut them short.
  const named =
    d.kind === 'busCreator' ||
    d.kind === 'busSelector' ||
    d.kind === 'physicalBus';
  // Room for the upright names inside the body, on the side of the unturned face
  // whose terminals they name: a name across a side needs its width, along it a line.
  const inset = (side: Side) =>
    shape !== 'box' && shape !== 'subsystem'
      ? undefined
      : Math.max(
          8,
          ...d.ports
            .filter((p) => sideOf(p) === side && showPortLabel(d, p))
            .map((p) =>
              ['left', 'right'].includes(screenSide(side, o))
                ? Math.min(named ? 320 : 42, 12 + p.name.length * 7)
                : 24,
            ),
        );
  const upright = `${o.flip ? 'scaleX(-1) ' : ''}rotate(${-o.rotation}deg)`;
  return (
    <span
      className={`block-face shape-${shape}${named ? ' has-signal-names' : ''}${d.glyph ? ' has-drawing' : ''}`}
      style={{ '--domain': domainColors[d.domain] } as CSSProperties}
      aria-hidden="true"
    >
      <span
        className="block-frame"
        data-turn={o.rotation || undefined}
        data-flip={o.flip || undefined}
        style={
          {
            width: size.width,
            height: size.height,
            transform: `translate(-50%, -50%) rotate(${o.rotation}deg)${o.flip ? ' scaleX(-1)' : ''}`,
            '--upright': o.rotation || o.flip ? upright : undefined,
            '--well-left': `${inset('left') ?? 8}px`,
            '--well-right': `${inset('right') ?? 8}px`,
            '--well-top': `${inset('top') ?? 8}px`,
            '--well-bottom': `${inset('bottom') ?? 8}px`,
          } as CSSProperties
        }
      >
        <svg
          className="block-outline"
          viewBox="0 0 100 100"
          preserveAspectRatio="none"
        >
          {shape === 'tag' ? (
            d.kind === 'connectionLabel' ? (
              <rect x="1" y="1" width="98" height="98" rx="14" ry="48" />
            ) : d.kind === 'goto' ? (
              <polygon points="1,1 84,1 99,50 84,99 1,99" />
            ) : (
              <polygon points="1,1 84,1 99,50 84,99 1,99 16,50" />
            )
          ) : shape === 'boundary' ? (
            <rect x="1" y="1" width="98" height="98" rx="14" ry="48" />
          ) : shape === 'subsystem' ? (
            <rect x="1" y="1" width="98" height="98" rx="3" />
          ) : shape === 'sum' ? (
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
        {shape === 'boundary' ? (
          <span className="boundary-pill">
            <span className="boundary-glyph" data-domain={d.ports[0]?.domain}>
              {d.kind === 'connport' ? '' : d.symbol}
            </span>
            <span className="boundary-name">{d.name}</span>
          </span>
        ) : (
          <span className="block-symbol">
            {d.glyph || isPictorial(d.kind) ? (
              <CircuitSymbol definition={d} size={size} />
            ) : (
              <BlockSymbol definition={d} thumbnail={thumbnail} />
            )}
          </span>
        )}
      </span>
      {d.ports
        .filter((p) => showPortLabel(d, p))
        .map((p) => {
          const { side, offset } = portPlacement(d, p, rotation, sheet, flip);
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
  rotation = 0,
  flip = false,
}: {
  definition: Definition;
  miniature?: boolean;
  compact?: boolean;
  /** A drawing's turned or flipped block (example diagrams); the library shows none. */
  rotation?: number;
  flip?: boolean;
}) {
  const face = defaultBlockSize(definition);
  const size =
    orientationOf(definition, rotation, flip).rotation % 180
      ? { width: face.height, height: face.width }
      : face;
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
        <BlockFace
          definition={definition}
          thumbnail={miniature}
          size={face}
          rotation={rotation}
          flip={flip}
        />
        {definition.ports.map((p) => {
          const { side, offset } = portPlacement(
            definition,
            p,
            rotation,
            size,
            flip,
          );
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
