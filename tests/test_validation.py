"""Textbook responses computed by the real engine, compared with their closed forms.

Each case is a small circuit of Modelica Standard Library components whose answer
is known analytically. They run with the installed OpenModelica, like the other
integration tests, and print the measured values that docs/VALIDATION.md reports.
"""
import asyncio
import math
import uuid

import pytest

from server.engine import simulate
from server.models import Project
from tests.test_msl_engine import _block, _w, wrap

E, T, TR = 'electrical', 'thermal', 'translational'


def run(blocks, wires, duration):
    project = Project.model_validate({'version': 1, 'name': 'validation', 'duration': duration, 'revision': 0,
                                      'blocks': blocks, 'wires': wires})
    result = asyncio.run(simulate(project, 'val' + uuid.uuid4().hex[:10]))
    series = {s['key']: s['values'] for s in result['series']}
    return result['time'], series


def at(time, values, t):
    """Linear interpolation of a trace at time t."""
    for (t0, v0), (t1, v1) in zip(zip(time, values), zip(time[1:], values[1:])):
        if t0 <= t <= t1:
            return v0 if t1 == t0 else v0 + (v1 - v0) * (t - t0) / (t1 - t0)
    return values[-1]


def two(cls, a='p', b='n', domain=E, modifiers=None):
    return wrap(cls, [(a, 'physical', domain), (b, 'physical', domain)], modifiers or {}, domain)


@pytest.mark.integration
def test_rc_charging_follows_one_minus_exp():
    """1 V through 1 kΩ into 1 mF: τ = RC = 1 s, v(τ) = 1 − e⁻¹, v(3τ) = 1 − e⁻³."""
    source = two('Modelica.Electrical.Analog.Sources.ConstantVoltage', modifiers={'V': '1'})
    ground = wrap('Modelica.Electrical.Analog.Basic.Ground', [('p', 'physical', E)], {}, E)
    sensor = wrap('Modelica.Electrical.Analog.Sensors.VoltageSensor',
                  [('p', 'physical', E), ('n', 'physical', E), ('v', 'output', 'signal')], {}, E)
    blocks = [_block('src', source), _block('g', ground),
              _block('r', two('Modelica.Electrical.Analog.Basic.Resistor', modifiers={'R': '1000'})),
              _block('c', two('Modelica.Electrical.Analog.Basic.Capacitor', modifiers={'C': '1e-3'})),
              _block('vc', sensor)]
    wires = [_w(1, 'src', 'p', 'r', 'p'), _w(2, 'r', 'n', 'c', 'p'), _w(3, 'c', 'n', 'g', 'p'),
             _w(4, 'src', 'n', 'g', 'p'), _w(5, 'vc', 'p', 'c', 'p'), _w(6, 'vc', 'n', 'g', 'p')]
    time, s = run(blocks, wires, 5)
    v = s['vc.v']
    for t in (1, 3):
        expected = 1 - math.exp(-t)
        measured = at(time, v, t)
        print(f'RC v({t} s) = {measured:.6f} V, closed form {expected:.6f} V')
        assert measured == pytest.approx(expected, abs=2e-4)


@pytest.mark.integration
def test_thermal_rc_reaches_q_over_g_with_time_constant_c_over_g():
    """10 W into 1000 J/K, 1 W/K to ambient: ΔT∞ = Q/G = 10 K, τ = C/G = 1000 s."""
    capacitor = wrap('Modelica.Thermal.HeatTransfer.Components.HeatCapacitor', [('port', 'physical', T)],
                     {'C': '1000'}, T)
    conductor = two('Modelica.Thermal.HeatTransfer.Components.ThermalConductor', 'port_a', 'port_b', T, {'G': '1'})
    ambient = wrap('Modelica.Thermal.HeatTransfer.Sources.FixedTemperature', [('port', 'physical', T)],
                   {'T': '293.15'}, T)
    heat = wrap('Modelica.Thermal.HeatTransfer.Sources.FixedHeatFlow', [('port', 'physical', T)], {'Q_flow': '10'}, T)
    sensor = wrap('Modelica.Thermal.HeatTransfer.Sensors.TemperatureSensor',
                  [('port', 'physical', T), ('T', 'output', 'signal')], {}, T)
    blocks = [_block('c', capacitor), _block('g', conductor), _block('amb', ambient), _block('q', heat),
              _block('t', sensor)]
    wires = [_w(1, 'q', 'port', 'c', 'port'), _w(2, 'c', 'port', 'g', 'port_a'), _w(3, 'g', 'port_b', 'amb', 'port'),
             _w(4, 't', 'port', 'c', 'port')]
    time, s = run(blocks, wires, 5000)
    rise = [x - 293.15 for x in s['t.T']]
    for t in (1000, 5000):
        expected = 10 * (1 - math.exp(-t / 1000))
        measured = at(time, rise, t)
        print(f'Thermal ΔT({t} s) = {measured:.5f} K, closed form {expected:.5f} K')
        assert measured == pytest.approx(expected, rel=1e-3)


@pytest.mark.integration
def test_mass_spring_damper_step_overshoot_and_peak_time():
    """1 kg on 1000 N/m and 10 N·s/m, 1 N step: ζ = 0.158, overshoot e^(−ζπ/√(1−ζ²)), peak at π/ωd."""
    m, k, d = 1.0, 1000.0, 10.0
    wall = wrap('Modelica.Mechanics.Translational.Components.Fixed', [('flange', 'physical', TR)], {}, TR)
    spring = two('Modelica.Mechanics.Translational.Components.SpringDamper', 'flange_a', 'flange_b', TR,
                 {'c': str(k), 'd': str(d)})
    mass = two('Modelica.Mechanics.Translational.Components.Mass', 'flange_a', 'flange_b', TR, {'m': str(m)})
    force = wrap('Modelica.Mechanics.Translational.Sources.ForceStep', [('flange', 'physical', TR)],
                 {'stepForce': '1', 'offsetForce': '0', 'startTime': '0.1'}, TR)
    sensor = wrap('Modelica.Mechanics.Translational.Sensors.PositionSensor',
                  [('flange', 'physical', TR), ('s', 'output', 'signal')], {}, TR)
    blocks = [_block('wall', wall), _block('k', spring), _block('m', mass), _block('f', force), _block('x', sensor)]
    wires = [_w(1, 'wall', 'flange', 'k', 'flange_a'), _w(2, 'k', 'flange_b', 'm', 'flange_a'),
             _w(3, 'f', 'flange', 'm', 'flange_b'), _w(4, 'x', 'flange', 'm', 'flange_b')]
    time, s = run(blocks, wires, 1.5)
    x = s['x.s']
    final = 1 / k
    zeta = d / (2 * math.sqrt(k * m))
    wn = math.sqrt(k / m)
    overshoot = math.exp(-zeta * math.pi / math.sqrt(1 - zeta ** 2))
    peak_time = 0.1 + math.pi / (wn * math.sqrt(1 - zeta ** 2))
    peak = max(x)
    t_peak = time[x.index(peak)]
    print(f'Mass-spring-damper overshoot = {peak / final - 1:.4f} (closed form {overshoot:.4f}), '
          f'peak at {t_peak:.4f} s (closed form {peak_time:.4f} s), final {x[-1] * 1e3:.5f} mm')
    assert peak / final - 1 == pytest.approx(overshoot, abs=0.01)
    assert t_peak == pytest.approx(peak_time, abs=0.004)
    assert x[-1] == pytest.approx(final, rel=2e-3)
