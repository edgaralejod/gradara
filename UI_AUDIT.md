# Gradara workflow and UI audit

Reviewed 2026-09-13 through the running browser and implementation. The aim is a coherent model-building workspace with fast diagram interaction, understandable execution, and reusable examples. This is a workflow assessment, not a claim of Simulink feature parity or a complete accessibility certification.

## Assessment

The diagram renderer, domain colors, movable labels, and wiring interactions are a strong foundation. The largest gaps were around the canvas: users entered through examples, different creation actions were easy to confuse, narrow panels obscured useful controls, and plots assumed slow motor-control timescales. Adding more symbols would not have addressed those problems.

This pass makes the main path explicit: **New model → blank canvas or template → add/connect blocks → set stop time → Run → inspect signals → reopen/export**. Model identity and prior work remain independent of examples.

## Changes made

| Surface | Finding | Resolution |
| --- | --- | --- |
| Document entry | No obvious way to start an empty model | Visible New model button, named blank document, template chooser, inline creation failures, and automatic unique document names |
| Saved models | Templates and saved work competed in one selector | Selector opens saved documents; starting points live in the New model dialog |
| Empty canvas | An empty drawing had no next action | Brief connection guidance, Browse blocks, Ask agent, and an example shortcut; results collapse and Run is disabled until a block exists |
| Agent entry | “Create block” could be mistaken for creating a model | Canvas entry says Ask agent; the behavior field has an accessible name; generation remains an explicit action |
| Toolbar | Library and inspector could clip commands | Commands span the full workspace width; panels share space below them |
| Narrow layout | Side panels competed with the canvas/results | Below 1100 px, opening one closes the other; the inspector participates in layout above the mobile breakpoint |
| Simulation settings | Stop time was hidden in narrow windows and disallowed short power simulations | Editable stop time in toolbar and model properties, including sub-millisecond values |
| Results | Slow-system ranges hid switching detail | Full run, Last 10%, Last 50 ms, Last 1 ms, Fit Y, adaptive time units, preserved event pairs and denser final samples |
| Help | Long shortcut dialog placed its close control beyond the window | Scrollable shortcut list keeps title and close button visible |
| Library honesty | Mux, Demux, and Subsystem looked ready to simulate | Their library descriptions explicitly say Drawing only; existing execution checks still explain their limitation |
| Circuit vocabulary | Missing reusable ideal power components | DC voltage, Ideal switch, Voltage sensor, Current sensor, and Complementary PWM use the shared BlockFace renderer and domain-colored terminals |
| Examples | No switched power converter | A real 24 V synchronous buck with LC filter, current/voltage measurements, named nets, and saved plots |

All three templates now use explicit standard dimensions, shared terminal captions, named feedback nets where useful, and curated orthogonal routes, and useful default result groups (including DC speed command versus measured speed). DC and FOC generated Modelica remained byte-for-byte identical across the layout refresh. Example names with connected top/bottom terminals move to a free side; long buck power conductors no longer run through the captions. Existing saved diagrams retain their layouts; create from **New model** to use a refreshed template.

## Verification performed

- Created **My first model** from the blank starting point, added a Step from library search, exercised undo, ran OpenModelica successfully, and reloaded the saved result.
- Created the refreshed DC and FOC examples through the dialog; the DC main signal path is straight, and the FOC separates speed, current, power, and feedback groups. Their browser runs completed successfully (FOC rotor speed about 1500.34 rpm).
- Created the buck through the New model dialog and ran it through the UI. Examined startup, final-millisecond voltage ripple, and complementary gates.
- Opened model properties, library, agent entry, export chooser, and shortcuts without sending a new agent-generation request.
- Checked the user-sized 736 × 769 workspace and a 1280 × 720 background workspace. The agent/browser viewport override did not change the actual page size, so no smaller-width result is claimed.
- Reviewed new block faces and library specimens at 100% and 200% using the catalog. Canvas resizing uses the existing shared minimum-size and port geometry contract; regression coverage checks those contracts across all definitions. Example geometry tests also verify that no route crosses an unrelated block body.
- Real numerical tests compare 50% and 25% buck duty cycles with expected mean voltages, currents, and ripple. Existing DC motor, FOC, branched feedback, and singular-loop checks remain part of the suite.
- Existing saved DC, FOC, and feedback documents remain available. Browser QA created separate documents and used ordinary undoable commands for canvas edits.

## Next priorities

1. **Problems navigation:** replace long raw diagnostic output as the primary failure presentation with a concise list that selects the relevant block or net. Keep compiler/runtime detail in an expandable area. This is the largest remaining “debug a real model” UX gap.
2. **Simulation settings:** expose solver/tolerance, output interval, initialization, and parameter sweeps with meaningful defaults. Dense switching models need output reduction with a bounded event budget; retaining every event is intentionally sufficient for this small example, not a scalability solution.
3. **Model organization:** searchable recent models, Save a copy, folders, and recoverable deletion. The native saved-model selector is appropriate for the current small workspace, but will not scale to a project portfolio. Concurrent editing of the same document in multiple tabs is not a supported collaboration protocol.
4. **Results workbench:** draggable time-range selection, multiple synchronized plots, dual units when comparing voltage/current, cursors, and measurements. The current Compare control shares one Y-axis, so mixed-unit comparisons need care. Plot/range preferences are not persisted per model yet.
5. **Block authoring:** explicit component validation status, reusable user libraries, and structured refinement review. True hierarchical subsystems and vector buses must arrive with executable semantics; the existing placeholders remain drawing-only.
6. **Circuit editing:** a general rotate/flip command with port/label/route transformations. The buck template supplies vertical passives now; users should eventually be able to rotate any suitable component through an undoable command.
7. **Accessibility and platforms:** dedicated keyboard-only and screen-reader sessions, then real Windows/Linux and touch testing. Port names and dialogs have semantics, but that is not a substitute for assistive-technology testing.
8. **Export:** whole-controller subsystem boundaries and compiled C equivalence checks before expanding export claims. Current C generation is per controller block; HDL is still future work.

## Maintenance rule

Keep UI state separate from the executable document and simulation snapshot. Add new workflows through the same save queue, model commands, shared block renderer, and immutable run API. Use [BLOCK_DESIGN.md](BLOCK_DESIGN.md) and [WIRING.md](WIRING.md) rather than introducing another renderer or gesture layer.
