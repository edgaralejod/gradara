# Data center cooling control

Open **Examples → Data center cooling** and run the default 3,600-second scenario. This is a hand-authored, lumped electrical–thermal control benchmark with illustrative parameters, not a calibrated facility model or a complete HVAC equipment library.

The editable template is [datacenter.json](../../models/examples/datacenter.json). Regenerate it with `npx tsx scripts/build-datacenter-example.ts` after editing its [builder](../../scripts/build-datacenter-example.ts). It embeds its definitions and needs no provider call or external library beyond the installed Modelica standard library. Saved copies are independent of the template.

## Scenario

| Time | Event |
| --- | --- |
| 0–600 s | Steady 600 kW IT load; room 24 °C; rack thermal mass 30 °C; cooling command 0.5. |
| 600 s | IT demand increases to 900 kW. |
| 1,800–2,100 s | Available cooling falls from 1,200 to 600 kW, then recovers. |
| 3,600 s | End of run; inspect recovery toward the 24 °C room setpoint. |

The initial two plots show room/rack temperatures and powers: IT electricity, heat removal, compressor electricity, and outdoor heat rejection. To inspect controller command, choose the 2 × 2 layout and assign `Room temperature PI.u` to an empty plot. Physical heat ports use kelvin; temperature outputs use Celsius. Rack temperature is a lumped equipment temperature, not a chip junction or inlet hot spot.

At steady 900 kW IT demand and COP 4, expect 900 kW of heat removal, 225 kW of compressor electricity, and 1,125 kW of heat rejection. The ideal supply delivers 1,125 kW. Room temperature should recover close to 24 °C; the rack mass settles 9 K warmer because its conductance is 100 kW/K. Insufficient available cooling must cause warming even with maximum command.

## Physical assumptions

- An ideal 800 V DC source supplies both loads. It is a power-supply equivalent, not an MV grid, SST, three-phase distribution, or voltage-disturbance model. Use nominal voltage for control comparisons.
- All absorbed IT electricity becomes rack heat. Rack capacity is 20 MJ/K and rack-to-room conductance is fixed at 100 kW/K.
- Room capacity is 10 MJ/K, representing well-mixed air plus illustrative coupled building mass. It is not derived from a specific room volume; there are no envelope gains.
- Cooling has a 20-second first-order response. Availability limits the requested capacity; actual cooling decays toward a reduced limit with that lag. At nominal voltage, compressor power is cooling divided by COP 4. Outdoor heat rejection equals cooling plus absorbed electricity.
- The PI controller increases cooling for positive temperature error and uses back-calculation anti-windup at its 0–1 command limits. It does not receive availability feedback from the plant, so derating can still produce recovery overshoot. Its initial bias balances the initial load.

There are no fluid circuits, pressure drops, pump/fan electricity, humidity, latent cooling, spatial air mixing, equipment staging, economizer logic, UPS behavior, or weather-dependent COP. Outdoor temperature is a heat-sink boundary only; changing it does not change COP. Do not call the electrical ratio facility PUE: important facility loads are omitted. Capacities, conductance, COP, voltage threshold, and time constants must be positive; availability must be between zero and one.

## Experiments

Save a separate copy before changing parameters:

1. **Control comparison:** set controller `integralTime=1e12` to approximate proportional-only control with the same baseline bias. Compare residual error and recovery with PI.
2. **Insufficient capacity:** set plant `ratedCooling=800000`, controller `initialCommand=0.75`, and plant `derateStart=7200`, `derateEnd=7500`. Under 900 kW demand, the controller saturates and room temperature keeps rising.
3. **Thermal buffering:** increase rack or room heat capacity. Storage delays warming during a shortfall but cannot fix insufficient steady capacity.
4. **Efficiency:** vary COP at fixed cooling capacity. Electricity changes while temperatures remain unchanged by construction. This is sensitivity analysis, not real part-load efficiency prediction.

The [engine regression](../../tests/test_datacenter.py) compares PI, proportional-only, and undersized-plant cases. It checks electrical and condenser heat balances, the integral balance `rack energy + room energy = IT energy − removed heat`, and full-duration results.

Manual models support up to 86,400 simulated seconds. The solver retains 6,000 output intervals and a 120-second wall-clock timeout; long runs may not resolve fast events adequately in the saved output. Agent full-model planning retains its separate 60-second limit.

The [Modelica Buildings data-center package](https://simulationresearch.lbl.gov/modelica/releases/latest/help/Buildings_Applications_DataCenters_ChillerCooled.html) is a later extension target for detailed chilled-water and economizer models. It is not installed or exposed by this example; fluid connectors and tested library wrappers are separate work.
