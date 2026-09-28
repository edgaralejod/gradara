# 480 V AC to 24 V DC flyback

A switching flyback power supply that turns 480 V AC into a regulated 24 V, 1 A output. Every switching cycle is simulated. Use it to see startup, regulation, and the voltage stress on the switch.

## Try it

Open **Examples**, choose **Use example** under **480 VAC flyback**, then choose **Run**. The default run simulates 0.3 seconds.

## Operating point

- Input: **480 V RMS, single-phase, 60 Hz** across two conductors. This is not a three-phase rectifier.
- Output: **24 V, 1 A, 24 W** into a 24 Ω resistor.
- A full-wave bridge and a 100 µF bulk capacitor produce about 670 V DC under load. A 10 Ω input resistor limits the charging current.
- An ideal transformer with turns ratio **Np/Ns = 8**, plus a separate **2 mH primary magnetizing inductor**. The inductor stores energy while the switch is on; the secondary delivers it to the output while the switch is off.
- Switching frequency: **50 kHz**. Switching stays off for the first 30 ms. Then the voltage reference ramps from zero to full over 50 ms (soft start).
- Sampled PI controller: Kp = 0.03, Ki = 4, 100 µs sample period, with a 1 ms filter on the voltage feedback. Duty cycle is limited to 0–18%.
- Output capacitor: 1000 µF, with 50 mΩ in series. A 0.5 Ω primary resistance represents winding losses.

The primary and secondary sides have separate grounds with no conductor between them. The output voltage measurement reaches the controller as an ideal signal; the model does not include an optocoupler or other isolated feedback circuit.

## What to look at

- In Results, select **Output voltage.V**, **DC bus voltage.V**, **Primary current.A**, **Switch voltage.V**, and **0–18% duty.out**.
- Expect startup from zero and an output that settles near **24.00 V**.
- Peak primary switch current is about **0.71 A**. Peak switch voltage is about **874 V**.
- Zoom into the last 100 µs to see individual switching cycles.

Two quick checks by hand:

- Energy per cycle in discontinuous mode: `P ≈ ½ Lm Ipk² fs`. With 24 W, 2 mH, and 50 kHz, that gives about 0.69 A peak before losses.
- Switch voltage when off: about `Vbus + n(Vout + Vf)`. That is why the switch sees much more than the 480 V RMS input.

See TI's [flyback transformer design seminar](https://www.ti.com/seclit/ml/slup338/slup338.pdf) for the theory.

## Modeling choices

Diodes have a 0.7 V knee, 0.05 Ω forward resistance, and a small reverse leakage conductance of 10 nanosiemens (1e-8 S). The switch has 0.2 Ω on-resistance and 10 nanosiemens off-state conductance. These small, finite values help the solver through each switching transition. The input also has a 100 MΩ reference path, and the DC bus has a 1 MΩ bleeder resistor.

This is a switched model, not an averaged model, and the output is not forced to 24 V. Each switching edge is an event in the simulation, so the results contain many more points than the usual 6,000.

## Limits

The example leaves out leakage inductance and its turn-off spike, snubbers and clamps, core saturation and losses, winding capacitance, semiconductor capacitance, recovery and switching losses, EMI filtering, device ratings, isolation construction, and gate drive. The switch voltage shown is therefore not a worst-case rating for choosing a device. This is a simulation reference, not a design ready to build and connect to the mains.

This model shows that Gradara can simulate this kind of circuit. It does not mean that every AI-generated flyback will converge or meet its target.

## For contributors

The template is [flyback.json](../../models/examples/flyback.json). Regenerate it with `npx tsx scripts/build-flyback-example.ts` after changing its [builder](../../scripts/build-flyback-example.ts). The builder reads only the built-in catalog, never saved personal models or AI transcripts. Regenerating does not overwrite saved copies.

The layout runs left to right: bridge rectifier, DC link, primary switching stage, and isolated output, with the control chain in a separate row below. Rotated bridge diodes use the standard block rotation; shared wire runs use explicit junctions.

The integration test checks regulation, overshoot, ripple, switching activity, and bus pre-charge delay against full-resolution output. The solver uses the default DASSL settings.
