import { library, type Block, type Project, type Wire } from './model';
export function focProject(): Project {
  const blocks: Block[] = [];
  function add(
    kind: string,
    id: string,
    name: string,
    x: number,
    y: number,
    width: number,
    height: number,
    params: Record<string, number> = {},
  ) {
    const definition = structuredClone(library.find((d) => d.kind === kind)!);
    definition.name = name;
    definition.parameters.forEach((p) => {
      if (params[p.id] !== undefined) p.value = params[p.id];
    });
    blocks.push({
      id,
      definition,
      position: { x, y },
      size: { width, height },
    });
    return definition;
  }
  const ref = add('step', 'reference', 'Speed command', 0, 95, 64, 56, {
    height: 1500,
    startTime: 0.03,
  });
  ref.parameters[0].name = 'Target speed';
  ref.parameters[0].unit = 'rpm';
  ref.ports[0].unit = 'rpm';
  add('gain', 'units', 'rpm → rad/s', 115, 95, 65, 56, { k: Math.PI / 30 });
  add('subtract', 'speedError', 'Speed error', 230, 105, 36, 36);
  add('gain', 'speedKp', 'Kp · speed', 330, 95, 68, 56, { k: 0.16 });
  add('gain', 'speedKi', 'Ki · speed', 330, 235, 68, 56, { k: 1.2 });
  add('integrator', 'speedIntegral', 'Integral', 445, 233, 60, 60, {
    limit: 3,
  });
  add('sum', 'speedSum', 'PI sum', 475, 105, 36, 36);
  const iqref = add(
    'saturation',
    'iqReference',
    'Current limit',
    570,
    95,
    64,
    56,
    { lower: -8, upper: 8 },
  );
  iqref.ports[1].unit = 'A';
  add('subtract', 'qError', 'q-axis error', 710, 105, 36, 36);
  add('currentPI', 'qPI', 'q-axis PI', 805, 88, 100, 70);
  const dref = add('constant', 'dReference', 'id* = 0 A', 575, 252, 54, 42);
  dref.ports[0].unit = 'A';
  add('subtract', 'dError', 'd-axis error', 710, 255, 36, 36);
  add('currentPI', 'dPI', 'd-axis PI', 805, 238, 100, 70);
  const inverse = add(
    'inversePark',
    'inverse',
    'Inverse Park / Clarke',
    985,
    135,
    115,
    120,
  );
  inverse.ports.find((p) => p.id === 'vd')!.offset = 70;
  inverse.ports.find((p) => p.id === 'vq')!.offset = 30;
  add('inverter', 'inverter', 'Averaged inverter', 1160, 135, 110, 120);
  add('pmsm', 'motor', 'PMSM · 4 pole pairs', 1330, 135, 120, 120);
  add('shaftLoad', 'load', 'Inertia + load step', 1510, 155, 100, 80);
  add('clarke', 'clarke', 'Clarke', 1180, 400, 110, 90);
  add('park', 'park', 'Park', 975, 400, 110, 90);
  const wires: Wire[] = [];
  function wire(
    source: string,
    sourceHandle: string,
    target: string,
    targetHandle: string,
    waypoints?: [number, number][],
  ) {
    wires.push({
      id: `w_${wires.length}`,
      source,
      sourceHandle,
      target,
      targetHandle,
      ...(waypoints
        ? { waypoints: waypoints.map(([x, y]) => ({ x, y })) }
        : {}),
    });
  }
  wire('reference', 'y', 'units', 'u');
  wire('units', 'y', 'speedError', 'a');
  wire('speedError', 'y', 'speedKp', 'u');
  wire('speedError', 'y', 'speedKi', 'u', [
    [300, 123],
    [300, 263],
  ]);
  wire('speedKp', 'y', 'speedSum', 'a');
  wire('speedKi', 'y', 'speedIntegral', 'u');
  wire('speedIntegral', 'y', 'speedSum', 'b', [
    [535, 263],
    [535, 200],
    [493, 200],
  ]);
  wire('speedSum', 'y', 'iqReference', 'u');
  wire('iqReference', 'y', 'qError', 'a');
  wire('qError', 'y', 'qPI', 'u');
  wire('dReference', 'y', 'dError', 'a');
  wire('dError', 'y', 'dPI', 'u');
  wire('qPI', 'y', 'inverse', 'vq', [
    [945, 123],
    [945, 171],
  ]);
  wire('dPI', 'y', 'inverse', 'vd', [
    [945, 273],
    [945, 219],
  ]);
  for (const phase of ['a', 'b', 'c']) {
    wire('inverse', 'v' + phase, 'inverter', 'u' + phase);
    wire('inverter', 'v' + phase, 'motor', 'v' + phase);
  }
  wire('motor', 'flange', 'load', 'flange');
  for (const [i, phase] of ['a', 'b', 'c'].entries())
    wire('motor', 'i' + phase, 'clarke', 'i' + phase, [
      [1354 + i * 24, 422.5 + i * 22.5],
    ]);
  wire('clarke', 'alpha', 'park', 'alpha');
  wire('clarke', 'beta', 'park', 'beta');
  wire('park', 'id', 'dError', 'b', [
    [880, 430],
    [728, 430],
  ]);
  wire('park', 'iq', 'qError', 'b', [
    [925, 460],
    [675, 460],
    [675, 200],
    [728, 200],
  ]);
  wire('motor', 'theta', 'inverse', 'theta', [
    [1426, 550],
    [1120, 550],
    [1120, 320],
    [1042.5, 320],
  ]);
  wire('motor', 'theta', 'park', 'theta', [
    [1426, 550],
    [1030, 550],
  ]);
  wire('motor', 'wm', 'speedError', 'b', [
    [1360, 40],
    [1660, 40],
    [1660, 615],
    [248, 615],
  ]);
  wires.find(
    (w) => w.source === 'speedError' && w.target === 'speedKi',
  )!.junctions = [{ x: 300, y: 123 }];
  wires.find(
    (w) => w.sourceHandle === 'theta' && w.target === 'inverse',
  )!.junctions = [{ x: 1120, y: 550 }];
  return {
    version: 1,
    exampleId: 'foc',
    name: 'PMSM · Field-oriented control',
    duration: 1.2,
    revision: 0,
    blocks,
    wires,
    description:
      '1500 rpm speed command with cascaded d/q current control. A 48 V averaged inverter drives a surface PMSM and a mechanical load that increases at 0.45 s. Ideal current and rotor-position feedback; continuous controllers; no PWM ripple or sensor noise.',
    annotations: [
      {
        x: 0,
        y: -25,
        text: '01  SPEED CONTROL',
        detail: 'Speed error → PI → torque-producing current',
      },
      {
        x: 710,
        y: -25,
        text: '02  CURRENT CONTROL',
        detail: 'Independent d / q regulators',
      },
      {
        x: 1160,
        y: -25,
        text: '03  POWER & MECHANICS',
        detail: '48 V inverter · three-phase AC motor',
      },
      {
        x: 925,
        y: 350,
        text: 'CURRENT FEEDBACK',
        detail: 'abc → αβ → dq',
      },
      { x: 20, y: 555, text: 'ωm  ·  SPEED FEEDBACK' },
      { x: 1130, y: 565, text: 'θe  ·  ELECTRICAL ANGLE' },
    ],
    plots: [
      {
        id: 'speed',
        label: 'Speed',
        series: ['motor.rpm', 'reference.y'],
        labels: ['Rotor speed', 'Speed command'],
      },
      {
        id: 'current',
        label: 'd/q currents',
        series: ['park.iq', 'iqReference.y', 'park.id'],
        labels: ['iq · measured', 'iq · command', 'id · measured'],
      },
      {
        id: 'phases',
        label: 'Phase currents',
        series: ['motor.ia', 'motor.ib', 'motor.ic'],
        labels: ['Phase a', 'Phase b', 'Phase c'],
      },
      {
        id: 'torque',
        label: 'Torque',
        series: ['motor.torque', 'load.loadTorque'],
        labels: ['Motor torque', 'Load torque'],
      },
      {
        id: 'voltage',
        label: 'd/q voltages',
        series: ['qPI.y', 'dPI.y'],
        labels: ['vq', 'vd'],
      },
    ],
  };
}
