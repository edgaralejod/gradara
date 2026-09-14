import type { ReactNode } from 'react';
import type { Definition } from '@/lib/gradara/model';
import { formatBlockValue } from '@/lib/gradara/block-design';

function Icon({
  children,
  path,
  stretch = false,
  vertical = false,
}: {
  children?: ReactNode;
  path?: string;
  stretch?: boolean;
  vertical?: boolean;
}) {
  return (
    <svg
      viewBox={vertical ? '0 0 44 60' : '0 0 60 44'}
      preserveAspectRatio={stretch ? 'none' : 'xMidYMid meet'}
    >
      <g transform={vertical ? 'translate(44 0) rotate(90)' : undefined}>
        {path ? <path d={path} /> : null}
        {children}
      </g>
    </svg>
  );
}

/** Functional diagram notation, shared by the library and canvas. */
export function BlockSymbol({
  definition: d,
  thumbnail = false,
}: {
  definition: Definition;
  thumbnail?: boolean;
}) {
  const kind = d.kind;
  const vertical =
    d.ports.find((p) => p.direction === 'physical')?.side === 'top';
  if (kind === 'sum' || kind === 'subtract') return null;
  if (kind === 'gain') {
    const k = d.parameters.find((p) => p.id === 'k')?.value ?? 1;
    return (
      <span className="gain-value">
        {Math.abs(k - Math.PI / 30) < 1e-9 ? 'π/30' : formatBlockValue(k)}
      </span>
    );
  }
  if (kind === 'constant')
    return (
      <span className="value-symbol">
        {formatBlockValue(d.parameters[0]?.value ?? 0)}
      </span>
    );
  if (kind === 'integrator' || kind === 'discreteIntegrator')
    return (
      <span className="transfer-symbol">
        <span>{kind === 'discreteIntegrator' ? 'Ts·z' : '1'}</span>
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
  if (kind === 'secondOrder' && thumbnail)
    return <span className="math-op">H(s)</span>;
  if (kind === 'secondOrder')
    return (
      <span className="transfer-symbol">
        <span>ωₙ²</span>
        <span>s² + 2ζωₙs + ωₙ²</span>
      </span>
    );
  if (kind === 'delay')
    return (
      <span className="transfer-symbol">
        <span>
          e<sup>−sT</sup>
        </span>
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
  if (kind === 'step') return <Icon path="M5 35H26V9H55" />;
  if (kind === 'ramp') return <Icon path="M6 36H20L54 8" />;
  if (kind === 'sine')
    return (
      <Icon path="M4 22C10 22 12 8 18 8S26 36 32 36 38 8 44 8 50 22 56 22" />
    );
  if (kind === 'pulse') return <Icon path="M4 36H14V10H30V36H56" />;
  if (kind === 'clock')
    return (
      <Icon>
        <circle cx="30" cy="22" r="14" />
        <path d="M30 12V22L38 26" />
      </Icon>
    );
  if (kind === 'ground')
    return <Icon stretch path="M30 0V16M9 16H51M16 24H44M24 32H36" />;
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
  if (kind === 'rateLimiter') return <Icon path="M6 36H18L42 8H54" />;
  if (kind === 'abs') return <span className="math-op">|u|</span>;
  if (kind === 'sign') return <span className="math-op">sgn</span>;
  if (kind === 'sqrt') return <Icon path="M8 24H16L20 34L32 8H54" />;
  if (kind === 'product') return <span className="math-op">×</span>;
  if (kind === 'divide') return <span className="math-op">÷</span>;
  if (kind === 'min') return <span className="math-op">min</span>;
  if (kind === 'max') return <span className="math-op">max</span>;
  if (kind === 'sineOp') return <span className="math-op">sin</span>;
  if (kind === 'cosineOp') return <span className="math-op">cos</span>;
  if (kind === 'unaryMinus') return <span className="math-op">−</span>;
  if (kind === 'power') return <span className="math-op">uⁿ</span>;
  if (kind === 'zoh') return <span className="math-op">ZOH</span>;
  if (kind === 'mux' || kind === 'demux') return null;
  if (kind === 'switch2' || kind === 'manualSwitch')
    return <Icon path="M4 10H18M4 34H18M56 22H42L20 11" />;
  if (kind === 'subsystem')
    return (
      <Icon>
        <rect x="9" y="9" width="16" height="26" />
        <rect x="39" y="15" width="12" height="14" />
        <path d="M0 22H9M25 22H39M51 22H60" />
      </Icon>
    );
  if (kind === 'terminator') return <Icon path="M8 22H36M36 10V34L52 22Z" />;
  if (kind === 'scope')
    return (
      <Icon>
        <rect x="8" y="8" width="44" height="28" rx="2" />
        <path d="M14 26C18 26 19 14 24 14S30 30 36 30 41 18 46 18" />
      </Icon>
    );
  if (kind === 'display') return <span className="display-glyph">123</span>;
  if (kind === 'idealSwitch')
    return (
      <svg viewBox="0 0 48 80" preserveAspectRatio="none">
        <path d="M24 0V25M24 55V80M24 55L38 28" />
        <circle cx="24" cy="25" r="2" />
        <circle cx="24" cy="55" r="2" />
        <path d="M0 40H13" stroke="#336184" strokeDasharray="3 3" />
      </svg>
    );
  if (kind === 'dcSource' || kind === 'voltageSensor')
    return (
      <svg viewBox="0 0 48 80" preserveAspectRatio="none">
        <path d="M24 0V22M24 58V80" />
        <ellipse cx="24" cy="40" rx="17" ry="18" />
        {kind === 'dcSource' ? (
          <path d="M20 32H28M24 28V36M20 48H28" />
        ) : (
          <>
            <path d="M18 34L24 46L30 34" />
            <path d="M41 40H48" stroke="#336184" />
          </>
        )}
      </svg>
    );
  if (kind === 'currentSensor')
    return (
      <svg viewBox="0 0 80 48" preserveAspectRatio="none">
        <path d="M0 24H22M58 24H80" />
        <circle cx="40" cy="24" r="18" />
        <path d="M33 32L40 16L47 32M36 26H44" />
        <path d="M40 42V48" stroke="#336184" />
      </svg>
    );
  if (kind === 'resistor')
    return (
      <Icon
        stretch
        vertical={vertical}
        path="M0 22H14L18 12L26 32L34 12L42 32L46 22H60"
      />
    );
  if (kind === 'capacitor')
    return (
      <Icon
        stretch
        vertical={vertical}
        path="M0 22H24M36 22H60M24 8V36M36 8V36"
      />
    );
  if (kind === 'inductor')
    return (
      <Icon
        stretch
        vertical={vertical}
        path="M0 22H12C12 10 20 10 20 22C20 10 28 10 28 22C28 10 36 10 36 22C36 10 44 10 44 22H60"
      />
    );
  if (kind === 'diode')
    return (
      <Icon
        stretch
        vertical={vertical}
        path="M0 22H22M38 22H60M22 10L38 22L22 34Z M38 10V34"
      />
    );
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
        <span>{thumbnail ? `${a}→${b}` : `${a} → ${b}`}</span>
      </span>
    );
  }
  return (
    <span className="custom-symbol">
      {d.symbol.length > 12 ? `${d.symbol.slice(0, 11)}…` : d.symbol}
    </span>
  );
}
