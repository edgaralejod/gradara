# AC motor example: permanent-magnet synchronous motor FOC

Open **Examples**, choose **Use example** under **AC motor · FOC**, then press **Run**.
This creates an independent saved document; the built-in template stays unchanged.

The diagram is executable. Its 19 components and 31 connections become a Modelica system,
which OpenModelica compiles and integrates. No LLM participates in execution order or time integration.

## Read the diagram

1. A 1500 rpm step at 0.03 s is converted to rad/s by a triangular gain.
2. The outer speed loop is drawn explicitly: speed subtraction, proportional and integral gains,
   a limited integrator, addition, and an ±8 A current limit.
3. The torque-producing q current and zero d-current commands each pass through an error
   junction and a PI current regulator with back-calculation anti-windup.
4. Inverse Park and inverse Clarke transforms produce phase-voltage commands. The 48 V
   averaged inverter applies common-mode injection and voltage clipping.
5. A four-pole-pair PMSM is coupled through a physical rotational connector to an inertial
   load. The opposing load increases from 0.05 to 0.40 N·m at 0.45 s.
6. Measured phase currents return through Clarke and Park transforms; electrical angle
   and shaft speed close the feedback loops.

The speed, d/q current, phase current, torque, and d/q voltage plots are grouped by the
example's saved plot configuration. Phase currents initially show the last 50 ms; choose
**Full run** to inspect startup. CSV exports include the complete solver output.

## Scope and conventions

This is a continuous-control, averaged-drive example. It uses a sinusoidal-flux PMSM with
constant resistance and d/q inductances, ideal current and rotor-position measurements,
and viscous shaft friction. The motor uses the amplitude-invariant, d-axis-aligned Park
convention. Stator resistance is 0.35 Ω, both inductances are 1 mH, flux linkage is 0.035 Wb,
and load inertia is 0.002 kg·m². These are illustrative parameters, not a validated motor data sheet.

Voltage and current measurements are scalar signal connections. The shaft is a physical
Modelica rotational connection. This example does not model a conserving DC supply network,
PWM switching ripple, inverter losses, sampling delays, sensor noise, flux weakening,
startup estimation, or hardware execution. The scalar controller export remains separate
from a complete deployable FOC firmware implementation.

Motor equations and transform conventions were checked against the primary references:
[MathWorks PMSM equations](https://www.mathworks.com/help/sps/ref/pmsm.html) and
[MathWorks Park transform](https://www.mathworks.com/help/mcb/ref/parktransform.html).
The block artwork and workbench are our own implementation.

## Extending it

`lib/gradara/foc.ts` builds the editable example. `lib/gradara/control-blocks.ts` holds reusable
signal equations and component interfaces. The two curated physical implementations live
in `server/modelica.py`. `models/examples/foc.json` is the portable bundled snapshot.
Geometry, routing waypoints, annotations, and plot groups remain presentation data;
they do not enter the executable Modelica equations.

## Layout

The template uses shared block sizes and terminal captions, with separate speed/current loops, parallel phase paths, and explicit branched feedback. Names occupy a free side when a connected terminal would cross their usual position. `npx tsx scripts/style-examples.ts` reproduces the DC/FOC template layouts without touching saved documents. Use **F** for the overview and zoom in to work on an individual control stage.
