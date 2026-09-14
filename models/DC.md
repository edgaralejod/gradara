# DC motor speed control

Choose **New model → DC motor control**, create a document, and press **Run**. The default plot compares the speed request and measured shaft speed over four seconds.

The signal path is speed reference → sampled PI → controlled voltage source. The physical plant contains motor armature resistance/inductance, electromechanical coupling, rotational inertia/friction, an ideal speed sensor, and electrical ground. The sensor closes the feedback loop.

| Parameter | Default |
| --- | --- |
| Speed request | 100 rad/s, applied at 0.2 s |
| PI proportional / integral gains | 0.6 / 2 |
| Controller sample period | 1 ms |
| Drive magnitude limit | 24 V |
| Armature R / L | 1.2 Ω / 20 mH |
| Motor constant | 0.15 N·m/A |
| Load inertia | 0.02 kg·m² |
| Viscous friction | 0.002 N·m·s |

Change the **Speed reference** height to 60 and run again to inspect the response. Changing only block positions should keep the prior result valid; changing the parameter should require another run.

This is an ideal controlled voltage source, not a switching inverter. The model omits winding temperature, magnetic saturation, brush losses, backlash, and detailed friction. The controller has a bounded integral state and output saturation; it is not a complete industrial drive design.

The executable template is [dc.json](examples/dc.json). Physical wrappers are in [server/modelica.py](../server/modelica.py), and the real-engine motor checks are in [tests/test_modelica.py](../tests/test_modelica.py). The hand-written [MotorExample.mo](MotorExample.mo) is an early reference model; current templates are authored in Gradara JSON and emitted by the backend.
