"""Small packaging adapter; OpenModelica owns equation processing and execution."""
from .logging_signals import logged_signals
import hashlib
import json
from . import msl
from .models import BOUNDARY_KINDS, Definition, Project, flatten_connects

PHYSICAL = {
 'voltage': '''model {name}
  Modelica.Blocks.Interfaces.RealInput u;
  Modelica.Electrical.Analog.Interfaces.PositivePin p;
  Modelica.Electrical.Analog.Interfaces.NegativePin n;
 equation
  p.v - n.v = u;
  p.i + n.i = 0;
 end {name};''',
 'motor': '''model {name}
  parameter Real R=1.2;
  parameter Real L=0.02;
  parameter Real k=0.15;
  Modelica.Electrical.Analog.Interfaces.PositivePin p;
  Modelica.Electrical.Analog.Interfaces.NegativePin n;
  Modelica.Mechanics.Rotational.Interfaces.Flange_b flange;
  Real i(start=0, fixed=true);
  Real v;
  Real w;
 equation
  p.i = i;
  p.i + n.i = 0;
  v = p.v-n.v;
  w = der(flange.phi);
  L*der(i) = v-R*i-k*w;
  flange.tau = -k*i;
 end {name};''',
 'inertia': '''model {name}
  parameter Real J=0.02;
  parameter Real damping=0.002;
  Modelica.Mechanics.Rotational.Interfaces.Flange_a a;
  Modelica.Mechanics.Rotational.Interfaces.Flange_b b;
  Real phi(start=0, fixed=true);
  Real w(start=0, fixed=true);
 equation
  a.phi = phi;
  b.phi = phi;
  der(phi) = w;
  J*der(w) = a.tau+b.tau-damping*w;
 end {name};''',
 'sensor': '''model {name}
  Modelica.Mechanics.Rotational.Interfaces.Flange_a flange;
  Modelica.Blocks.Interfaces.RealOutput y;
 equation
  y = der(flange.phi);
  flange.tau = 0;
 end {name};''',
 'ground': '''model {name}
  extends Modelica.Electrical.Analog.Basic.Ground;
 end {name};''',
}

PHYSICAL['pmsm'] = '''model {name}
  parameter Real R=0.35, Ld=0.001, Lq=0.001, psi=0.035, polePairs=4;
  Modelica.Blocks.Interfaces.RealInput va, vb, vc;
  Modelica.Blocks.Interfaces.RealOutput ia, ib, ic, theta, wm, rpm, torque;
  Modelica.Mechanics.Rotational.Interfaces.Flange_b flange;
  Real id(start=0, fixed=true), iq(start=0, fixed=true);
  Real vd, vq, we;
 equation
  theta = polePairs*flange.phi;
  wm = der(flange.phi);
  we = polePairs*wm;
  rpm = wm*60/(2*Modelica.Constants.pi);
  vd = 2/3*(va*cos(theta)+vb*cos(theta-2*Modelica.Constants.pi/3)+vc*cos(theta+2*Modelica.Constants.pi/3));
  vq = -2/3*(va*sin(theta)+vb*sin(theta-2*Modelica.Constants.pi/3)+vc*sin(theta+2*Modelica.Constants.pi/3));
  Ld*der(id) = vd-R*id+we*Lq*iq;
  Lq*der(iq) = vq-R*iq-we*(Ld*id+psi);
  torque = 1.5*polePairs*(psi*iq+(Ld-Lq)*id*iq);
  flange.tau = -torque;
  ia = id*cos(theta)-iq*sin(theta);
  ib = id*cos(theta-2*Modelica.Constants.pi/3)-iq*sin(theta-2*Modelica.Constants.pi/3);
  ic = id*cos(theta+2*Modelica.Constants.pi/3)-iq*sin(theta+2*Modelica.Constants.pi/3);
 end {name};'''
