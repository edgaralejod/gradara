# Synchronous buck converter with ideal switches

Open **Examples**, choose **Use example** under **Buck converter**, then press **Run**. This creates an independent saved document. Select **Output voltage**, **Inductor current**, or **Switch gates** in the results panel. **Last 1 ms** automatically fits the vertical axis to reveal ripple; **Full run** shows startup.

## Circuit

A 24 V DC source feeds complementary high-side and low-side ideal switches. Their midpoint drives a 1 mH inductor and an ideal current sensor. A 100 µF capacitor and a 10 Ω resistor connect the output to ground. An ideal voltage sensor measures output voltage without loading the circuit. Named nets identify Vin, SW, Vout, and GND.

| Parameter | Default |
| --- | --- |
| Input voltage | 24 V |
| Switching frequency | 10 kHz |
| High-side duty | 0.5 |
| Inductance | 1 mH |
| Capacitance | 100 µF |
| Load resistance | 10 Ω |
| Simulation stop time | 20 ms |
| Initial inductor current / capacitor voltage | 0 A / 0 V |

Both power switches use `Modelica.Electrical.Analog.Ideal.IdealClosingSwitch` with **Ron = 0 and Goff = 0**. A Modelica BooleanPulse generates events; the high-side gate is 0 or 1 and the low-side gate is its complement. OpenModelica resolves the changing physical connection equations and continuous states. This is a switched circuit, not an averaged duty-to-voltage block. See the [Modelica Standard Library ideal-switch documentation](https://doc.modelica.org/Modelica%204.1.0/Resources/helpDymola/Modelica_Electrical_Analog_Ideal.html).

## Behavior and limits

This is an open-loop **synchronous** buck: there is no diode, dead time, semiconductor loss, capacitor ESR, inductor resistance, or parasitic element. The closed switches conduct in either direction. Reverse inductor current during the initial transient is therefore possible.

Starting from zero stored energy produces an underdamped startup that peaks around **19.32 V** before settling near 12 V. That overshoot is expected for this initially unenergized ideal LC circuit with a resistive load and immediate fixed duty; it is not a regulated 12 V supply. A soft start and voltage/current control loops are a useful next example extension.

The steady-state relations are approximately `Vout = duty × Vin`, `Iout = Vout/R`, and `ΔIL = Vin × (1-duty) × duty / (L × frequency)`. Time-weighted integration over the final ten switching cycles of the real CSV produced:

| Duty | Mean output | Mean inductor current | Voltage ripple p-p | Current ripple p-p |
| --- | --- | --- | --- | --- |
| 0.50 | 12.000296 V | 1.199899 A | 0.076250 V | 0.601574 A |
| 0.25 | 6.000171 V | 0.599951 A | 0.056891 V | 0.450871 A |

These are validation results, not fixed numbers rendered by the UI. Changing circuit parameters and running again produces a new immutable OpenModelica job. The default solver remains DASSL with tolerance 1e-6 and 6,000 output intervals. The UI preserves event pairs and a dense final window; the CSV retains all output rows. DASSL can emit an extra output-grid row beyond stop time; plot previews exclude it.

## Files and verification

- `models/examples/buck.json`: executable template and curated layout.
- `scripts/build-buck-example.ts`: template builder; run `npx tsx scripts/build-buck-example.ts` when editing the example.
- `lib/gradara/power-blocks.ts`: five reusable library definitions.
- `server/modelica.py`: canonical physical component wrappers.
- `tests/test_buck.py`: real-engine checks for two duty cycles, complementary gates, startup conditions, steady-state voltage/current, and switching ripple.

The sensors and source are also reusable in models created from an empty canvas. A custom control block can replace the gate generator later while retaining the physical circuit.
