# Data center cooling control

A one-hour electrical and thermal model of a data center room. A PI controller adjusts cooling to hold the room at 24 °C while the IT load rises and the available cooling drops for a while. Use it to compare control strategies and see how heat storage buys time.

## Try it

Open **Examples**, choose **Use example** under **Data center cooling**, then choose **Run**. The default run simulates 3,600 seconds.

## Scenario

| Time | Event |
| --- | --- |
| 0–600 s | Steady 600 kW IT load. Room at 24 °C, rack equipment at 30 °C, cooling command 0.5. |
| 600 s | IT load rises to 900 kW. |
| 1,800–2,100 s | Available cooling drops from 1,200 kW to 600 kW, then recovers. |
| 3,600 s | End of run. Check how the room recovers toward the 24 °C setpoint. |

## What to look at

- The two default plots show room and rack temperatures, and the powers: IT electricity, heat removed, compressor electricity, and heat rejected outdoors.
- To see the controller's command, choose the 2 × 2 layout and add `Room temperature PI.u` to an empty plot.
- At a steady 900 kW load with a coefficient of performance (COP) of 4, expect 900 kW of heat removed, 225 kW of compressor electricity, and 1,125 kW of heat rejected outdoors. The supply delivers 1,125 kW.
- The room recovers close to 24 °C. The rack settles 9 K warmer than the room, because the rack-to-room conductance is 100 kW/K.
- While cooling is short, the room warms even at full command.

Temperature outputs are in degrees Celsius. Inside the model, heat ports use kelvin. Rack temperature is a lumped equipment temperature, not a chip or inlet hot spot.

## Experiments

Save a copy before changing parameters (**Models → Save a copy**).

1. **Proportional-only control:** set the controller's `integralTime` to `1e12`. This approximates proportional-only control with the same starting bias. Compare the remaining error and the recovery with PI.
2. **Not enough cooling:** set the plant's `ratedCooling` to `800000`, the controller's `initialCommand` to `0.75`, and the plant's `derateStart` and `derateEnd` to `7200` and `7500`. At 900 kW demand the controller saturates and the room keeps warming.
3. **Thermal buffering:** increase the rack or room heat capacity. Storage delays warming during a shortfall, but cannot make up for too little cooling in steady state.
4. **Efficiency:** change the COP at fixed cooling capacity. Electricity changes; temperatures do not, by construction. This is a sensitivity study, not a prediction of real part-load efficiency.

## Assumptions and limits

This is a hand-built, lumped control benchmark with illustrative values. It is not a calibrated facility model or an HVAC equipment library.

- An ideal 800 V DC source supplies all loads. It stands in for the power supply; it does not model the grid, medium-voltage distribution, three-phase distribution, or voltage disturbances.
- All IT electricity becomes rack heat. Rack heat capacity is 20 MJ/K. Rack-to-room conductance is 100 kW/K.
- Room heat capacity is 10 MJ/K, representing well-mixed air plus some building mass. It is not derived from a room volume, and there are no gains through walls.
- Cooling responds with a 20-second lag. Available capacity limits what the controller can request. Compressor power is cooling divided by a COP of 4. Heat rejected outdoors is cooling plus compressor electricity.
- The PI controller raises cooling when the room is too warm, with anti-windup at its 0–1 command limits. It does not know when capacity is reduced, so recovery after derating can overshoot. Its starting bias balances the initial load.

The model has no water or refrigerant circuits, pressure drops, pump or fan power, humidity, air mixing, equipment staging, economizers, UPS, or weather-dependent COP. Outdoor temperature is a heat sink only and does not change the COP. Do not read the electrical ratio as the facility's PUE: important loads are missing. Capacities, conductance, COP, voltage threshold, and time constants must be positive. Availability must be between zero and one.

Detailed chilled-water and economizer models, such as those in the [Modelica Buildings library](https://simulationresearch.lbl.gov/modelica/releases/latest/help/Buildings_Applications_DataCenters_ChillerCooled.html), are not included.

## For contributors

The template is [datacenter.json](../../models/examples/datacenter.json). Regenerate it with `npx tsx scripts/build-datacenter-example.ts` after editing its [builder](../../scripts/build-datacenter-example.ts). It embeds its own definitions and needs only the Modelica Standard Library.

The [engine regression](../../tests/test_datacenter.py) compares the PI, proportional-only, and undersized-plant cases. It checks the electrical and outdoor heat balances, the energy balance `rack energy + room energy = IT energy − removed heat`, and that results cover the full duration.
