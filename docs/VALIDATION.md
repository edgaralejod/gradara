# Validation

Gradara draws the diagram; OpenModelica 1.27 and the Modelica Standard Library 4.1.0 do the physics. This page shows how Gradara's results compare with answers known in closed form or from conservation laws. Every row is an automated test that runs the real engine (`pytest -m integration`); the measured values below are from OpenModelica 1.27.1 on Linux.

Passing these checks means the diagram becomes the intended Modelica model and the engine solves it as the textbook predicts. It does not certify Gradara or any model for safety-critical use. Validate the models you rely on against measurements or independent tools.

## Closed-form responses

| Case | Closed form | Gradara | Tolerance | Test |
| --- | --- | --- | --- | --- |
| RC charging, 1 V through 1 kΩ into 1 mF (τ = 1 s) | v(1 s) = 1 − e⁻¹ = 0.632121 V; v(3 s) = 0.950213 V | 0.632122 V; 0.950213 V | ±0.2 mV | `tests/test_validation.py` |
| Thermal RC, 10 W into 1000 J/K with 1 W/K to ambient (τ = 1000 s) | ΔT(1000 s) = 6.32121 K; ΔT(5000 s) = 9.93262 K | 6.32053 K; 9.93249 K | 0.1 % | `tests/test_validation.py` |
| Mass-spring-damper, 1 kg, 1000 N/m, 10 N·s/m, 1 N step (ζ = 0.158) | overshoot 60.47 %; peak 0.1006 s after the step; final 1.000 mm | 60.45 %; 0.1005 s; 0.99914 mm | ±1 % overshoot, ±4 ms, 0.2 % | `tests/test_validation.py` |
| Spring and mass under a constant 1 N | x = F/k = 1 mm | 1 mm | 0.1 % | `tests/test_msl_engine.py` |
| Heat capacitor, 10 W for 10 s into 1000 J/K | ΔT = Q·t/C = 0.1 K | 0.1 K | 0.1 % | `tests/test_msl_engine.py` |
| Inverting op-amp, 10 kΩ / 1 kΩ | v_out = −10 · v_in | −10 · v_in | 1 µV at every sample | `tests/test_msl_engine.py` |

## Worked examples

| Example | Expected | Gradara | Test |
| --- | --- | --- | --- |
| Synchronous buck, 24 V, D = 0.5 and 0.25, 1 mH, 10 kHz | mean output D · 24 V = 12 V and 6 V; inductor ripple (V_in − V_out)·D/(L·f) = 0.6 A and 0.45 A | 12.0003 V and 6.0002 V; 0.602 A and 0.451 A | `tests/test_buck.py` (±20 mV mean, ±10 % ripple) |
| DC motor speed loop | settles at the 100 rad/s reference, and at 60 rad/s when the reference changes; controller output never exceeds its 24 V limit | within 1 rad/s | `tests/test_modelica.py` |
| Field-oriented control of a PMSM | tracks 1500 rpm and 1000 rpm; d-axis current near zero; phase currents sum to zero | within 2 rpm; \|i_d\| < 0.02 A; \|i_a + i_b + i_c\| < 1e-8 A | `tests/test_modelica.py` |
| 480 VAC flyback | regulated 24 V output; DC bus near the 679 V peak of 480 VAC | 23.9–24.1 V with < 50 mV ripple; 660–680 V | `tests/test_flyback.py` |
| Data center cooling | energy balance at every sample: stored heat = IT load − removed heat; electrical power = IT + cooling; cooling = COP × electrical | holds to 1e-6 | `tests/test_datacenter.py` |
| EV drivetrain, each configuration | reaches the 5 m/s cruise speed without exceeding 6 m/s | within 5 % | `tests/test_variants.py` |

## Structure and code generation

| Check | Result | Test |
| --- | --- | --- |
| A grouped model (subsystems) simulates like the flat model it came from | same final speed | `tests/test_hierarchy.py` |
| Generated C for a controller reproduces the simulated controller | matches the last run sample by sample | `tests/test_codegen.py`, `tests/test_exporter.py` |
| A unit delay outputs the previous sample | exact | `tests/test_codegen.py` |
| Every Modelica Standard Library block in the library compiles and runs in a working circuit | 148 blocks | `tests/test_msl_engine.py` |

## Run them yourself

With OpenModelica 1.27 and the Modelica Standard Library 4.1.0 installed, from a source checkout:

```sh
.venv/bin/python -m pytest -m integration -s
```

`-s` prints the measured values. See [testing](development/TESTING.md) for the engine setup.
