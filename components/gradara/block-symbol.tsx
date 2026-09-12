import type { ReactNode } from 'react';
import type { Definition } from '@/lib/gradara/model';

function Icon({
  children,
  path,
}: {
  children?: ReactNode;
  path?: string;
}) {
  return (
    <svg viewBox="0 0 60 44">
      {path ? <path d={path} /> : null}
      {children}
    </svg>
  );
}

/** Functional diagram notation, shared by the library and canvas. */
export function BlockSymbol({ definition: d }: { definition: Definition }) {
  const kind = d.kind;
  if (kind === 'sum' || kind === 'subtract') return null;
  if (kind === 'gain') {
    const k = d.parameters.find((p) => p.id === 'k')?.value ?? 1;
    return (
      <span className="gain-value">
        {Math.abs(k - Math.PI / 30) < 1e-9 ? 'π/30' : Number(k.toPrecision(4))}
      </span>
    );
  }
  if (kind === 'constant') return <span>{d.parameters[0]?.value ?? 0}</span>;
  if (kind === 'integrator' || kind === 'discreteIntegrator')
    return (
      <span className="transfer-symbol">
        <span>{kind === 'discreteIntegrator' ? 'Ts' : '1'}</span>
        <span>{kind === 'discreteIntegrator' ? 'z−1' : 's'}</span>
      </span>
    );
  if (kind === 'derivative')
    return (
      <span className="transfer-symbol">
        <span>s</span>
        <span>τs+1</span>
      </span>
    );
  if (kind === 'filter')
    return (
      <span className="transfer-symbol">
        <span>1</span>
        <span>τs+1</span>
      </span>
    );
  if (kind === 'secondOrder')
    return (
      <span className="transfer-symbol">
        <span>ωn²</span>
        <span>s²+2ζωn</span>
      </span>
    );
  if (kind === 'delay')
    return (
      <span className="transfer-symbol">
        <span>e⁻sT</span>
      </span>
    );
  if (kind === 'unitDelay')
    return (
      <span className="transfer-symbol">
        <span>1</span>
        <span>z</span>
      </span>
    );
  if (kind === 'pid' || kind === 'pi' || kind === 'currentPI')
    return <span className="pid-symbol">{kind === 'pid' ? 'PID' : 'PI'}</span>;
  if (kind === 'step')
    return <Icon path="M5 35H26V9H55" />;
  if (kind === 'ramp')
    return <Icon path="M6 36H20L54 8" />;
  if (kind === 'sine')
    return <Icon path="M4 22C10 22 12 8 18 8S26 36 32 36 38 8 44 8 50 22 56 22" />;
  if (kind === 'pulse')
    return <Icon path="M4 36H14V10H30V36H56" />;
  if (kind === 'clock')
    return (
      <Icon>
        <circle cx="30" cy="22" r="14" />
        <path d="M30 12V22L38 26" />
      </Icon>
    );
  if (kind === 'ground')
    return <Icon path="M30 0V16M9 16H51M16 24H44M24 32H36" />;
  if (kind === 'saturation')
    return (
      <Icon>
        <path className="symbol-axis" d="M7 22H53M30 5V39" />
        <path d="M6 34H20L40 10H54" />
      </Icon>
    );
  if (kind === 'deadzone')
    return (
      <Icon>
        <path className="symbol-axis" d="M7 22H53M30 5V39" />
        <path d="M6 36L22 22H38L54 8" />
      </Icon>
    );
  if (kind === 'relay')
    return (
      <Icon>
        <path className="symbol-axis" d="M7 22H53M30 5V39" />
        <path d="M8 34H28V10H52" />
      </Icon>
    );
  if (kind === 'rateLimiter')
    return <Icon path="M6 36H18L42 8H54" />;
  if (kind === 'abs')
    return <Icon path="M18 8V36M42 8V36M24 32L30 12L36 32" />;
  if (kind === 'sign')
    return <Icon path="M8 22H24V10H36V34H52" />;
  if (kind === 'sqrt')
    return <Icon path="M8 24H16L20 34L32 8H54" />;
  if (kind === 'product') return <span className="math-op">×</span>;
  if (kind === 'divide') return <span className="math-op">÷</span>;
  if (kind === 'min') return <span className="math-op">min</span>;
  if (kind === 'max') return <span className="math-op">max</span>;
  if (kind === 'sineOp') return <span className="math-op">sin</span>;
  if (kind === 'cosineOp') return <span className="math-op">cos</span>;
  if (kind === 'unaryMinus') return <span className="math-op">−</span>;
  if (kind === 'power') return <span className="math-op">uⁿ</span>;
  if (kind === 'zoh') return <span className="math-op">ZOH</span>;
  if (kind === 'mux' || kind === 'demux')
    return (
      <span className="mux-label">{kind === 'mux' ? 'MUX' : 'DEMUX'}</span>
    );
  if (kind === 'switch2' || kind === 'manualSwitch')
    return <Icon path="M10 12H28L50 32M28 12V32" />;
  if (kind === 'subsystem')
    return <span className="subsystem-glyph">Subsystem</span>;
  if (kind === 'terminator')
    return <Icon path="M8 22H36M36 10V34L52 22Z" />;
  if (kind === 'scope')
    return (
      <Icon>
        <rect x="8" y="8" width="44" height="28" rx="2" />
        <path d="M14 26C18 26 19 14 24 14S30 30 36 30 41 18 46 18" />
      </Icon>
    );
  if (kind === 'display') return <span className="display-glyph">0.00</span>;
  if (kind === 'resistor')
    return <Icon path="M4 22H14L18 12L26 32L34 12L42 32L46 22H56" />;
  if (kind === 'capacitor')
    return <Icon path="M4 22H24M36 22H56M24 8V36M36 8V36" />;
  if (kind === 'inductor')
    return (
      <Icon path="M4 28H12C12 18 20 18 20 28C20 18 28 18 28 28C28 18 36 18 36 28C36 18 44 18 44 28H56" />
    );
  if (kind === 'diode')
    return <Icon path="M14 22H22M38 22H46M22 10L38 22L22 34Z M38 10V34" />;
  if (kind === 'springDamper')
    return <Icon path="M4 16H14L18 8L26 24L34 8L42 24L46 16H56M4 32H56" />;
  if (kind === 'torqueSensor') return <span className="math-op">τ</span>;
  if (kind === 'motor' || kind === 'pmsm')
    return (
      <svg viewBox="0 0 80 70">
        <circle cx="40" cy="31" r="23" />
        <text x="40" y="40" textAnchor="middle">
          M
        </text>
        {kind === 'pmsm' && (
          <text className="symbol-small" x="40" y="67" textAnchor="middle">
            3~
          </text>
        )}
      </svg>
    );
  if (kind === 'inverter')
    return (
      <svg viewBox="0 0 80 70">
        <path d="M15 55L65 15M17 20H34M17 26H34M45 48Q50 35 55 48T65 48" />
      </svg>
    );
  if (kind === 'voltage') return <span className="math-op">V</span>;
  if (kind === 'inertia' || kind === 'shaftLoad')
    return <span className="math-op">J</span>;
  if (kind === 'sensor') return <span className="math-op">ω</span>;
  if (['clarke', 'park', 'inversePark'].includes(kind)) {
    const [a, b] = d.symbol.split('→');
    return (
      <span className="transform-symbol">
        <span>{a}</span>
        <span>↓</span>
        <span>{b}</span>
      </span>
    );
  }
  return <span>{d.symbol}</span>;
}
