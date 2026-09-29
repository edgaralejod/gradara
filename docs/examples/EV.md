# EV drivetrain

A battery electric vehicle accelerating to a cruise speed. The model is organized in nested subsystems, three levels deep, with two variant subsystems and two configurations that switch them together. It is the reference example for subsystems and variants.

## Try it

Open **Examples**, choose **Use example** under **EV drivetrain**, then choose **Run**.

## Structure

| Level | Sheet | Contents |
| --- | --- | --- |
| Top | EV drivetrain | Speed request (0.5 m/s² ramp from 1 s) limited to a 5 m/s cruise speed, **Vehicle control**, **Powertrain**, the wheel (0.3 m radius), a 1,200 kg vehicle mass, road drag (40 N·s/m), and a speed sensor. |
| 1 | Vehicle control | Speed error → **Speed PI** (kp 0.4, ki 1 per m/s) → duty limited to ±1. |
| 1 | Powertrain | **Battery pack**, **Motor drive**, and a 6:1 final drive. |
| 2 | Battery pack | A Modelica Standard Library cell stack and its ground. Cell data is promoted to the subsystem block. |
| 2 | Motor drive | **Converter** and the motor. |
| 3 | Converter | A lossless averaged DC-DC stage: output voltage is duty × DC voltage, and the DC side draws duty × output current. |

## Variants and configurations

| Subsystem | Variants | Kind |
| --- | --- | --- |
| Battery pack | **LFP**: 34 cells, 3.6 V full, 2.5 V empty, 2 mΩ. **NMC**: 28 cells, 4.2 V full, 3.0 V empty, 3 mΩ. Both 40 Ah. | Parameter variants: same contents, different promoted values. |
| Motor drive | **PM DC machine**: the Modelica Standard Library permanent-magnet DC machine (100 V, 100 A nominal). **Simple DC motor**: Gradara's DC motor block (R 0.05 Ω, L 1.5 mH, k 0.64) with a separate 0.15 kg·m² rotor inertia. | Diagram variants: each has its own contents behind the same ports. |

The configuration menu beside **Run** has **City · LFP** (LFP, PM DC machine) and **Performance · NMC** (NMC, simple DC motor). Choosing one switches both subsystems. **Run all configurations** runs both and overlays them in Results as `[City · LFP] …` and `[Performance · NMC] …`. The Explorer's **Variants** view shows the same choices as a table.

## What to look at

- **Vehicle speed** (the default plot) follows the ramp and settles at the 5 m/s cruise speed in both configurations.
- Open **Powertrain › Battery pack** and switch between LFP and NMC with the switch above the block. Only the promoted cell values change.
- Open **Powertrain › Motor drive** in each motor variant. The contents differ, but the ports and the Converter are the same. Both variants share one Converter definition (**Used 2×**).

## Limits

This is a longitudinal speed-control example with an averaged converter, not a vehicle energy model. Road losses are a single linear drag term. There is no switching, no thermal behavior, and no regenerative braking limit.

## For contributors

The template is [ev.json](../../models/examples/ev.json). Regenerate it with `npx tsx scripts/build-ev-example.ts` after changing its [builder](../../scripts/build-ev-example.ts). The builder draws the flat diagram, then groups, promotes, and adds variants with the same operations the app uses.

The engine test `tests/test_variants.py` runs both configurations and requires the final speed to be within 5% of 5 m/s without passing 6 m/s. The second configuration is kept as `tests/fixtures/ev-performance.json`, written by the same builder.
