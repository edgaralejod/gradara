# DC motor speed control

A DC motor driven by a controlled voltage source, with a sampled PI controller that holds the shaft speed at a requested value.

## Try it

Open **Examples**, choose **Use example** under **DC motor**, then choose **Run**. This saves your own copy. The example itself does not change.

## What the model contains

The signal path is speed reference → sampled PI controller → controlled voltage source. The physical part has the motor's armature resistance and inductance, the electromechanical coupling, the rotating inertia with friction, an ideal speed sensor, and an electrical ground. The speed sensor closes the feedback loop.

| Parameter | Default |
| --- | --- |
| Speed request | 100 rad/s, applied at 0.2 s |
| PI proportional / integral gains | 0.6 / 2 |
| Controller sample period | 1 ms |
| Drive voltage limit | ±24 V |
| Armature R / L | 1.2 Ω / 20 mH |
| Motor constant | 0.15 N·m/A |
| Load inertia | 0.02 kg·m² |
| Viscous friction | 0.002 N·m·s |
| Stop time | 4 s |

## What to look at

- The default plot compares the speed request with the measured shaft speed over four seconds.
- Double-click **Speed reference**, change **Target speed** to 60, and run again.
- Moving blocks keeps the previous result. Changing a parameter needs another run.
- **Export → Modelica source** shows the Modelica code generated from your model.

## Limits

The drive is an ideal controlled voltage source, not a switching inverter. The model leaves out winding temperature, magnetic saturation, brush losses, backlash, and detailed friction. The controller limits its integral and its output, but it is not a complete industrial drive design.

## For contributors

The template is [dc.json](examples/dc.json). Physical component wrappers are in [server/modelica.py](../server/modelica.py), and the real-engine motor checks are in [tests/test_modelica.py](../tests/test_modelica.py). `npx tsx scripts/style-examples.ts` reproduces the DC and FOC template layouts without touching saved models.