PHYSICAL['resistor'] = '''model {name}
  parameter Real R=1;
  Modelica.Electrical.Analog.Interfaces.PositivePin p;
  Modelica.Electrical.Analog.Interfaces.NegativePin n;
equation
  p.v - n.v = R*p.i;
  p.i + n.i = 0;
end {name};'''
PHYSICAL['capacitor'] = '''model {name}
  parameter Real C=0.001;
  Modelica.Electrical.Analog.Interfaces.PositivePin p;
  Modelica.Electrical.Analog.Interfaces.NegativePin n;
  Real v(start=0, fixed=true);
equation
  p.v - n.v = v;
  C*der(v) = p.i;
  p.i + n.i = 0;
end {name};'''
PHYSICAL['inductor'] = '''model {name}
  parameter Real L=0.001;
  Modelica.Electrical.Analog.Interfaces.PositivePin p;
  Modelica.Electrical.Analog.Interfaces.NegativePin n;
  Real i(start=0, fixed=true);
equation
  L*der(i) = p.v - n.v;
  p.i = i;
  p.i + n.i = 0;
end {name};'''
PHYSICAL['diode'] = '''model {name}
  Modelica.Electrical.Analog.Interfaces.PositivePin p;
  Modelica.Electrical.Analog.Interfaces.NegativePin n;
  Real v;
equation
  v = p.v - n.v;
  p.i = noEvent(if v > 0 then v/1e-4 else 0);
  p.i + n.i = 0;
end {name};'''
PHYSICAL['springDamper'] = '''model {name}
  parameter Real c=10, d=0.1;
  Modelica.Mechanics.Rotational.Interfaces.Flange_a a;
  Modelica.Mechanics.Rotational.Interfaces.Flange_b b;
equation
  a.tau = c*(a.phi - b.phi) + d*(der(a.phi) - der(b.phi));
  b.tau = -a.tau;
end {name};'''
PHYSICAL['torqueSensor'] = '''model {name}
  Modelica.Mechanics.Rotational.Interfaces.Flange_a a;
  Modelica.Mechanics.Rotational.Interfaces.Flange_b b;
  Modelica.Blocks.Interfaces.RealOutput y;
equation
  a.phi = b.phi;
  a.tau + b.tau = 0;
  y = a.tau;
end {name};'''
PHYSICAL['angleSensor'] = '''model {name}
  Modelica.Mechanics.Rotational.Interfaces.Flange_a flange;
  Modelica.Blocks.Interfaces.RealOutput y;
 equation
  y = flange.phi;
  flange.tau = 0;
 end {name};'''
PHYSICAL['shaftLoad'] = '''model {name}
  parameter Real J=0.002, damping=0.001, initialLoad=0.05, stepLoad=0.35, loadTime=0.45;
  Modelica.Mechanics.Rotational.Interfaces.Flange_a flange;
  Modelica.Blocks.Interfaces.RealOutput loadTorque;
  Real phi(start=0, fixed=true), w(start=0, fixed=true);
 equation
  flange.phi = phi;
  der(phi) = w;
  loadTorque = initialLoad + (if time < loadTime then 0 else stepLoad);
  J*der(w) = flange.tau - damping*w - loadTorque;
 end {name};'''

# Standard-library components own ideal switching and sensor semantics.
PHYSICAL['dcSource'] = '''model {name}
  extends Modelica.Electrical.Analog.Sources.ConstantVoltage;
end {name};'''
PHYSICAL['idealSwitch'] = '''model {name}
  Modelica.Electrical.Analog.Interfaces.PositivePin p;
  Modelica.Electrical.Analog.Interfaces.NegativePin n;
  Modelica.Blocks.Interfaces.RealInput gate;
  Modelica.Electrical.Analog.Ideal.IdealClosingSwitch sw(Ron=0, Goff=0);
equation
  connect(p, sw.p);
  connect(n, sw.n);
  sw.control = gate > 0.5;
end {name};'''
PHYSICAL['voltageSensor'] = '''model {name}
  Modelica.Electrical.Analog.Interfaces.PositivePin p;
  Modelica.Electrical.Analog.Interfaces.NegativePin n;
  Modelica.Blocks.Interfaces.RealOutput y;
  Modelica.Electrical.Analog.Sensors.VoltageSensor sensor;
equation
  connect(p, sensor.p);
  connect(n, sensor.n);
  y = sensor.v;
end {name};'''
PHYSICAL['currentSensor'] = '''model {name}
  Modelica.Electrical.Analog.Interfaces.PositivePin p;
  Modelica.Electrical.Analog.Interfaces.NegativePin n;
  Modelica.Blocks.Interfaces.RealOutput y;
  Modelica.Electrical.Analog.Sensors.CurrentSensor sensor;
equation
  connect(p, sensor.p);
  connect(n, sensor.n);
  y = sensor.i;
end {name};'''

PHYSICAL_CONNECTORS = {
    'electrical': 'Modelica.Electrical.Analog.Interfaces.Pin',
    'mechanical': 'Modelica.Mechanics.Rotational.Interfaces.Flange_a',
    'translational': 'Modelica.Mechanics.Translational.Interfaces.Flange_a',
    'thermal': 'Modelica.Thermal.HeatTransfer.Interfaces.HeatPort_a',
    'magnetic': 'Modelica.Magnetic.FluxTubes.Interfaces.MagneticPort',
    'threePhase': 'Modelica.Electrical.Polyphase.Interfaces.Plug',
}


