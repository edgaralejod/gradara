'use client';
// SPDX-License-Identifier: Apache-2.0
/**
 * Development review surface for the symbol editor: opens it on three sample blocks
 * with a stub AI. Not linked from the product UI, and empty outside development.
 */
import { useState } from 'react';
import { SymbolEditor } from '@/components/gradara/symbol-editor';
import { library, type Block, type Definition } from '@/lib/gradara/model';
import { defaultBlockSize } from '@/lib/gradara/block-design';
import type { SymbolGlyph } from '@/lib/gradara/glyph';
import { portSide } from '@/lib/gradara/ports';

const fet: Definition = {
  kind: 'reviewFet',
  name: 'Gate-driven FET',
  description:
    'A generated switch with a signal gate, the kind an AI block draws as a box.',
  domain: 'electrical',
  symbol: 'FET',
  generated: true,
  parameters: [],
  equations: '',
  ports: [
    {
      id: 'gate',
      name: 'gate',
      direction: 'input',
      domain: 'signal',
      side: 'left',
    },
    {
      id: 'd',
      name: 'd',
      direction: 'physical',
      domain: 'electrical',
      side: 'top',
    },
    {
      id: 's',
      name: 's',
      direction: 'physical',
      domain: 'electrical',
      side: 'bottom',
    },
  ],
};

const builtin = (kind: string) => {
  const d = library.find((x) => x.kind === kind);
  if (!d) throw new Error(`No ${kind} in the library`);
  return d;
};

const samples: {
  id: string;
  label: string;
  definition: Definition;
  standard?: Definition;
}[] = [
  { id: 'fet', label: 'Generated FET (boxed)', definition: fet },
  {
    id: 'nmos',
    label: 'N-channel MOSFET',
    definition: builtin('nmos'),
    standard: builtin('nmos'),
  },
  {
    id: 'gain',
    label: 'Gain',
    definition: builtin('gain'),
    standard: builtin('gain'),
  },
];

/** A canned MOSFET drawing with an anchor for every port, by the side it is on. */
function cannedDrawing(definition: Definition): SymbolGlyph {
  const at: Record<string, { x: number; y: number }> = {
    left: { x: 0, y: 24 },
    top: { x: 24, y: 0 },
    bottom: { x: 24, y: 48 },
    right: { x: 32, y: 24 },
  };
  const used: Record<string, number> = {};
  const anchors = Object.fromEntries(
    definition.ports.map((p) => {
      const side = portSide(p);
      const n = (used[side] = (used[side] ?? 0) + 1) - 1;
      const a = at[side];
      return [
        p.id,
        side === 'left' || side === 'right'
          ? { x: a.x, y: a.y + n * 8 }
          : { x: a.x + n * 8, y: a.y },
      ];
    }),
  );
  return {
    width: 32,
    height: 48,
    shapes: [
      {
        type: 'line',
        points: [
          [0, 24],
          [8, 24],
        ],
      },
      {
        type: 'line',
        points: [
          [8, 12],
          [8, 36],
        ],
      },
      {
        type: 'line',
        points: [
          [13, 8],
          [13, 16],
        ],
      },
      {
        type: 'line',
        points: [
          [13, 20],
          [13, 28],
        ],
      },
      {
        type: 'line',
        points: [
          [13, 32],
          [13, 40],
        ],
      },
      {
        type: 'line',
        points: [
          [13, 12],
          [24, 12],
          [24, 0],
        ],
      },
      {
        type: 'line',
        points: [
          [13, 36],
          [24, 36],
          [24, 48],
        ],
      },
      {
        type: 'line',
        points: [
          [13, 24],
          [24, 24],
          [24, 36],
        ],
      },
      {
        type: 'polygon',
        points: [
          [14, 24],
          [20, 20.5],
          [20, 27.5],
        ],
        fill: true,
      },
    ],
    anchors,
    outline: false,
  };
}

export default function SymbolEditorReview() {
  const [open, setOpen] = useState<string | null>(null);
  const [blocks, setBlocks] = useState<Record<string, Block>>(() =>
    Object.fromEntries(
      samples.map((s) => [
        s.id,
        {
          id: `review-${s.id}`,
          definition: s.definition,
          position: { x: 0, y: 0 },
          size: defaultBlockSize(s.definition),
        },
      ]),
    ),
  );
  const [log, setLog] = useState('');
  if (!import.meta.env.DEV)
    return (
      <main className="se-review">
        <p>The symbol editor review page is available in development only.</p>
      </main>
    );
  const sample = samples.find((s) => s.id === open);
  return (
    <main className="se-review">
      <h1>Symbol editor review</h1>
      <p>
        Opens the editor on sample blocks. Apply updates the sample here and
        shows what the workbench would receive.
      </p>
      <ul>
        {samples.map((s) => (
          <li key={s.id}>
            <button
              type="button"
              data-sample={s.id}
              onClick={() => setOpen(s.id)}
            >
              {s.label}
            </button>
          </li>
        ))}
      </ul>
      <pre data-testid="apply-log" aria-label="Last applied result">
        {log}
      </pre>
      {sample && (
        <SymbolEditor
          block={blocks[sample.id]}
          standard={sample.standard}
          aiPrice="Gradara AI · 2 credits · 18 left"
          onAskAi={(description, definition) =>
            new Promise((resolve, reject) =>
              setTimeout(
                () =>
                  description.includes('fail')
                    ? reject(
                        new Error(
                          'The AI could not draw that. Try a shorter description.',
                        ),
                      )
                    : resolve(cannedDrawing(definition)),
                600,
              ),
            )
          }
          onSaveToLibrary={
            sample.definition.generated
              ? () => new Promise((r) => setTimeout(r, 300))
              : undefined
          }
          onApply={(definition, size) => {
            console.log('symbol editor apply', definition, size);
            setLog(
              JSON.stringify(
                {
                  size,
                  ports: definition.ports,
                  glyph: definition.glyph ?? null,
                },
                null,
                1,
              ),
            );
            setBlocks((b) => ({
              ...b,
              [sample.id]: { ...b[sample.id], definition, size },
            }));
            setOpen(null);
          }}
          onClose={() => setOpen(null)}
        />
      )}
    </main>
  );
}
