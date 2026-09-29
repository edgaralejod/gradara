/**
 * Pictorial (unboxed) schematic symbols.
 *
 * A glyph is drawn once, in its own small design box, with an anchor for every port:
 * the point where that port's lead meets the drawing. The block draws the glyph at its
 * design size, centered in the body, and runs a lead from each port (on the sheet grid,
 * see grid.ts) to its anchor. Because anchors for a side's single port sit on the
 * glyph's center line, those leads are straight at the default size; larger bodies
 * only lengthen them, so the symbol never distorts when a block is resized.
 */
import type { Definition, Domain } from './model';
import { portOffset, portSide, sideLength } from './ports';

export type Glyph = {
  width: number;
  height: number;
  /** Stroked outline, in design-box units. */
  path: string;
  /** Filled shapes (arrowheads). */
  fill?: string;
  /** Port ID → where its lead meets the glyph. */
  anchors: Record<string, { x: number; y: number }>;
};

// ── Reusable parts ────────────────────────────────────────────────────────────
const zigzag = (x0: number, y: number) =>
  `M${x0} ${y}L${x0 + 3} ${y - 6}L${x0 + 9} ${y + 6}L${x0 + 15} ${y - 6}L${x0 + 21} ${y + 6}L${x0 + 24} ${y}`;
const coil = (x0: number, y: number, turns = 4) =>
  `M${x0} ${y}` +
  Array.from(
    { length: turns },
    (_, i) =>
      `C${x0 + i * 6} ${y - 8} ${x0 + i * 6 + 6} ${y - 8} ${x0 + i * 6 + 6} ${y}`,
  ).join('');
/** A diagonal "variable" arrow across a horizontal element, head up and to the right. */
const variableArrow = { path: 'M8 27L31 6', fill: 'M33 4L25.5 6.5L30.5 11.5Z' };
const twoTerminal = (anchorsY = 16) => ({
  p: { x: 0, y: anchorsY },
  n: { x: 40, y: anchorsY },
});
const diodeBody = 'M0 16H12M28 16H40M12 6L28 16L12 26ZM28 6V26';

