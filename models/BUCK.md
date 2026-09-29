# Synchronous buck converter with ideal switches

An open-loop 24 V to 12 V synchronous buck converter. Real switching events are simulated, so you can see the output ripple and the inductor current rise and fall each cycle.

## Try it

Open **Examples**, choose **Use example** under **Buck converter**, then choose **Run**. This saves your own copy. The example itself does not change.

## Circuit

A 24 V DC source feeds a high-side and a low-side ideal switch that open and close in turn. Their midpoint drives a 1 mH inductor and a current sensor. A 100 µF capacitor and a 10 Ω resistor connect the output to ground. A voltage sensor measures the output without loading it. Named nets mark Vin, SW, Vout, and GND.

| Parameter | Default |
| --- | --- |
| Input voltage | 24 V |
| Switching frequency | 10 kHz |
| High-side duty cycle | 0.5 |
| Inductance | 1 mH |
| Capacitance | 100 µF |
| Load resistance | 10 Ω |
| Stop time | 20 ms |
| Initial inductor current / capacitor voltage | 0 A / 0 V |

Both switches are the Modelica Standard Library's ideal closing switch with zero on-resistance and zero off-conductance. A pulse generator drives the high-side gate between 0 and 1; the low-side gate is its complement. This is a switched circuit, not an averaged duty-to-voltage model. See the [Modelica Standard Library ideal-switch documentation](https://doc.modelica.org/Modelica%204.1.0/Resources/helpDymola/Modelica_Electrical_Analog_Ideal.html).

## What to look at

- In Results, select **Output voltage**, **Inductor current**, or **Switch gates**.
- **Last 1 ms** fits the vertical axis to show the switching ripple. **Full run** shows startup.
- Startup overshoots to about **19.3 V** before settling near 12 V. This is expected: the circuit starts with no stored energy, has no soft start, and runs at a fixed duty cycle. It is not a regulated supply.
- Double-click **Gate drive**, change **Duty cycle** to 0.25, and run again. The output settles near 6 V.

In steady state, approximately: `Vout = duty × Vin`, `Iout = Vout / R`, and inductor ripple `ΔIL = Vin × (1 − duty) × duty / (L × frequency)`. Measured over the last ten switching cycles of a full-resolution run:

| Duty | Mean output | Mean inductor current | Voltage ripple p-p | Current ripple p-p |
| --- | --- | --- | --- | --- |
| 0.50 | 12.000 V | 1.200 A | 0.076 V | 0.602 A |
| 0.25 | 6.000 V | 0.600 A | 0.057 V | 0.451 A |

These are reference values from testing. The app computes new results each time you run.

## Limits

This is an ideal **synchronous** buck: no diode, no dead time, no switching or conduction losses, no capacitor ESR, no inductor resistance, and no parasitics. Closed switches conduct in both directions, so the inductor current can go negative during the startup transient. There is no voltage or current control loop.

**Export CSV** in Results downloads every output point. The on-screen plot is thinned out but keeps the points around each switching event.

## For contributors

- `models/examples/buck.json`: the template and its layout.
- `scripts/build-buck-example.ts`: the template builder. Run `npx tsx scripts/build-buck-example.ts` after editing the example.
- `lib/gradara/power-blocks.ts`: the five reusable library definitions used here.
- `server/modelica.py`: the physical component wrappers.
- `tests/test_buck.py`: real-engine checks for two duty cycles, complementary gates, startup conditions, steady-state voltage and current, and switching ripple.

The reference values above come from time-weighted integration over the final ten switching cycles of the full CSV output.
