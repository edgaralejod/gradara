# AC motor: permanent-magnet synchronous motor with field-oriented control

A speed-controlled permanent-magnet synchronous machine (PMSM) with field-oriented control (FOC): an outer speed loop, inner d/q current loops, an ideal voltage-source inverter, and the Modelica Standard Library's PMSM.

## Try it

Open **Examples**, choose **Use example** under **AC motor · FOC**, then choose **Run**. This saves your own copy. The example itself does not change.

## Read the diagram

1. A 1500 rpm speed step at 0.03 s is converted to rad/s by a gain.
2. The outer speed loop is a continuous PI with a ±8 A output limit and anti-windup; its output is the q-axis (torque) current command. The d-axis command is a constant 0 A.
3. Two more continuous PIs, limited to ±27 V, regulate the d and q currents and produce the d/q voltage commands.
4. The Park transform fed −θe rotates the d/q voltages back into the stationary frame, and the inverse Clarke transform (with a zero-sequence input of 0) turns them into three phase voltages. A controlled three-phase voltage source, the ideal model of an inverter, applies them to the machine.
5. The Modelica PMSM (four pole pairs, 0.35 Ω, 1 mH, a magnet voltage of 15.6 V rms per phase at 100 Hz, 0.002 kg·m²) drives a torque sensor, viscous friction to the housing, and a torque step that raises the load from 0.05 to 0.40 N·m at 0.45 s.
6. A three-phase current sensor feeds the Clarke and Park transforms, which return the measured d/q currents. An angle sensor times the pole pairs gives the electrical angle θe; a speed sensor closes the speed loop and, through a gain, shows rpm.

## What to look at

- Results opens with speed and the d/q currents. Choose the 3×2 layout to also see phase currents, shaft torque, and the d/q voltages.
- Box-zoom the phase currents to see individual cycles; **Fit X** shows the whole run again.
- Watch the speed dip and recover when the load steps up at 0.45 s.
- **Export CSV** in Results downloads every output point.

## Limits

This is a continuous-control, ideal-drive example. The machine is the Modelica Standard Library's `SM_PermanentMagnet` with linear magnetics, no losses, and its damper cage; the current and angle sensors are ideal. The transforms use the library's amplitude-invariant, d-axis-aligned convention. The magnet voltage of 15.6 V rms per phase at 100 Hz is a flux linkage of 0.035 Wb; the inductances are 0.1 mH of stray plus 0.9 mH of main inductance on both axes. These are illustrative values, not a motor data sheet.

The example does not model the DC supply or its voltage limit, PWM switching ripple, inverter losses, sampling delays, sensor noise, field weakening, or startup position estimation. Exporting the controller to C discretizes the continuous PIs and does not produce complete, deployable FOC firmware.

## For contributors

`scripts/build-foc-example.ts` builds the template, `models/examples/foc.json`, from library blocks with the same assembler as the block examples (`scripts/block-examples/assemble.ts`): it places the blocks and the workbench's router draws the wires. Every block is a Modelica Standard Library wrapper (`lib/gradara/msl-blocks.ts`). Layout, routing, notes, and plot groups are presentation data and do not enter the Modelica equations. The real-engine checks (speed tracking, load rejection, d-axis current, balanced phases) are in `tests/test_modelica.py`.
