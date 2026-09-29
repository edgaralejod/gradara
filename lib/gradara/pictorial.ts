/**
 * Blocks drawn as unboxed schematic symbols (glyphs in circuit-symbols.ts), with their
 * standard bodies: the glyph plus room for straight leads to grid ports. Kept apart
 * from the glyphs so block-design.ts can size blocks without importing port geometry.
 */
const sizes: [number, number, string[]][] = [
  [
    80,
    48,
    [
      'idealDiode',
      'diodeShockley',
      'zenerDiode',
      'idealThyristor',
      'idealGTO',
      'closingSwitch',
      'openingSwitch',
      'breaker',
      'conductor',
      'variableResistor',
      'variableCapacitor',
      'variableInductor',
      'saturatingInductor',
      'potentiometer',
      'heatingResistor',
      'rotSpring',
      'transSpring',
      'rotDamper',
      'transDamper',
      'transSpringDamper',
    ],
  ],
  [
    48,
    80,
    [
      'sineVoltage',
      'stepVoltage',
      'rampVoltage',
      'pulseVoltage',
      'dcCurrent',
      'sineCurrent',
      'signalVoltage',
      'signalCurrent',
      'batteryStack',
      'supercap',
    ],
  ],
  [64, 80, ['nmos', 'pmos', 'npn', 'pnp']],
  [64, 48, ['opAmp', 'opAmpLimited', 'twoWaySwitch', 'star', 'delta']],
  [64, 64, ['idealTransformer', 'mutualInductor']],
  [48, 48, ['rotFixed', 'transFixed', 'magneticGround']],
];

export const pictorialSizes: Readonly<
  Record<string, { width: number; height: number }>
> = Object.fromEntries(
  sizes.flatMap(([width, height, kinds]) =>
    kinds.map((kind) => [kind, { width, height }]),
  ),
);

export const isPictorial = (kind: string) => kind in pictorialSizes;
