'use client';

import { Background, BackgroundVariant, useStore } from '@xyflow/react';
import { GRID } from '@/lib/gradara/grid';

/** Major lines every five grid steps. */
const MAJOR = GRID * 5;

/**
 * The sheet background. Hidden, it is a faint dot every five grid steps, aligned
 * with the grid. Shown, it draws every grid point, the points blocks and ports
 * snap to, with a line every five steps; the fine dots fade out when zoomed out so
 * far that they would merge into a tint.
 */
export default function GridBackground({ visible }: { visible: boolean }) {
  const zoom = useStore((s) => s.transform[2]);
  if (!visible)
    return <Background id="sheet" gap={MAJOR} size={0.8} color="#dde3e8" />;
  return (
    <>
      <Background
        id="grid-major"
        variant={BackgroundVariant.Lines}
        gap={MAJOR}
        lineWidth={0.6}
        color="#e4e9ef"
      />
      {zoom >= 0.6 && (
        <Background id="grid-minor" gap={GRID} size={0.9} color="#c8d0d8" />
      )}
    </>
  );
}