// ── Glyphs ────────────────────────────────────────────────────────────────────
const g: Record<string, Glyph> = {
  idealDiode: {
    width: 40,
    height: 32,
    path: diodeBody,
    anchors: twoTerminal(),
  },
  diodeShockley: {
    width: 40,
    height: 32,
    path: diodeBody,
    anchors: twoTerminal(),
  },
  zenerDiode: {
    width: 40,
    height: 32,
    path: 'M0 16H12M28 16H40M12 6L28 16L12 26ZM24 4L28 6V26L32 28',
    anchors: twoTerminal(),
  },
  idealThyristor: {
    width: 40,
    height: 32,
    path: `${diodeBody}M28 21L20 29`,
    anchors: { ...twoTerminal(), fire: { x: 20, y: 29 } },
  },
  idealGTO: {
    width: 40,
    height: 32,
    path: `${diodeBody}M28 21L20 29M32 23L25 30`,
    anchors: { ...twoTerminal(), fire: { x: 20, y: 29 } },
  },
  nmos: {
    width: 36,
    height: 44,
    path: 'M0 22H5M5 12V32M10 8V16M10 18V26M10 28V36M10 12H18V0M10 32H18V44M18 22H36M18 32V22',
    fill: 'M11 22L17 18.5V25.5Z',
    anchors: {
      D: { x: 18, y: 0 },
      G: { x: 0, y: 22 },
      S: { x: 18, y: 44 },
      B: { x: 36, y: 22 },
    },
  },
  pmos: {
    width: 36,
    height: 44,
    path: 'M0 22H5M5 12V32M10 8V16M10 18V26M10 28V36M10 12H18V0M10 32H18V44M18 22H36M18 12V22',
    fill: 'M18 22L12 18.5V25.5Z',
    anchors: {
      S: { x: 18, y: 0 },
      G: { x: 0, y: 22 },
      D: { x: 18, y: 44 },
      B: { x: 36, y: 22 },
    },
  },
  npn: {
    width: 36,
    height: 44,
    path: 'M0 22H9M9 12V32M9 17L18 11V0M9 27L18 33V44M34 22A16 16 0 1 1 34 21.9',
    fill: 'M18 33L11.5 32.5L14.5 28Z',
    anchors: { C: { x: 18, y: 0 }, B: { x: 0, y: 22 }, E: { x: 18, y: 44 } },
  },
  pnp: {
    width: 36,
    height: 44,
    path: 'M0 22H9M9 12V32M9 17L18 11V0M9 27L18 33V44M34 22A16 16 0 1 1 34 21.9',
    fill: 'M9.5 16.5L13.5 11.5L15.5 15.5Z',
    anchors: { E: { x: 18, y: 0 }, B: { x: 0, y: 22 }, C: { x: 18, y: 44 } },
  },
  closingSwitch: {
    width: 40,
    height: 32,
    path: 'M0 16H10M30 16H40M10 16L28 6',
    anchors: { ...twoTerminal(), control: { x: 20, y: 11 } },
  },
  openingSwitch: {
    width: 40,
    height: 32,
    path: 'M0 16H10M30 16H40M10 16L33 11M30 16V10',
    anchors: { ...twoTerminal(), control: { x: 20, y: 11 } },
  },
  breaker: {
    width: 40,
    height: 32,
    path: 'M0 16H10M30 16H40M10 16L33 11M30 16V10M16 22Q20 18 24 22',
    anchors: { ...twoTerminal(), control: { x: 20, y: 11 } },
  },
  twoWaySwitch: {
    width: 40,
    height: 32,
    path: 'M0 16H10M30 8H40M30 24H40M10 16L29 9',
    anchors: {
      p: { x: 0, y: 16 },
      n1: { x: 40, y: 8 },
      n2: { x: 40, y: 24 },
      control: { x: 20, y: 12 },
    },
  },
  conductor: {
    width: 40,
    height: 32,
    path: 'M0 16H8M32 16H40M8 10H32V22H8Z',
    anchors: twoTerminal(),
  },
  variableResistor: {
    width: 40,
    height: 32,
    path: `M0 16H8${zigzag(8, 16)}M32 16H40${variableArrow.path}`,
    fill: variableArrow.fill,
    anchors: { ...twoTerminal(), R: { x: 20, y: 6 } },
  },
  variableCapacitor: {
    width: 40,
    height: 32,
    path: `M0 16H17M23 16H40M17 6V26M23 6V26${variableArrow.path}`,
    fill: variableArrow.fill,
    anchors: { ...twoTerminal(), C: { x: 20, y: 4 } },
  },
  variableInductor: {
    width: 40,
    height: 32,
    path: `M0 16H8${coil(8, 16)}H40${variableArrow.path}`,
    fill: variableArrow.fill,
    anchors: { ...twoTerminal(), L: { x: 20, y: 6 } },
  },
  saturatingInductor: {
    width: 40,
    height: 32,
    path: `M0 16H8${coil(8, 16)}H40M8 22H32M8 25H32`,
    anchors: twoTerminal(),
  },
  potentiometer: {
    width: 40,
    height: 32,
    path: `M0 16H8${zigzag(8, 16)}M32 16H40M20 32V24`,
    fill: 'M20 23L16.5 28H23.5Z',
    anchors: {
      pin_p: { x: 0, y: 16 },
      pin_n: { x: 40, y: 16 },
      contact: { x: 20, y: 32 },
      r: { x: 20, y: 8 },
    },
  },
  heatingResistor: {
    width: 40,
    height: 32,
    path: `M0 16H8${zigzag(8, 16)}M32 16H40`,
    anchors: { ...twoTerminal(), heatPort: { x: 20, y: 22 } },
  },
  opAmp: {
    width: 40,
    height: 40,
    path: 'M0 12H6M0 28H6M38 20H40M6 2L38 20L6 38ZM9 12H15M12 9V15M9 28H15',
    anchors: {
      in_p: { x: 0, y: 12 },
      in_n: { x: 0, y: 28 },
      out: { x: 40, y: 20 },
    },
  },
  opAmpLimited: {
    width: 40,
    height: 40,
    path: 'M0 12H6M0 28H6M38 20H40M6 2L38 20L6 38ZM9 12H15M12 9V15M9 28H15M18 23H21L26 17H29',
    anchors: {
      in_p: { x: 0, y: 12 },
      in_n: { x: 0, y: 28 },
      out: { x: 40, y: 20 },
    },
  },
  idealTransformer: {
    width: 48,
    height: 40,
    path:
      'M0 12H14M0 28H14M34 12H48M34 28H48' +
      'M14 12C21 12 21 16 14 16C21 16 21 20 14 20C21 20 21 24 14 24C21 24 21 28 14 28' +
      'M34 12C27 12 27 16 34 16C27 16 27 20 34 20C27 20 27 24 34 24C27 24 27 28 34 28' +
      'M23 8V32M25 8V32',
    anchors: {
      p1: { x: 0, y: 12 },
      n1: { x: 0, y: 28 },
      p2: { x: 48, y: 12 },
      n2: { x: 48, y: 28 },
    },
  },
  mutualInductor: {
    width: 48,
    height: 40,
    path:
      'M0 12H14M0 28H14M34 12H48M34 28H48' +
      'M14 12C21 12 21 16 14 16C21 16 21 20 14 20C21 20 21 24 14 24C21 24 21 28 14 28' +
      'M34 12C27 12 27 16 34 16C27 16 27 20 34 20C27 20 27 24 34 24C27 24 27 28 34 28' +
      'M20 4Q24 1 28 4',
    fill: 'M11 9A1.6 1.6 0 1 0 11 9.1ZM37 9A1.6 1.6 0 1 0 37 9.1Z',
    anchors: {
      p1: { x: 0, y: 12 },
      n1: { x: 0, y: 28 },
      p2: { x: 48, y: 12 },
      n2: { x: 48, y: 28 },
    },
  },
  // Vertical sources: + at the top, − at the bottom.
  ...Object.fromEntries(
    (
      [
        ['sineVoltage', 'M9 24Q12.5 16 16 24T23 24'],
        ['stepVoltage', 'M9 29H15V19H23'],
        ['rampVoltage', 'M9 29L23 18'],
        ['pulseVoltage', 'M8 29H12V19H19V29H24'],
        ['dcCurrent', 'M16 16V32'],
        ['sineCurrent', 'M13 16V32M18 20Q20 16 22 20T26 20'],
      ] as const
    ).map(([kind, inside]) => [
      kind,
      {
        width: 32,
        height: 48,
        path: `M16 0V12M16 36V48M28 24A12 12 0 1 1 28 23.9${inside}`,
        fill: kind.endsWith('Current')
          ? `M${kind === 'dcCurrent' ? 16 : 13} 34L${kind === 'dcCurrent' ? 12.5 : 9.5} 28H${kind === 'dcCurrent' ? 19.5 : 16.5}Z`
          : undefined,
        anchors: { p: { x: 16, y: 0 }, n: { x: 16, y: 48 } },
      } satisfies Glyph,
    ]),
  ),
  signalVoltage: {
    width: 32,
    height: 48,
    path: 'M16 0V10M16 38V48M16 10L28 24L16 38L4 24ZM16 15V21M13 18H19M13 31H19',
    anchors: { p: { x: 16, y: 0 }, n: { x: 16, y: 48 }, v: { x: 4, y: 24 } },
  },
  signalCurrent: {
    width: 32,
    height: 48,
    path: 'M16 0V10M16 38V48M16 10L28 24L16 38L4 24ZM16 15V30',
    fill: 'M16 33L12.5 27H19.5Z',
    anchors: { p: { x: 16, y: 0 }, n: { x: 16, y: 48 }, i: { x: 4, y: 24 } },
  },
  batteryStack: {
    width: 32,
    height: 48,
    path: 'M16 0V15M4 15H28M10 20H22M4 26H28M10 31H22M16 31V48M22 6H26M24 4V8',
    anchors: { p: { x: 16, y: 0 }, n: { x: 16, y: 48 } },
  },
  supercap: {
    width: 32,
    height: 48,
    path: 'M16 0V20M5 20H27M5 28H27M16 28V48M5 32H27M22 9H26M24 7V11',
    anchors: { p: { x: 16, y: 0 }, n: { x: 16, y: 48 } },
  },
  // Mechanics: flange a on the left, flange b on the right.
  rotSpring: {
    width: 40,
    height: 24,
    path: `M0 12H8${zigzag(8, 12)}M32 12H40`,
    anchors: { flange_a: { x: 0, y: 12 }, flange_b: { x: 40, y: 12 } },
  },
  transSpring: {
    width: 40,
    height: 24,
    path: `M0 12H8${zigzag(8, 12)}M32 12H40`,
    anchors: { flange_a: { x: 0, y: 12 }, flange_b: { x: 40, y: 12 } },
  },
  rotDamper: {
    width: 40,
    height: 24,
    path: 'M0 12H12M12 4V20M12 4H30M12 20H30M22 7V17M22 12H40',
    anchors: { flange_a: { x: 0, y: 12 }, flange_b: { x: 40, y: 12 } },
  },
  transDamper: {
    width: 40,
    height: 24,
    path: 'M0 12H12M12 4V20M12 4H30M12 20H30M22 7V17M22 12H40',
    anchors: { flange_a: { x: 0, y: 12 }, flange_b: { x: 40, y: 12 } },
  },
  transSpringDamper: {
    width: 40,
    height: 32,
    path: `M0 16H6M34 16H40M6 6V26M34 6V26M6 6H8${zigzag(8, 6)}M32 6H34M6 26H13M13 20V32M13 20H27M13 32H27M20 23V29M20 26H34`,
    anchors: { flange_a: { x: 0, y: 16 }, flange_b: { x: 40, y: 16 } },
  },
  rotFixed: {
    width: 32,
    height: 24,
    path: 'M16 0V10M2 10H30M4 18L10 10M10 18L16 10M16 18L22 10M22 18L28 10',
    anchors: { flange: { x: 16, y: 0 } },
  },
  transFixed: {
    width: 32,
    height: 24,
    path: 'M16 0V10M2 10H30M4 18L10 10M10 18L16 10M16 18L22 10M22 18L28 10',
    anchors: { flange: { x: 16, y: 0 } },
  },
  magneticGround: {
    width: 32,
    height: 24,
    path: 'M16 0V8M4 8H28M9 14H23M13 20H19',
    anchors: { port: { x: 16, y: 0 } },
  },
  star: {
    width: 32,
    height: 32,
    path: 'M0 16H10M10 16L16 10M10 16L16 22M16 10H22M16 22H22M16 10L22 16L16 22M22 16H32',
    anchors: { plug_p: { x: 0, y: 16 }, pin_n: { x: 32, y: 16 } },
  },
  delta: {
    width: 32,
    height: 32,
    path: 'M0 16H8M24 16H32M8 16L16 6L24 16L16 26Z',
    anchors: { plug_p: { x: 0, y: 16 }, plug_n: { x: 32, y: 16 } },
  },
};