def component_source(definition: Definition, name: str) -> str:
    if definition.kind in PHYSICAL and not definition.generated:
        return PHYSICAL[definition.kind].format(name=name)
    physical = any(p.direction == 'physical' for p in definition.ports)
    lines = [f'{"model" if physical else "block"} {name}']
    for port in definition.ports:
        if port.direction == 'physical':
            if port.domain not in PHYSICAL_CONNECTORS:
                raise ValueError('Physical terminals require a physical domain.')
            connector = PHYSICAL_CONNECTORS[port.domain]
        else:
            kind = {'signal': 'Real', 'boolean': 'Boolean'}.get(port.domain)
            if kind is None:
                raise ValueError('Input/output ports must use the signal or Boolean domain; physical terminals use physical direction.')
            connector = f'Modelica.Blocks.Interfaces.{kind}' + ('Input' if port.direction == 'input' else 'Output')
        lines.append(f'  {connector} {port.id};')
    for param in definition.parameters:
        lines.append(f'  parameter Real {param.id} = {param.value:.16g};')
    if definition.declarations.strip():
        lines.append('  '+definition.declarations.replace('\n','\n  '))
    lines.extend(['equation', '  '+definition.equations.replace('\n', '\n  '), f'end {name};'])
    return '\n'.join(lines)


def _terminal(diagram, definitions: dict, block_id: str, port_id: str) -> str:
    """Connector reference for a connect() line; boundary blocks are the model's own connectors."""
    definition = definitions[block_id]
    if definition.boundary is not None and definition.kind in BOUNDARY_KINDS:
        return block_id
    return f'{block_id}.{msl.connector(definition, port_id)}'


IDLE_EQUATION = {'electrical': '{c}.i = 0;', 'mechanical': '{c}.tau = 0;', 'translational': '{c}.f = 0;',
                 'thermal': '{c}.Q_flow = 0;', 'magnetic': '{c}.Phi = 0;',
                 'threePhase': 'for k in 1:{c}.m loop {c}.pin[k].i = 0; end for;'}


def idle_class(ref: str, ports) -> str:
    """Name of the wrapper that adds idle connectors for ports the active variant does not use."""
    return f'Sub_{ref}__' + '_'.join(sorted(p.id for p in ports))


def _idle_wrapper(ref: str, ports) -> str:
    """The active inside plus idle connectors: inputs are left unread, outputs give 0, physical ports carry no flow."""
    lines = [f'model {idle_class(ref, ports)}', f'  extends Sub_{ref};']
    equations = []
    for port in sorted(ports, key=lambda p: p.id):
        if port.direction == 'physical':
            lines.append(f'  {PHYSICAL_CONNECTORS[port.domain]} {port.id};')
            equations.append('  ' + IDLE_EQUATION[port.domain].format(c=port.id))
        else:
            kind = 'Boolean' if port.domain == 'boolean' else 'Real'
            lines.append(f'  Modelica.Blocks.Interfaces.{kind}{"Input" if port.direction == "input" else "Output"} {port.id};')
            if port.direction == 'output':
                equations.append(f'  {port.id} = {"false" if kind == "Boolean" else "0"};')
    return '\n'.join(lines + (['equation'] + equations if equations else []) + [f'end {idle_class(ref, ports)};'])


def _declaration(block, class_name: str, promoted: dict[str, str], idle: dict | None = None) -> str:
    """Component declaration; `promoted` maps inner parameter IDs to a parent parameter name."""
    definition = block.definition
    if definition.subsystem is not None:
        mods = ', '.join(f'par_{p.id}={promoted.get(p.id, f"{p.value:.16g}")}' for p in definition.parameters)
        ports = (idle or {}).get(block.id)
        cls = idle_class(definition.subsystem.ref, ports) if ports else f'Sub_{definition.subsystem.ref}'
        return f'  {cls} {block.id}' + (f'({mods})' if mods else '') + ';'
    if definition.modelica is not None:
        return msl.instance(definition, block.id, promoted)
    params = ', '.join(f'{p.id}={promoted.get(p.id, f"{p.value:.16g}")}' for p in definition.parameters)
    return f'  {class_name} {block.id}({params});'


def _connects(diagram) -> list[str]:
    definitions = {b.id: b.definition for b in diagram.blocks}
    return [f'  connect({_terminal(diagram, definitions, a, b)}, {_terminal(diagram, definitions, c, d)});'
            for a, b, c, d in flatten_connects(diagram)]


BOUNDARY_CONNECTOR = {('inport', 'signal'): 'Modelica.Blocks.Interfaces.RealInput',
                      ('inport', 'boolean'): 'Modelica.Blocks.Interfaces.BooleanInput',
                      ('outport', 'signal'): 'Modelica.Blocks.Interfaces.RealOutput',
                      ('outport', 'boolean'): 'Modelica.Blocks.Interfaces.BooleanOutput'}


def _idle_ports(project: Project, diagram) -> dict:
    """Block ID → ports its active variant leaves idle, for instances on `diagram`."""
    from .hierarchy import missing_ports
    subsystems = {s.id: s for s in (project.subsystems or [])}
    found = {}
    for block in diagram.blocks:
        ports = missing_ports(subsystems, block)
        if ports:
            found[block.id] = ports
    return found


