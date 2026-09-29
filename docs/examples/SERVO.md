# Servo position control

A DC motor position loop with a 1 kHz sampled PID controller. It is built to show how to export a controller to C and check the code against the simulation.

## Try it

Open **Examples**, choose **Use example** under **Servo position**, then choose **Run**. This saves your own copy. The default plots compare the position request with the measured shaft angle, and show the controller's voltage command and the motor current.

## What the model contains

The signal path is position request → **Discrete PID** → voltage drive. The motor, inertia, and ground are the same as in the [DC motor example](../../models/DC.md). An **Angle sensor** closes the loop on shaft angle instead of speed.

| Parameter | Default |
| --- | --- |
| Position request | 1 rad, applied at 0.2 s |
| PID gains kp / ki / kd | 30 / 1 / 3 |
| Derivative filter time constant | 10 ms |
| Output and integral limit | ±24 V |
| Controller sample period | 1 ms (1 kHz) |
| Armature R / L | 1.2 Ω / 20 mH |
| Motor constant | 0.15 N·m/A |
| Load inertia / viscous friction | 0.02 kg·m² / 0.002 N·m·s |
| Stop time | 2 s |

## What to look at

- The shaft overshoots about 1.5% and stays within 2% of the request about 0.2 s after the step.
- The voltage command sits at +24 V for about 44 ms right after the step, then briefly brakes near −13 V.
- The small integral gain removes the steady-state error without winding up while the output is saturated.

## Export the controller to C

1. Run the model once, so there is a run to check against.
2. Choose **Export**. Under **C code**, the **Unit** list already shows **Detected controller: Position controller**. You can also select the block first to pick it explicitly.
3. The time step defaults to the controller's 1 ms sample period. Review `controller.h`, `controller.c`, and `README.md` in the preview. **Copy** copies the open tab.
4. Choose **Verify against last run**. Gradara compiles the code and feeds it the position request and measured angle from your run, one step at a time. Because the Discrete PID is sampled, the C code matches the simulated voltage command to rounding error.
5. **Download .zip** saves the three files.

The code comes from the Discrete PID's built-in C template, not from AI, so exporting twice gives identical files. This needs no AI credits.

## Why the controller is sampled

All of the Discrete PID's equations run once per sample period, and all of its states are discrete. The difference equations *are* the controller, so a C step function can reproduce them exactly. The integral is clamped to the output limit, and the derivative is a backward-Euler form of `kd·s/(filterTime·s + 1)`:

```modelica
when sample(0, samplePeriod) then
  e = reference - measured;
  integral = max(-limit, min(limit, pre(integral) + samplePeriod*ki*e));
  derivative = (filterTime*pre(derivative) + kd*(e - pre(errorPrev)))/(filterTime + samplePeriod);
  errorPrev = e;
  y = max(-limit, min(limit, kp*e + integral + derivative));
end when;
```

A continuous controller such as **PID** or **Current PI** has continuous states. Exporting it means choosing a discretization, so its C code only approximates the simulation.

## Limits

The drive is an ideal voltage source, not a switching amplifier. The model leaves out encoder resolution, computation delay, nonlinear friction, and backlash. **Verify** checks that the C code computes the same outputs as the simulated controller from the same inputs. It does not prove closed-loop behavior on real hardware, timing jitter, or fixed-point arithmetic.

## For contributors

The template is [servo.json](../../models/examples/servo.json). Regenerate it with `npx tsx scripts/build-servo-example.ts` after changing its [builder](../../scripts/build-servo-example.ts).

The repository has a hand-reviewed export of this controller in [tests/fixtures/servo-controller](../../tests/fixtures/servo-controller). Each line of its step function is one equation of the `when` clause, in the same order, with `pre(x)` read from the state before the step:

```c
const double e = inputs->reference - inputs->measured;
state->integral = clamp(state->integral + ts * params->ki * e, params->limit);
state->derivative =
    (params->filterTime * state->derivative + params->kd * (e - state->errorPrev)) /
    (params->filterTime + ts);
state->errorPrev = e;
outputs->y =
    clamp(params->kp * e + state->integral + state->derivative, params->limit);
```

The replay test in [tests/test_exporter.py](../../tests/test_exporter.py) simulates this example in OpenModelica. At each of the 2001 sample instants it reads the reference and measured angle the controller saw, feeds them to the compiled C through a small harness, and requires the C output to match within 1e-6 V. The observed worst case is about 2e-13 V. The run covers the step, saturation, and settling. `tests/test_codegen.py` runs the same kind of replay for the generated code of this and other examples.