export const circuitGlyphs: Readonly<Record<string, Glyph>> = g;

export type Lead = { port: string; domain: Domain; d: string };

/**
 * Where the glyph sits in a body of `size` (before rotation), and a lead from each
 * port to its anchor: straight when they line up, otherwise out from the port to the
 * anchor's line, then across.
 */
export function circuitLayout(
  definition: Definition,
  size: { width: number; height: number },
) {
  const glyph = g[definition.kind];
  if (!glyph) return undefined;
  const x0 = (size.width - glyph.width) / 2,
    y0 = (size.height - glyph.height) / 2;
  const leads: Lead[] = [];
  for (const port of definition.ports) {
    const anchor = glyph.anchors[port.id];
    if (!anchor) continue;
    const side = portSide(port);
    const along =
      (portOffset(definition, port, sideLength(port, size)) / 100) *
      (side === 'left' || side === 'right' ? size.height : size.width);
    const at = Math.round(along * 1e6) / 1e6;
    const a = { x: x0 + anchor.x, y: y0 + anchor.y };
    let d: string;
    if (side === 'left' || side === 'right') {
      const x = side === 'left' ? 0 : size.width;
      d = at === a.y ? `M${x} ${at}H${a.x}` : `M${x} ${at}H${a.x}V${a.y}`;
    } else {
      const y = side === 'top' ? 0 : size.height;
      d = at === a.x ? `M${at} ${y}V${a.y}` : `M${at} ${y}V${a.y}H${a.x}`;
    }
    leads.push({ port: port.id, domain: port.domain, d });
  }
  return { glyph, x: x0, y: y0, leads };
}
