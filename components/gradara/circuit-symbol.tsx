import { domainColors, type Definition } from '@/lib/gradara/model';
import { circuitLayout } from '@/lib/gradara/circuit-symbols';

/**
 * An unboxed schematic symbol drawn at its design size in a body of `size`, with a
 * lead from every port to the glyph (see lib/gradara/circuit-symbols.ts). Leads of
 * signal and Boolean ports are dashed in their domain color, like the existing
 * gate and sensor leads.
 */
export function CircuitSymbol({
  definition,
  size,
}: {
  definition: Definition;
  size: { width: number; height: number };
}) {
  const layout = circuitLayout(definition, size);
  if (!layout) return null;
  const { glyph, x, y, leads } = layout;
  return (
    <svg
      className="circuit-symbol"
      viewBox={`0 0 ${size.width} ${size.height}`}
      width="100%"
      height="100%"
    >
      {leads.map((lead) => (
        <path
          key={lead.port}
          d={lead.d}
          style={{
            stroke: domainColors[lead.domain],
            strokeDasharray:
              lead.domain === 'signal' || lead.domain === 'boolean'
                ? '3 3'
                : undefined,
          }}
        />
      ))}
      <g transform={`translate(${x} ${y})`}>
        <path d={glyph.path} />
        {glyph.fill && <path className="glyph-fill" d={glyph.fill} />}
      </g>
    </svg>
  );
}
