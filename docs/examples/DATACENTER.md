# Data center cooling control

A one-hour electrical and thermal model of a data center room. A PI controller adjusts cooling to hold the room at 24 °C while the IT load rises and the available cooling drops for a while. Use it to compare control strategies and see how heat storage buys time.

## Try it

Open **Examples**, choose **Use example** under **Data center cooling**, then choose **Run**. The default run simulates 3,600 seconds.

## How it is built

Every part is a library block with its own Help page. The top level shows the physics; three subsystems hold the equipment:

- **800 V DC** supply feeding **IT load** and **Cooling plant** over + and − rails.
- **IT load:** two **Resistor (thermal)** blocks, 600 kW and 300 kW at 800 V, whose electrical loss all leaves as heat. A **Switch (Boolean)** connects the second at 10 minutes (**Boolean step**). A **Heat flow sensor** reports the IT heat.
- **Rack mass** and **Room** are **Heat capacitors** (20 and 10 MJ/K, starting at 30 °C and 24 °C), joined by a **Thermal conductor** of 100 kW/K.
- **Cooling plant:** the command, limited by the available capacity (a **Pulse** takes half of it away from 30 to 35 minutes), times the 1,200 kW rating gives the heat removed. A **Heat flow source** takes it out of the room, and a **Controlled current** draws the plant's electricity, heat removed / COP 4, from the 800 V supply.
- **Controller:** a sampled **PI controller** (1 s) on room temperature against the 24 °C setpoint, added to a base command of 0.5 that balances the starting load. Its output limit of ±0.5 keeps the command within 0–1. It is pure signal flow, so it exports to C.
- **Temperature sensors** and a 273.15 K offset give the room and rack temperatures in °C.

## Scenario

| Time | Event |
| --- | --- |
| 0–600 s | Steady 600 kW IT load. Room at 24 °C, rack equipment at 30 °C, cooling command 0.5. |
| 600 s | IT load rises to 900 kW. |
| 1,800–2,100 s | Available cooling drops from 1,200 kW to 600 kW, then recovers. |
| 3,600 s | End of run. Check how the room recovers toward the 24 °C setpoint. |

## What to look at

- The default plots show room and rack temperatures; the powers (IT electricity, heat removed, cooling electricity, and heat rejected outdoors); and the controller's command.
- At a steady 900 kW load with a coefficient of performance (COP) of 4, expect 900 kW of heat removed, 225 kW of cooling electricity, and 1,125 kW of heat rejected outdoors. The supply delivers 1,125 kW.
- The room recovers close to 24 °C. The rack settles 9 K warmer than the room, because the rack-to-room conductance is 100 kW/K.
- While cooling is short, the room warms even at full command.

Rack temperature is a lumped equipment temperature, not a chip or inlet hot spot.

## Experiments

Save a copy before changing parameters (**Models → Save a copy**).

1. **Proportional-only control:** open **Controller** and set the PI's `ki` to `1e-12`. The command becomes 0.5 plus a proportional term, so the room settles about 2.5 K above the setpoint at 900 kW. Compare with PI.
2. **Not enough cooling:** open **Cooling plant**, set the rating gain (`Cooling kW (1200 kW rated)`) to `800` and the outage's `startTime` to `7200`; in **Controller**, set the base command to `0.75`. At 900 kW demand the plant saturates and the room keeps warming.
3. **Thermal buffering:** increase the rack or room heat capacity. Storage delays warming during a shortfall, but cannot make up for too little cooling in steady state.
4. **Efficiency:** change the COP by changing the two gains that use it in **Cooling plant** (electricity kW = heat kW / COP, current = electricity / 800 V). Electricity changes; temperatures do not, by construction.

## Assumptions and limits

This is a hand-built, lumped control benchmark with illustrative values. It is not a calibrated facility model or an HVAC equipment library.

- An ideal 800 V DC source supplies all loads. It stands in for the power supply; it does not model the grid, medium-voltage distribution, three-phase distribution, or voltage disturbances.
- All IT electricity becomes rack heat. Rack heat capacity is 20 MJ/K. Rack-to-room conductance is 100 kW/K.
- Room heat capacity is 10 MJ/K, representing well-mixed air plus some building mass. It is not derived from a room volume, and there are no gains through walls.
- Cooling follows the command at once, one sample per second. Available capacity limits what the controller can request. Cooling electricity is heat removed divided by a COP of 4. Heat rejected outdoors is heat removed plus cooling electricity.
- The PI controller raises cooling when the room is too warm. Its integral and output are clamped to ±0.5 around the base command. It does not know when capacity is reduced, so recovery after derating can overshoot.

The model has no water or refrigerant circuits, pressure drops, pump or fan power, humidity, air mixing, equipment staging, economizers, UPS, or weather-dependent COP. Do not read the electrical ratio as the facility's PUE: important loads are missing.

Detailed chilled-water and economizer models, such as those in the [Modelica Buildings library](https://simulationresearch.lbl.gov/modelica/releases/latest/help/Buildings_Applications_DataCenters_ChillerCooled.html), are not included.

## For contributors

The template is [datacenter.json](../../models/examples/datacenter.json). Regenerate it with `npx tsx scripts/build-datacenter-example.ts` after editing its [builder](../../scripts/build-datacenter-example.ts). The builder uses library blocks only, lays the model out flat, and groups it into the three subsystems with the helpers in [example-hierarchy.ts](../../scripts/example-hierarchy.ts).

The [engine regression](../../tests/test_datacenter.py) compares the PI, proportional-only, and undersized-plant cases. It checks the electrical and outdoor heat balances, the energy balance `rack and room stored heat = ∫ IT heat − ∫ heat removed`, and that results cover the full duration.
