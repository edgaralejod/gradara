# AC motor: permanent-magnet synchronous motor with field-oriented control

A speed-controlled permanent-magnet synchronous motor (PMSM) with field-oriented control (FOC): an outer speed loop, inner d/q current loops, and an averaged 48 V inverter.

## Try it

Open **Examples**, choose **Use example** under **AC motor · FOC**, then choose **Run**. This saves your own copy. The example itself does not change.

## Read the diagram

1. A 1500 rpm speed step at 0.03 s is converted to rad/s by a gain.
2. The outer speed loop is drawn out explicitly: speed error, proportional and integral gains, a limited integrator, a sum, and a ±8 A current limit.
3. The q-axis (torque) current command and the zero d-axis current command each go through an error sum and a PI current controller with anti-windup.
4. Inverse Park and inverse Clarke transforms turn the d/q voltage commands into phase voltages. The averaged 48 V inverter adds common-mode injection and clips the voltage.
5. A four-pole-pair PMSM drives an inertial load through a mechanical shaft connection. The load torque steps from 0.05 to 0.40 N·m at 0.45 s.
6. Measured phase currents go back through Clarke and Park transforms. The electrical angle and the shaft speed close the feedback loops.

## What to look at

- Results opens with plots of speed, d/q currents, phase currents, torque, and d/q voltages.
- Phase currents first show the last 50 ms. Choose **Full run** to see startup.
- Watch the speed dip and recover when the load steps up at 0.45 s.
- **Export CSV** in Results downloads every output point.

## Limits

This is a continuous-control, averaged-drive example. The motor has sinusoidal flux, constant resistance and d/q inductances, ideal current and rotor-position measurement, and viscous shaft friction. It uses the amplitude-invariant, d-axis-aligned Park convention. Stator resistance is 0.35 Ω, both inductances are 1 mH, flux linkage is 0.035 Wb, and load inertia is 0.002 kg·m². These are illustrative values, not a motor data sheet.

Voltage and current measurements are signal connections; only the shaft is a physical connection. The example does not model the DC supply, PWM switching ripple, inverter losses, sampling delays, sensor noise, field weakening, or startup position estimation. Exporting the controller to C does not produce complete, deployable FOC firmware.

The motor equations and transform conventions were checked against [MathWorks PMSM equations](https://www.mathworks.com/help/sps/ref/pmsm.html) and the [MathWorks Park transform](https://www.mathworks.com/help/mcb/ref/parktransform.html). The diagram has 19 blocks and 31 connections.

## For contributors

`lib/gradara/foc.ts` builds the editable example. `lib/gradara/control-blocks.ts` holds the reusable signal equations and block interfaces. The two custom physical implementations live in `server/modelica.py`. `models/examples/foc.json` is the bundled template. Layout, routing, notes, and plot groups are presentation data and do not enter the Modelica equations. `npx tsx scripts/style-examples.ts` reproduces the DC and FOC template layouts without touching saved models.
