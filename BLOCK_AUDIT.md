# Gradara block audit

Generated with `npm run audit:blocks`. This inventory comes from the live catalog; it is not an automated claim of visual or numerical correctness. Visual review uses [/block-catalog](http://localhost:4317/block-catalog).

## Scope and findings

All **65 built-in definitions** now use the same face in the canvas and library. **36 of 65** use the 80 × 64 standard envelope, including gain. Remaining sizes are semantic exceptions or port-driven expansions. All normal diagram text uses the shared 14 px scale.

The previous catalog mixed 10 body dimensions, separate library/canvas outlines, and multiple symbol/label font scales. The refresh removes the library's duplicate sum/gain outlines, standardizes unary and binary math, reserves space for terminal captions, bounds numeric labels, and fixes circuit lead continuity. The full second-order transfer notation and discrete-integrator notation now match their existing equations. The original visual pass preserved numerical behavior. The power-electronics extension adds five executable definitions; the ideal-switch buck is checked separately in `tests/test_buck.py` and documented in [BUCK.md](models/BUCK.md).

Legacy dimensions below remain the fallback for old unsized v1 documents. Existing explicitly sized blocks also retain their sizes. Use the inspector's **Use standard size** action to opt a block into the new dimensions.

## Complete inventory

Ports / captions counts include all terminals and captions visible at canvas scale. Library thumbnails omit terminal captions except sum signs.

| Block | Kind | Category | Legacy fallback | New default | Shape | Ports / captions | Review notes |
| --- | --- | --- | --- | --- | --- | --- | --- |
| DC voltage | `dcSource` | electrical | 120 × 90 | 48 × 80 | physical | 2 / 0 | Ideal constant voltage; vertical leads meet electrical terminals. |
| Ideal switch | `idealSwitch` | electrical | 120 × 90 | 48 × 80 | physical | 3 / 0 | True zero-Ron / zero-Goff switch; signal gate on the left. |
| Voltage sensor | `voltageSensor` | electrical | 120 × 90 | 48 × 80 | physical | 3 / 0 | Zero-loading voltage measurement; signal output on the right. |
| Current sensor | `currentSensor` | electrical | 120 × 90 | 80 × 48 | physical | 3 / 0 | Zero-drop current measurement; signal output below. |
| Complementary PWM | `pwmPair` | control | 120 × 90 | 128 × 96 | box | 2 / 2 | Two complementary outputs retain hi / lo captions; 128 × 96 body. |
| Sum | `sum` | math | 36 × 36 | 40 × 40 | sum | 3 / 2 | One circle; signs at input terminals. |
| Subtract | `subtract` | math | 36 × 36 | 40 × 40 | sum | 3 / 2 | Minus sign identifies the subtracting input. |
| Constant | `constant` | sources | 64 × 56 | 80 × 64 | box | 1 / 0 | Shared typography, symbol well, and caption rules. |
| Limited integrator | `integrator` | continuous | 64 × 56 | 80 × 64 | box | 2 / 0 | Shared typography, symbol well, and caption rules. |
| Current PI | `currentPI` | control | 96 × 70 | 80 × 64 | box | 2 / 0 | Shared typography, symbol well, and caption rules. |
| Clarke transform | `clarke` | control | 120 × 90 | 128 × 96 | box | 5 / 5 | Shared typography, symbol well, and caption rules. |
| Park transform | `park` | control | 120 × 90 | 128 × 96 | box | 5 / 5 | Shared typography, symbol well, and caption rules. |
| Inverse transforms | `inversePark` | control | 120 × 90 | 128 × 96 | box | 6 / 6 | Shared typography, symbol well, and caption rules. |
| Three-phase inverter | `inverter` | electrical | 120 × 90 | 128 × 96 | box | 6 / 6 | Shared typography, symbol well, and caption rules. |
| PMSM | `pmsm` | electrical | 120 × 90 | 160 × 96 | box | 11 / 11 | Expanded width for four bottom signal terminals; mixed-domain colors. |
| Mechanical load | `shaftLoad` | mechanical | 120 × 90 | 128 × 96 | box | 2 / 2 | Shared typography, symbol well, and caption rules. |
| Step | `step` | sources | 64 × 56 | 80 × 64 | box | 1 / 0 | Shared typography, symbol well, and caption rules. |
| PI controller | `pi` | control | 96 × 70 | 128 × 96 | box | 3 / 3 | Shared typography, symbol well, and caption rules. |
| Voltage drive | `voltage` | electrical | 120 × 90 | 128 × 96 | box | 3 / 3 | Shared typography, symbol well, and caption rules. |
| DC motor | `motor` | electrical | 120 × 90 | 128 × 96 | box | 3 / 3 | Shared typography, symbol well, and caption rules. |
| Inertia & load | `inertia` | mechanical | 120 × 90 | 128 × 96 | box | 2 / 2 | Shared typography, symbol well, and caption rules. |
| Speed sensor | `sensor` | mechanical | 120 × 90 | 128 × 96 | box | 2 / 2 | Shared typography, symbol well, and caption rules. |
| Ground | `ground` | electrical | 48 × 40 | 40 × 40 | ground | 1 / 0 | Shared typography, symbol well, and caption rules. |
| Gain | `gain` | math | 72 × 64 | 80 × 64 | gain | 2 / 0 | Triangle, bounded gain value. |
| Low-pass filter | `filter` | continuous | 96 × 70 | 80 × 64 | box | 2 / 0 | Shared typography, symbol well, and caption rules. |
| Saturation | `saturation` | nonlinear | 64 × 56 | 80 × 64 | box | 2 / 0 | Shared typography, symbol well, and caption rules. |
| Ramp | `ramp` | sources | 64 × 56 | 80 × 64 | box | 1 / 0 | Shared typography, symbol well, and caption rules. |
| Sine wave | `sine` | sources | 64 × 56 | 80 × 64 | box | 1 / 0 | Shared typography, symbol well, and caption rules. |
| Pulse | `pulse` | sources | 64 × 56 | 80 × 64 | box | 1 / 0 | Shared typography, symbol well, and caption rules. |
| Clock | `clock` | sources | 64 × 56 | 80 × 64 | box | 1 / 0 | Shared typography, symbol well, and caption rules. |
| Product | `product` | math | 120 × 90 | 80 × 64 | box | 3 / 0 | Shared typography, symbol well, and caption rules. |
| Divide | `divide` | math | 120 × 90 | 80 × 64 | box | 3 / 3 | Shared typography, symbol well, and caption rules. |
| Abs | `abs` | math | 64 × 56 | 80 × 64 | box | 2 / 0 | Unambiguous |u| notation. |
| Sign | `sign` | math | 64 × 56 | 80 × 64 | box | 2 / 0 | Recognizable sgn notation. |
| Sqrt | `sqrt` | math | 64 × 56 | 80 × 64 | box | 2 / 0 | Shared typography, symbol well, and caption rules. |
| Min | `min` | math | 120 × 90 | 80 × 64 | box | 3 / 0 | Shared typography, symbol well, and caption rules. |
| Max | `max` | math | 120 × 90 | 80 × 64 | box | 3 / 0 | Shared typography, symbol well, and caption rules. |
| Sin | `sineOp` | math | 64 × 56 | 80 × 64 | box | 2 / 0 | Shared typography, symbol well, and caption rules. |
| Cos | `cosineOp` | math | 64 × 56 | 80 × 64 | box | 2 / 0 | Shared typography, symbol well, and caption rules. |
| Unary minus | `unaryMinus` | math | 64 × 56 | 80 × 64 | box | 2 / 0 | Shared typography, symbol well, and caption rules. |
| Power | `power` | math | 120 × 90 | 80 × 64 | box | 2 / 0 | Shared typography, symbol well, and caption rules. |
| Derivative | `derivative` | continuous | 64 × 56 | 80 × 64 | box | 2 / 0 | Shared typography, symbol well, and caption rules. |
| Second-order | `secondOrder` | continuous | 96 × 70 | 160 × 64 | box | 2 / 0 | Complete denominator: s² + 2ζωₙs + ωₙ². |
| Transport delay | `delay` | continuous | 64 × 56 | 80 × 64 | box | 2 / 0 | Shared typography, symbol well, and caption rules. |
| PID | `pid` | control | 96 × 70 | 80 × 64 | box | 2 / 0 | Shared typography, symbol well, and caption rules. |
| Unit delay | `unitDelay` | discrete | 64 × 56 | 80 × 64 | box | 2 / 0 | Shared typography, symbol well, and caption rules. |
| Zero-order hold | `zoh` | discrete | 64 × 56 | 80 × 64 | box | 2 / 0 | Shared typography, symbol well, and caption rules. |
| Discrete integrator | `discreteIntegrator` | discrete | 120 × 90 | 80 × 64 | box | 2 / 0 | Ts·z / (z−1) matches the implemented current-sample accumulation; description corrected. |
| Dead zone | `deadzone` | nonlinear | 64 × 56 | 80 × 64 | box | 2 / 0 | Shared typography, symbol well, and caption rules. |
| Relay | `relay` | nonlinear | 64 × 56 | 80 × 64 | box | 2 / 0 | Shared typography, symbol well, and caption rules. |
| Rate limiter | `rateLimiter` | nonlinear | 120 × 90 | 80 × 64 | box | 2 / 0 | Shared typography, symbol well, and caption rules. |
| Mux | `mux` | routing | 48 × 72 | 40 × 96 | mux | 4 / 4 | Caption-only tapered body. Existing scalar stand-in, not a vector bus. |
| Demux | `demux` | routing | 48 × 72 | 40 × 96 | demux | 4 / 4 | Caption-only tapered body. Existing scalar stand-in, not a vector bus. |
| Switch | `switch2` | routing | 120 × 90 | 128 × 96 | box | 4 / 4 | Shared typography, symbol well, and caption rules. |
| Manual switch | `manualSwitch` | routing | 120 × 90 | 80 × 64 | box | 3 / 3 | Shared typography, symbol well, and caption rules. |
| Subsystem | `subsystem` | routing | 150 × 92 | 128 × 96 | box | 4 / 4 | Nested-block glyph. Existing pass-through placeholder; no hierarchical execution. |
| Terminator | `terminator` | sinks | 64 × 56 | 80 × 64 | box | 1 / 0 | Shared typography, symbol well, and caption rules. |
| Scope | `scope` | sinks | 92 × 64 | 80 × 64 | box | 1 / 0 | Scope glyph; actual simulation traces remain in the results panel. |
| Display | `display` | sinks | 64 × 56 | 80 × 64 | box | 1 / 0 | 123 is a notation glyph, not a live numerical readout. |
| Resistor | `resistor` | electrical | 80 × 44 | 80 × 48 | physical | 2 / 0 | Unboxed; leads touch both terminal coordinates. |
| Capacitor | `capacitor` | electrical | 80 × 44 | 80 × 48 | physical | 2 / 0 | Unboxed; leads touch both terminal coordinates. |
| Inductor | `inductor` | electrical | 80 × 44 | 80 × 48 | physical | 2 / 0 | Coil baseline aligned with both terminals. |
| Diode | `diode` | electrical | 80 × 44 | 80 × 48 | physical | 2 / 0 | Extended leads reach both terminals. |
| Spring-damper | `springDamper` | mechanical | 120 × 90 | 80 × 64 | box | 2 / 2 | Shared typography, symbol well, and caption rules. |
| Torque sensor | `torqueSensor` | mechanical | 120 × 90 | 128 × 96 | box | 3 / 3 | Shared typography, symbol well, and caption rules. |

## Remaining boundaries

- This is a visual/catalog audit, not a proof of all component physics. Mux, Demux, Subsystem, Display, and Scope have the limitations noted above.
- No built-in thermal block currently exists; thermal coloring is supported by the shared domain system.
- Historical custom sizes may still be too small for complete notation. Resizing them to the standard is deliberate and undoable, not an automatic migration.
- Very long port captions ellipsize and retain their full tooltip/inspector value. Custom tightly clustered offsets need manual review.
- A future block should be added to the catalog automatically and reviewed using [the authoring guide](docs/blocks/AGENT_BLOCK_GUIDE.md). Preserve this renderer architecture instead of adding one-off library icons.
