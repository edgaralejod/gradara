# Servo position control

Open **Examples → Servo position** and choose **Use example**, then press **Run**. This creates an independent saved document. The default plots compare the position request with the measured shaft angle, and show the controller's drive-voltage command and the armature current.

The signal path is position request → **Discrete PID** → voltage drive. The physical plant is the same DC motor, inertia, and ground as the [DC motor example](../../models/DC.md), with an **Angle sensor** closing the loop on shaft angle instead of speed. The editable template is [servo.json](../../models/examples/servo.json); regenerate it with `npx tsx scripts/build-servo-example.ts` after changing its [builder](../../scripts/build-servo-example.ts).

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

With these values the shaft overshoots about 1.5% and stays within 2% of the request about 0.2 s after the step. The command saturates at +24 V for about 44 ms right after the step, then briefly brakes near −13 V. The small integral gain removes steady-state error without winding up during saturation.

This is an ideal voltage source, not a switching drive. The model omits encoder quantization, computation delay, friction nonlinearity, and backlash.

## Why the controller is sampled

Every equation of the Discrete PID sits inside one `when sample(0, samplePeriod)` clause, and all of its states are `discrete`. The difference equations *are* the controller, so a C step function can reproduce them exactly. The integral is clamped to the output limit, and the derivative is a backward-Euler discretization of `kd·s/(filterTime·s + 1)`:

```modelica
when sample(0, samplePeriod) then
  e = reference - measured;
  integral = max(-limit, min(limit, pre(integral) + samplePeriod*ki*e));
  derivative = (filterTime*pre(derivative) + kd*(e - pre(errorPrev)))/(filterTime + samplePeriod);
  errorPrev = e;
  y = max(-limit, min(limit, kp*e + integral + derivative));
end when;
```

A continuous controller such as **PID** or **Current PI** has `der()` states. Its export has to choose a discretization, so the C only approximates the simulated behavior.

## Export the controller to C

1. Select **Position controller** on the canvas. It is marked as a controller, so no extra step is needed.
2. Choose **Export**, then **Generate C controller**. When a model has several controllers, pick one in the **Controller** list first.
3. Review `gradara_controller.h`, `gradara_controller.c`, and the notes in the preview; **Copy** copies the open tab.
4. **Download C package** saves the header, source, the controller contract the generator received, and a README with the notes.

The generator sees the sample period and the discrete states explicitly in its contract. The result is compiled with `gcc -std=c11 -Wall -Wextra -Werror` before it is offered. Generation uses the AI provider chosen in **Settings → AI**.

## Reference implementation and replay test

The repository ships a hand-reviewed export of this controller in [tests/fixtures/servo-controller](../../tests/fixtures/servo-controller). Each line of its step function is one equation of the `when` clause, in the same order, with `pre(x)` read from the state before the step:

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

The replay test in [tests/test_exporter.py](../../tests/test_exporter.py) simulates this example in OpenModelica. At each of the 2001 sample instants it reads the reference and measured angle the solver's controller saw, and feeds them to the compiled C through a small harness. It then requires the C output to match the solver's controller output within 1e-6 V; the observed worst case is about 2e-13 V. The run covers the saturated interval, the step, and settling.

What this proves: the reference C and the Modelica controller compute the same outputs from the same sampled inputs. What it does not prove: closed-loop behavior on real hardware, timing jitter or computation delay, fixed-point arithmetic, or that a newly *generated* export is equivalent. Compare a generated package against the reference, or replay it the same way, before relying on it.