def _used_subsystems(project: Project) -> list:
    """Definitions reachable from the top level, children before parents."""
    by_id = {s.id: s for s in (project.subsystems or [])}
    ordered, seen = [], set()

    def visit(diagram):
        for block in diagram.blocks:
            ref = block.definition.subsystem.ref if block.definition.subsystem else None
            if ref and ref not in seen:
                seen.add(ref)
                visit(by_id[ref])
                ordered.append(by_id[ref])
    visit(project)
    return ordered


def _emit_subsystem(subsystem, idle: dict) -> list[str]:
    parts = []
    for block in subsystem.blocks:
        d = block.definition
        if d.modelica is None and d.subsystem is None and not (d.boundary is not None and d.kind in BOUNDARY_KINDS):
            parts.append(component_source(d, f'C_{subsystem.id}_{block.id}'))
    lines = [f'model Sub_{subsystem.id}']
    promoted: dict[str, dict[str, str]] = {}
    for parameter in subsystem.parameters:
        lines.append(f'  parameter Real par_{parameter.id} = {parameter.value:.16g};')
        for target in parameter.targets:
            promoted.setdefault(target.blockId, {})[target.parameterId] = f'par_{parameter.id}'
    for block in subsystem.blocks:
        d = block.definition
        if d.boundary is not None and d.kind in BOUNDARY_KINDS:
            domain = d.ports[0].domain
            connector = BOUNDARY_CONNECTOR.get((d.kind, domain)) if d.kind != 'connport' else PHYSICAL_CONNECTORS.get(domain)
            if connector is None:
                raise ValueError(f'Subsystem port {d.name} has an unsupported domain.')
            lines.append(f'  {connector} {block.id};')
            continue
        lines.append(_declaration(block, f'C_{subsystem.id}_{block.id}', promoted.get(block.id, {}), idle))
    lines.append('equation')
    lines.extend(_connects(subsystem))
    lines.append(f'end Sub_{subsystem.id};')
    return parts + ['\n'.join(lines)]


def emit_project(project: Project) -> str:
    parts = ['within;\npackage Gradara']
    for block in project.blocks:
        if block.definition.modelica is None and block.definition.subsystem is None:
            parts.append(component_source(block.definition, f'Component_{block.id}'))
    wrappers: dict[str, str] = {}
    for subsystem in _used_subsystems(project):
        idle = _idle_ports(project, subsystem)
        for block_id, ports in idle.items():
            ref = next(b for b in subsystem.blocks if b.id == block_id).definition.subsystem.ref
            wrappers.setdefault(idle_class(ref, ports), _idle_wrapper(ref, ports))
        parts.extend(_emit_subsystem(subsystem, idle))
    top_idle = _idle_ports(project, project)
    for block_id, ports in top_idle.items():
        ref = next(b for b in project.blocks if b.id == block_id).definition.subsystem.ref
        wrappers.setdefault(idle_class(ref, ports), _idle_wrapper(ref, ports))
    parts.extend(wrappers[k] for k in sorted(wrappers))
    parts.append('model System')
    for block in project.blocks:
        parts.append(_declaration(block, f'Component_{block.id}', {}, top_idle))
    logs = logged_signals(project)
    for log in logs:
        parts.append(f"  output Real {log['key']};")
    parts.append('equation')
    for log in logs:
        parts.append(f"  {log['key']} = {log['expression']};")
    parts.extend(_connects(project))
    parts.append(f'  annotation(experiment(StartTime=0, StopTime={project.duration}, Tolerance=1e-6));')
    parts.append('end System;\nend Gradara;\n')
    return '\n'.join(parts)


def semantic_hash(project: Project) -> str:
    return hashlib.sha256(emit_project(project).encode()).hexdigest()[:20]


def project_key(project: Project) -> str:
    data = project.model_dump(exclude_none=True)
    data.pop('revision', None)
    data.pop('name', None)
    for key in ['modelId', 'exampleId', 'description', 'annotations', 'plots', 'nets']:
        data.pop(key, None)
    data.pop('junctions', None)
    if not data.get('subsystems'):
        data.pop('subsystems', None)
    data['wires'] = [
        {'source': a, 'sourceHandle': b, 'target': c, 'targetHandle': d}
        for a, b, c, d in flatten_connects(project)
    ]
    for wire in data['wires']:
        wire.pop('waypoints', None)
        wire.pop('junctions', None)
    for block in data['blocks']:
        block.pop('position', None)
        block.pop('size', None)
        block.pop('labelOffset', None)
        block.pop('rotation', None)
        block['definition'].pop('name', None)
    return hashlib.sha256(json.dumps(data, sort_keys=True).encode()).hexdigest()[:20]
