"""Small packaging adapter; OpenModelica owns equation processing and execution."""
import hashlib
import json
from .models import Definition, Project, flatten_connects

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

def component_source(definition: Definition, name: str) -> str:
    if definition.kind in PHYSICAL and not definition.generated:
        return PHYSICAL[definition.kind].format(name=name)
    physical = any(p.direction == 'physical' for p in definition.ports)
    lines = [f'{"model" if physical else "block"} {name}']
    for port in definition.ports:
        if port.direction == 'physical':
            connectors = {
                'electrical': 'Modelica.Electrical.Analog.Interfaces.Pin',
                'mechanical': 'Modelica.Mechanics.Rotational.Interfaces.Flange_a',
                'thermal': 'Modelica.Thermal.HeatTransfer.Interfaces.HeatPort_a',
            }
            if port.domain not in connectors:
                raise ValueError('Physical terminals require an electrical, mechanical, or thermal domain.')
            connector = connectors[port.domain]
        else:
            if port.domain != 'signal':
                raise ValueError('Input/output ports must use the signal domain; physical terminals use physical direction.')
            connector = 'Modelica.Blocks.Interfaces.' + ('RealInput' if port.direction == 'input' else 'RealOutput')
        lines.append(f'  {connector} {port.id};')
    for param in definition.parameters:
        lines.append(f'  parameter Real {param.id} = {param.value:.16g};')
    if definition.declarations.strip():
        lines.append('  '+definition.declarations.replace('\n','\n  '))
    lines.extend(['equation', '  '+definition.equations.replace('\n', '\n  '), f'end {name};'])
    return '\n'.join(lines)


def emit_project(project: Project) -> str:
    parts = ['within;\npackage Gradara']
    for block in project.blocks:
        parts.append(component_source(block.definition, f'Component_{block.id}'))
    parts.append('model System')
    for block in project.blocks:
        params = ', '.join(f'{p.id}={p.value:.16g}' for p in block.definition.parameters)
        parts.append(f'  Component_{block.id} {block.id}({params});')
    parts.append('equation')
    for source, source_handle, target, target_handle in flatten_connects(project):
        parts.append(f'  connect({source}.{source_handle}, {target}.{target_handle});')
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
        block['definition'].pop('name', None)
    return hashlib.sha256(json.dumps(data, sort_keys=True).encode()).hexdigest()[:20]
