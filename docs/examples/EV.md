# EV drivetrain

A battery electric vehicle modeled as nested subsystems with variants. It is the reference example for hierarchy and variants: three levels deep, two variant subsystems, and two configurations that switch them together.

The editable template is [ev.json](../../models/examples/ev.json); regenerate it with `npx tsx scripts/build-ev-example.ts` after changing its [builder](../../scripts/build-ev-example.ts). The builder draws the flat diagram, then groups, promotes, and adds variants with the same operations the workbench uses.

## Structure

| Level | Sheet | Contents |
| --- | --- | --- |
| Top | EV drivetrain | Speed request (0.5 m/s² ramp from 1 s) limited to a 5 m/s cruise speed, **Vehicle control**, **Powertrain**, the wheel (0.3 m radius), a 1,200 kg vehicle mass, road drag (40 N·s/m), and a speed sensor. |
| 1 | Vehicle control | Speed error → **Speed PI** (kp 0.4, ki 1 per m/s) → duty limited to ±1. |
| 1 | Powertrain | **Battery pack**, **Motor drive**, and a 6:1 final drive. |
| 2 | Battery pack | An MSL cell stack and its ground. Cell data is promoted to the subsystem block. |
| 2 | Motor drive | **Converter** and the motor. |
| 3 | Converter | A lossless averaged DC-DC stage: the output voltage is duty × DC voltage, and the DC side draws duty × output current. |

## Variants and configurations

| Variant subsystem | Variants | Kind |
| --- | --- | --- |
| Battery pack | **LFP**: 34 cells, 3.6 V full, 2.5 V empty, 2 mΩ. **NMC**: 28 cells, 4.2 V full, 3.0 V empty, 3 mΩ. Both 40 Ah. | Parameter variants: one inside, different promoted values. |
| Motor drive | **PM DC machine**: the MSL permanent-magnet DC machine (100 V, 100 A nominal). **Simple DC motor**: Gradara's DC motor block (R 0.05 Ω, L 1.5 mH, k 0.64) with a separate 0.15 kg·m² rotor inertia. | Diagram variants: each has its own inside behind the same ports. |

The configuration menu beside **Run** holds **City · LFP** (LFP, PM DC machine) and **Performance · NMC** (NMC, simple DC motor). Choosing one switches both subsystems. **Run all configurations** runs both and overlays them in Results as `[City · LFP] …` and `[Performance · NMC] …`. The Explorer's **Variants** view shows the same choices as a table.

## What to look at

- **Vehicle speed** (the default plot) follows the ramp and settles at the 5 m/s cruise speed in both configurations.
- Open **Powertrain › Battery pack** and switch the pack between LFP and NMC on its block: only the promoted cell values change.
- Open **Powertrain › Motor drive** in each motor variant: the insides differ, and the ports and the Converter they use are the same. The Converter definition is shared by both variants (**Used 2×**).

The engine test `tests/test_variants.py` runs both configurations and requires the final speed to be within 5% of 5 m/s without passing 6 m/s. The second configuration is kept as `tests/fixtures/ev-performance.json`, written by the same builder.

This is a longitudinal control example with an averaged converter, not a vehicle energy model: there is no rolling resistance model beyond linear drag, no switching, no thermal behavior, and no regenerative braking limit.
