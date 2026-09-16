# 480 V AC to 24 V DC flyback

Open **Examples → 480 VAC flyback**. This is a hand-authored, switching OpenModelica example, independent of the agent model-building workflow. The editable template is [flyback.json](../../models/examples/flyback.json); regenerate it using `npx tsx scripts/build-flyback-example.ts` after changing its [builder](../../scripts/build-flyback-example.ts). The builder reads only the source catalog, never saved personal models or provider transcripts.

## Operating point

- Input: **480 V RMS, single-phase, 60 Hz** across two conductors. This is not a three-phase 480 V rectifier.
- Output: **24 V, 1 A, 24 W** into a 24 Ω resistor.
- Full-wave bridge and 100 µF bulk capacitor produce approximately 670 V DC under load. A 10 Ω input resistor limits simulated charging current.
- Ideal transformer ratio **Np/Ns = 8**, with a separate **2 mH primary magnetizing inductor**. The inductor stores energy during switch on-time; the reversed secondary connection delivers it to the output during off-time.
- PWM frequency: **50 kHz**. Switching is disabled for the first 30 ms. A normalized reference ramps from zero to one over the following 50 ms.
- Sampled PI: Kp = 0.03, Ki = 4, 100 µs sample period; normalized voltage feedback includes a 1 ms filter. Duty is bounded to 0–0.18. The integral and PWM behavior are inspectable equations.
- Output capacitor: 1000 µF, with 50 mΩ series resistance in its charging path. A 0.5 Ω primary series resistance represents winding-path conduction loss.

Primary and secondary grounds establish separate numerical voltage references; no conductor connects their return nets. The secondary voltage measurement crosses to the controller as an ideal signal, without modeling an optocoupler or other physical feedback-isolation circuit.

## Numerical assumptions

Diodes use a 0.7 V knee, 0.05 Ω forward slope resistance and 10 nS reverse conductance. The gate-controlled switch uses 0.2 Ω on-resistance and 10 nS off-conductance. These finite slopes regularize commutation instead of combining perfectly open/short switches with an ideal magnetic network. The input also has a 100 MΩ reference path and the bus a 1 MΩ bleeder.

This is an explicitly switched model, not an averaged power-stage approximation or a voltage source forced to 24 V. PWM boundaries and falling edges generate time events; the ordinary DASSL/tolerance settings remain unchanged. The default run is 0.3 seconds. Event samples mean the result contains substantially more than the 6,000 regular output intervals.

Expected behavior: startup from zero, a settled output near 24.00 V, approximately 0.71 A peak primary switch current, and about 874 V peak switch voltage at this operating point. Open Data Inspector and select **Output voltage.V**, **DC bus voltage.V**, **Primary current.A**, **Switch voltage.V**, and **0–18% duty.out**. Zoom into the final 100 µs to inspect individual switching cycles. The integration test checks regulation, bounded overshoot, ripple, switching activity and bus-precharge delay against full-resolution output.

As a first-order DCM consistency check, `P ≈ ½ Lm Ipk² fs`; 24 W, 2 mH and 50 kHz imply about 0.69 A before losses. Ideal off-state stress is approximately `Vbus + n(Vout + Vf)`, explaining why the model's switch sees much more than the 480 V RMS input rating. See TI's [flyback transformer design seminar](https://www.ti.com/seclit/ml/slup338/slup338.pdf) for the energy-storage and demagnetization model.

## Scope

The example omits leakage inductance and its turn-off spike, snubbers/clamps, core saturation and losses, winding capacitance, semiconductor capacitance/recovery/switching losses, EMI filtering, device ratings, practical isolation construction and physical gate drive. The modeled switch voltage is therefore not a worst-case device-rating recommendation. This is a simulation reference, not a build-ready mains power supply.

The successful direct model demonstrates that the existing backend can simulate this topology. It does not mean every agent-generated flyback will converge or meet its requested operating point. Component checks alone cannot establish full-circuit startup, switching consistency, or closed-loop regulation.

The schematic is organized left to right as a two-column bridge rectifier, DC link, primary energy-storage/switching stage, and isolated output. The voltage-control chain occupies a separate row below. Rotated bridge diodes use the standard block rotation field; shared runs contain explicit editable junctions. Regenerate the public template with `npx tsx scripts/build-flyback-example.ts`; existing saved copies are not overwritten.
