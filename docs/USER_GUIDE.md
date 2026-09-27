# Modeling with Gradara

## Settings

The gear button opens **Settings**:

- **Engine** shows whether simulation is ready and walks through one-time setup: OpenModelica and its standard library on Windows and Linux, or a container runtime and engine image on macOS. Automatic selection prefers a native install.
- **AI** chooses the provider for AI features: Gradara AI (sign in, prepaid credits), your own OpenAI or Anthropic API key, the Codex CLI, or Off. Signed-in accounts show the credit balance, prices, and credit packs.
- **Privacy & data** summarizes what stays on your computer and what AI requests send. See [privacy](PRIVACY.md).
- **Updates** shows the installed version and lets you check for a new one.

### Updates

The desktop app checks for a new version at launch and every four hours, and downloads it in the background while you work (a progress pill shows in the header). When it is ready, the header shows **Restart to update**: your models are already saved, so restarting installs it. If you don't restart, it installs the next time you quit. **Help → Check for Updates** checks right away. The Linux .deb package can't replace itself without your password, so it shows **Update available** and opens the download page instead. Source checkouts update with `git pull`.

## Create, save, and share

Click **New model** to open a fresh empty canvas immediately. Its initial name is **Untitled model**, with a suffix when needed. Click the title in the header to rename it; Enter or clicking away commits the name, and Escape cancels editing.

Open **Models** for the file browser:

- **My models** contains your saved documents, searchable by name and ordered by last save. Rows show whether a model is empty, its block count, and its example origin when applicable.
- **Examples** contains built-in starting points. **Use example** creates a new saved copy in My models. Editing or emptying that copy does not change the original example or automatically rename your document.
- **Trash** holds removed models. Use a row's trash icon to move an inactive model there; open another model before removing the current one. Click a model in Trash to restore it. There is no permanent-delete command.

**Save a copy** creates a separate document with your current edits. **Import file** opens a `.gradara.json` or legacy `.flux.json` as a new document, even if its ID matches a saved model. Repeated imports and copies receive distinct names. **Export** downloads portable JSON or generated Modelica; Modelica import is not implemented.

Edits autosave locally after a short pause. Switching models or opening the file browser finishes the current save first. The footer distinguishes **Unsaved changes**, **Saving**, **Saved**, and **Not saved**. ⌘/Ctrl+S on the canvas performs an actual save. Keep the local service running.

Saving a model does not make it the active model in another tab. Each browser tab remembers its own open document for reload. If two tabs edit the same saved version, the second save is rejected instead of overwriting the first. The error banner offers **Retry**, **Save a copy**, and **Reload saved version**. Saving a copy keeps your edits; reloading explicitly replaces them with the disk version. There is no automatic merge or live collaboration.

Unsaved drafts are retained in the current tab's session storage when browser storage is available, allowing recovery after reload. This is a recovery aid, not an offline workspace or a backup after closing the tab. The browser warns before leaving with unsaved edits. Undo history is per tab and resets on model switching/reload.

Model documents live in `projects/models/`; removed models live in `projects/trash/`. The active-workspace file records which document a new session should reopen. Back up `projects/` for the complete local history, results, and artifacts. Custom nested folders are not implemented yet.

## Build a diagram

Click a library component to insert it, or invoke the agent from a selected location or dangling connection. Double-click empty canvas to open the add-block picker at the pointer; it stays fully on the sheet if you click near an edge. Select a component to edit its parameters in the inspector. Double-click any block to open its block dialog on **Properties**, where you can rename it and change every parameter (for example a gain's `k` or a resistor's `R`); **Reset** restores a built-in block's library default. Changes are staged until you choose **Apply** or press Enter, and the whole dialog session is one undo step; Cancel or Escape discards them. The **Equations** and **State & declarations** tabs edit signal and AI-generated definitions in Monaco. Built-in physical implementations use canonical Modelica wrappers, so their equations are read-only and explain behavior. The inspector's **Edit…** and **Equations → Open** open the same dialog. Double-clicking a block never opens the add-block picker.

Blocks get readable unique names such as Step, Step1, and Step2. IDs remain stable when names change. Drag a block label separately from the symbol; double-click the label to restore its default location. Press **R** to rotate selected blocks clockwise by 90° about their centers. Ports and connected wires follow, while the instance name stays below the symbol. Rotation supports undo/redo and is saved with the model; with only wires selected, R still restores automatic routing. Resize using selection handles, or choose **Use standard size** in the inspector. The library, canvas, and [block catalog](http://localhost:4317/block-catalog) share the same visual design.

The library has 218 built-in blocks in 18 categories: Sources, Math, Continuous, Discrete, Nonlinear, Routing, Control, Sinks, Logic, Electrical, Semiconductors, Converters, Machines, 3-phase, Rotational, Translational, Thermal, and Magnetic. Most physical, logic, and machine blocks are instances of Modelica Standard Library 4.1.0 classes; their parameters map onto the library class, and the block dialog's Equations tab names that class instead of listing equations. **Refine with agent** is not available for them.

Port colors show the connector's domain, which can differ from its block's main domain. The domains are signal (real values), Boolean, electrical, rotational, translational, thermal, magnetic, and 3-phase. Signal and Boolean ports are inputs and outputs; the others are physical terminals. An actuator or sensor can have both a physical connector and a signal port. Signal wires connect an output to inputs; physical wires join compatible physical connectors. Crossing lines alone do not create a connection.

## Wire and arrange

Select blocks, wires, or junctions and use the **arrow keys** to nudge them by one diagram unit, or **Shift + arrow** for ten units. Holding an arrow repeats the movement as one undo action. Connected wires follow moving blocks; unselected block terminals stay fixed when a wire moves. Arrow keys keep their normal behavior in text fields and focused plots.

| Action | Gesture |
| --- | --- |
| Connect | Drag port to port, or click the start and destination. |
| Join an existing net | Finish on wire ink or a junction. |
| Pin bends while drawing | Release into empty space, then click bend locations. |
| Reshape | Select a wire and drag a segment, midpoint grip, or corner. |
| Reconnect | Drag a selected wire's round endpoint to a port or wire. |
| Redraw | Select a wire and press D; finish at the highlighted destination or Enter. |
| Restore automatic routing | Select the wire and press R. |
| Branch | Drag an unselected wire, Alt-drag a wire, or branch from a junction. |
| Cancel / undo a pinned bend | Escape / Backspace while drawing. |
| Move a selection | Drag its blocks; internal geometry follows the group. |
| Duplicate | Ctrl-drag, or select and use ⌘/Ctrl+D. |

Nearby parallel segments snap together and shed redundant bends. Junctions should follow their horizontal run as connected blocks move. One completed gesture should be one undo step. Report a minimal reproduction when a gesture behaves differently; see the [wiring contract](architecture/WIRING.md) for expected behavior and limitations.

The model inspector exposes blocks and logical nets in a compact tree. The tree and property pane scroll independently. Select the model root, a block, or a net to switch the property pane; component parameters use aligned name/value rows. Expand Description to read model or component notes. Nets receive stable IDs plus automatic names derived from their connection. Give a net a custom name when the engineering meaning is clearer than the default; its label and identity belong to the connected net, not each drawn segment.

## Subsystems

A subsystem is a block with its own diagram inside. Documents with subsystems are saved as format version 2; flat documents stay version 1.

- **Make one.** Select blocks and press ⌘/Ctrl+G, or **Make subsystem** in the inspector. The selection is replaced by one subsystem block. Every wire the selection boundary cuts becomes a port: a signal driven inside becomes an output, one driven outside becomes an input, and a physical net becomes a physical terminal of its domain. Connectivity and the outside net names stay as they were. A library **Subsystem** block starts as a subsystem that passes in1 to out1 and in2 to out2.
- **Open it.** Double-click the block, or choose **Open** in the inspector. The header shows a breadcrumb from **Top level** down to the open subsystem; click a level to go there. Press Escape with nothing selected, or ⌘/Ctrl+↑, to go up one level; the subsystem you left is selected. Every canvas tool works inside, and each edit is one undo step.
- **Ports.** Inside, ports are pills named after the port and colored by domain: **Subsystem input**, **Subsystem output**, and **Subsystem terminal** in the Routing library. Inputs and outputs show their position number. Select a pill to set its domain (signal or Boolean for inputs and outputs, a physical domain for terminals) and, for a terminal, the side it sits on outside. The pill's name is the port name on the subsystem block. Adding, removing, or renaming a pill updates every instance; wires to a port that no longer exists are removed.
- **Ungroup.** Press ⌘/Ctrl+Shift+G, or **Ungroup** in the inspector. The inside replaces the block and is wired to what the block was wired to.
- **Shared definitions.** Copying or duplicating a subsystem block makes another instance of the same inside. The inspector shows **Used N×** when several instances share it; editing the inside changes all of them. **Make unique** gives the selected instance its own copy. Pasting brings the definitions along, and pasting a subsystem inside itself is refused.
- **Parameters.** Inside a subsystem, the ↑ button beside a parameter promotes it: it becomes a parameter of the subsystem block, and each instance sets its own value. The inner field then shows **set per instance**. The ↓ button stops promoting it, and the inner block keeps its own value.

Results inside a subsystem are named by path, such as `Drive › Gain.y`, and select the top-level subsystem block. The Data Inspector's signal list groups them under **Top level** and each subsystem path. You can log nets inside a subsystem; every instance records its own copy.

Hover over a subsystem block for a moment to see a small drawing of its inside, without opening it.

### Variants and configurations

A subsystem block can hold several alternative insides behind one set of ports, for example two controller designs.

Select the block and use the inspector's **Variants** section. **+ Diagram variant** copies the current inside into a new variant you can edit on its own; it keeps the same ports. **+ Parameter variant** keeps the same inside and remembers its own values of the promoted parameters. New variants are named A, B, C; double-click a name to rename it. A segmented switch above the block shows every variant and switches with one click; the inspector list does the same. Removing variants down to one makes the block an ordinary subsystem again.

Only the active variant is simulated. The block has every port any variant has. If the active variant's inside lacks one of them, the Problems dock reports an error and Run refuses the model, unless you check **not used here** for that port under the variant. An unused port stays idle: an output gives 0 (or false), an input is ignored, and a physical terminal carries no current, torque, force, heat, or flux. Problems in inactive variants (missing ports and errors inside, such as unconnected inputs) appear as warnings, so a broken alternative shows before you switch to it. When the engine is ready, Gradara also compiles each inactive variant with OpenModelica about eight seconds after you stop editing, one at a time and never during a run; a variant that does not compile appears under **Inactive variants** in Problems. Turn this off, or compile now, in the Explorer's **Variants** view, which also lists each result.

When a model has variants, a configuration menu appears left of **Run**. It shows the saved configuration that matches the current choices, or **Custom**. **Save current choices…** stores which variant every subsystem uses, including subsystems inside others; choosing a configuration switches all of them in one undo step. **Run all configurations** (two or more saved) runs each one in turn without changing the open model, then opens Results with every signal overlaid and named `[Configuration] signal`. Later runs are resampled onto the first run's time points. The overlay is not saved with the model; run again to see it after reopening.

## Model Explorer

The **Explorer** tab (⌘/Ctrl+3), beside Diagram and Results, shows the whole model at once. The right-hand inspector stays for quick edits while drawing.

- **Tree.** The left pane lists the blocks of the top level. A subsystem expands to its inside; a subsystem with variants expands to its variants, and each variant to its inside. Badges show the active variant and **Used N×**; a red dot marks a block with problems. The block selected in the Diagram is underlined. Double-click a row to open that place in the Diagram.
- **Parameters.** Every parameter under the selected tree node (the whole model when the root is selected) as one sheet: location, block, parameter, value, unit, and range. Edit a value in place; each edit is one undo step. **Filter** matches block, parameter, and unit words. **Find value** and **Replace with** change every listed parameter whose value equals the one you enter. ↑ promotes a parameter inside a subsystem to the subsystem block; a promoted parameter shows its subsystem parameter's name and is set per instance on the block instead.
- **Variants.** One row per subsystem with variants, one column per configuration. **Current** switches the active variant; each configuration's column sets its choice, and **Apply** switches the model to it. Rename a configuration in its header. **Configuration from current choices** adds one; **Run all configurations** runs and overlays them.
- **Signals.** Every signal net in the model with its location and unit. Check **Log** to record it on the next run; after a run, the range of each logged signal is shown. **Open Results** switches to the Data Inspector.
- **Search.** ⌘/Ctrl+K opens the Explorer and focuses search. It finds blocks, ports, parameters, nets, subsystems, and variants anywhere in the hierarchy; Enter or a click opens the first or chosen match in the Diagram and selects it. An inside that belongs only to an inactive variant cannot be opened until you switch to it.

The tables draw only the rows in view, so a model with a thousand blocks stays responsive.

## Simulate and inspect

Set the stop time and press **Run**. Manual models accept stop times greater than 0 and at most 86,400 seconds. Compilation and simulation happen asynchronously. You can cancel from the run controls. Unconnected signal inputs, drawing-only blocks (mux and demux), and subsystem ports the active variant does not provide produce diagnostics; invalid or incomplete simulations do not become successful partial plots. The solver still uses 6,000 output intervals and a 120-second wall-clock timeout; a longer horizon is not a guarantee of adequate event resolution or completion. Full-model agent planning retains a separate 60-second bound.

### Problems

The dock under the canvas has a **Problems** tab. Open or collapse it from the status bar summary ("No problems", or a count of errors and warnings), from its header, or with ⌘/Ctrl+J. Drag its top edge (or focus it and use the arrow keys) to resize it; its height and open tab are remembered in this browser. It is hidden in very narrow windows, where the status bar counts remain.

- **Model checks** update while you edit: unconnected signal inputs, drawing-only blocks, wires that end on a missing port (errors), and blocks with nothing connected (notes) on the open sheet, plus variant problems anywhere in the model. They mirror what Run rejects before simulating; Run also checks every sheet.
- **Last run** appears when a run fails. The dock opens automatically and the workspace stays where it is. Each row has a source (Validation, Safety, Compiler, Runtime, Engine) and chips for the blocks or ports it concerns. Click a row or chip to select those blocks and center them on the canvas. Expand a row (▸, or Space on a focused row) for the hint and the full solver text. After you change the model, this section is marked stale and no longer counts toward the totals.
- **Run warnings** lists solver warnings from a successful run.

Up/Down moves between rows and Enter selects. **Copy** copies every problem as text. When there are errors or warnings, **Explain** asks the AI provider what is wrong, and **Fix with AI** also asks for a checked fix; the ✦ button on a row asks about that problem only. These are explicit requests: a failed run never calls a provider by itself. Answers appear in the Assistant tab as a diagnosis (likely causes with block chips and steps you can take) and, for a fix, a proposal you review and apply like any other assistant edit. If no safe automatic fix exists, the diagnosis says so. Block mapping for solver messages is best effort; the expandable text is always the complete output. The Results tab still shows the raw failure text.

After a successful run, the workspace automatically switches to the **Results** tab (also called Data Inspector), which provides a dedicated view for inspecting simulation output. Switch between **Diagram** and **Results** tabs using the workspace tabs in the toolbar, or press ⌘/Ctrl+1 for Diagram and ⌘/Ctrl+2 for Results.

In Results view, choose a preset plot or available signal, optionally overlay a second series, and select a time window. **Fit Y** fits the displayed range. The buck template's **Last 1 ms** view reveals switching ripple. Download CSV when you need every output row; the interactive preview is reduced for responsiveness.

Moving blocks or labels does not invalidate simulation behavior. Changing equations, connections, parameters, or duration does. Reopened results must match the saved document and emitted source. A stale result is not evidence of the edited model's behavior.

## Ask for a component or export

Choose a provider in **Settings → AI**: sign in to Gradara AI (20 free credits, then prepaid packs), paste your own OpenAI or Anthropic key, use the Codex CLI, or turn AI off. [AI feature setup](AGENT_SETUP.md) explains each option. Simulation never needs an AI provider.

Describe the inputs, outputs, state, and timing you want, for example: “A first-order low-pass filter with a 50 ms time constant.” First choose the block type: Signal / control, Electrical, Mechanical · rotational, Mechanical · translational, Magnetic, Thermal, or Multiple physical domains. Generated blocks use real-valued signal ports; they cannot have Boolean or 3-phase ports. For example, choose Electrical and ask for an ideal transformer to get physical winding terminals rather than signal inputs and outputs. The preview identifies each terminal domain. Refining a block preserves its type and existing terminal interface. It validates and compiler-checks a candidate before insertion. Ordinary editing and simulation still work when the agent is unavailable.

For C code, open **Export**. Under **C code**, the **Unit** list offers the selected blocks (or the selected subsystem), the controller Gradara detected on the open sheet, and each subsystem on it. The detected controller is the group of connected signal blocks between the plant's sensors and actuators, together with constants that only feed it; a group holding a block such as **PI controller** wins. Choose the discretization for continuous blocks (Tustin, backward Euler, or forward Euler), `double` or `float`, the step (empty uses the fastest sample period), and a name for the files. The preview updates as you change them: a header with `In`, `Out`, `Params`, and `State` structs and `init`/`step` functions, the source, and a README. **Show** selects the unit's blocks. **Download .zip** saves the three files.

If the unit contains a physical block, an algebraic loop, or a block without a C template, the dialog says so and **Show** selects the blocks involved. For a custom AI block, it offers to write a C template for that block with your AI provider. The template is checked, compiled, and saved with the block (every block of that kind on the sheet), so later exports use it without AI; editing the block's equations or ports makes it stale, and the dialog offers a new one.

**Verify against last run** compiles the code and feeds it the input signals your last run recorded, step by step, then compares its outputs with the simulation. It needs a run of the current model. Sampled controllers match to rounding error; continuous ones differ by their discretization, and a difference beyond 2% of an output's range fails the check. Verification is open-loop and does not replace testing on the target. The [Servo position example](examples/SERVO.md) walks through it. HDL export remains future work.

See [data handling](../SECURITY.md) before sending proprietary equations or model information to an agent provider.

### Reuse AI blocks

Successfully generated and compiler-checked blocks are automatically saved to **Library → AI blocks**, even before you add them to a diagram. Search, click, or drag them into any model; the dangling-wire picker also offers compatible AI blocks. The block design catalog has the same AI collection. Each insertion is an independent copy. Refinements create new library entries when the definition changes, without updating other models. Identical definitions are deduplicated. Existing generated blocks in saved models are imported once and labeled **From saved model**, rather than claiming a fresh compiler check. This library is local to your workspace, not a public marketplace.

### Data Inspector navigation and signal logging

Select a wire and choose **Log signal** in the wire toolbar, or enable **Log to Data Inspector** in its net properties. A dot beside the net name indicates logging. Run again to capture the signal. Only signal/control nets can be logged: use a voltage, current, speed, or other sensor to choose a physical quantity, then log its signal output. A physical connection itself cannot be logged. Existing automatically captured block outputs remain available for compatibility and are distinct from the **Logged nets only** filter.

In Results, choose one plot, two stacked, two side by side, a 2×2 grid, or a 3×2 grid. Select a plot with its header or canvas, then check signals in the left panel; you can also drag a signal directly onto any plot. The same signal can appear in multiple plots. Removing a signal or clearing a plot changes only the view. Layout changes retain assignments for temporarily hidden plots.

Use **Pan**, **Box zoom**, or **Cursor**, with **X only**, **Y only**, or **X + Y** axes. The mouse wheel zooms around the pointer; plus/minus zoom around the center. Link X axes to keep plots synchronized in time while their Y ranges remain independent. **Fit X**, **Fit Y**, and **Fit both** reset the selected ranges; double-click or Home fits both. Arrow keys pan a focused plot. Maximize a plot to inspect it alone, then restore the layout. Cursor values report saved samples (the last sample at or before the selected time), preserving pre/post-event discontinuities rather than inventing interpolated values.

The inspector loads full stored CSV samples, retaining repeated event times. If that request fails, it explicitly shows the reduced preview and offers Retry. CSV export retains the complete run. Plot layout, signal assignments, and axis ranges are saved locally in this browser per model; they do not change the simulation or get embedded in exported model documents. Signals unavailable in a later run remain identified rather than being silently replaced. Different units on one plot share a numeric Y axis; use separate plots when their scales differ.

## Edit the open model with the assistant

Open the **Assistant** tab in the dock and describe a change, for example "Add a scope on the measured angle and connect it" or "Increase the controller gain by 20%". ⌘/Ctrl+Enter sends. With blocks selected, choose **Selection** to tell the assistant which blocks the request concerns, or **Whole model**.

The assistant can add catalog blocks, create up to two new blocks, rewrite the equations of existing blocks (their ports stay the same), remove or rename blocks, change parameters and the stop time, and connect or disconnect ports. It returns a proposal instead of changing the model. The proposal lists what it adds, removes, changes, and rewires, with chips that select the blocks involved. A badge says whether the edited model was checked in OpenModelica; if the check failed after one automatic revision, the proposal is marked **Not verified** and shows the diagnostics.

Nothing changes until you choose **Apply**. The whole proposal is one undo step, and existing routes, labels, and net names are kept. Added blocks are placed next to related blocks; you may want to move them. If you edit the model after asking, Apply is disabled and you are asked to try again. **Refine** starts a follow-up request; **Discard** dismisses the proposal. The thread belongs to the open model, is cleared when you switch models, and is not saved. Cancel stops a request that is still running.

## Ask an agent for a complete model

Open **Ask agent**, choose **Full model / circuit**, and describe the system, inputs, component values, measurements, and simulation duration. This creates a separate model; it does not modify the open diagram.

The builder inspects the built-in catalog and your local AI block library. It reuses suitable components, creates missing components through the typed block creator, waits for their Modelica checks and library saves, then assembles the circuit. The complete draft must finish an OpenModelica simulation before it is offered for opening. Progress reports the current stage. Close the creator to cancel.

Review the diagram, library choices, and assumptions, then choose **Open as new model**. Your current model is saved before switching. The new model uses normal editable blocks and wires. Click **Run** to capture results under the new saved model's identity in Data Inspector. The builder's trial run is a separate validation snapshot.

Currently the builder supports flat models with up to 80 instances and four newly created component types per request. Supported domains match the block creator: scalar signals, electrical, rotational and translational mechanical, magnetic, thermal, and their couplings, plus the built-in library blocks. The builder does not create subsystems. Unsupported domains are reported instead of substituted. A simulation failure gets one assembly repair; unresolved diagnostics remain visible. Missing blocks that completed successfully remain in the AI library even if later assembly fails or is cancelled. Generation is not resumable after closing the creator or restarting the service.

## Built-in examples

**Examples → EV drivetrain** opens a battery electric vehicle built from nested subsystems: vehicle control and powertrain at the top, battery pack and motor drive inside the powertrain, and a converter inside the motor drive. The battery (LFP or NMC) and the motor (PM DC machine or simple DC motor) are variants, and two configurations switch them together. The [EV example guide](examples/EV.md) describes each level.

**Examples → Servo position** opens a DC motor position loop with a 1 kHz **Discrete PID** and an **Angle sensor**. It is built to export its controller to C. The [servo example guide](examples/SERVO.md) walks through the export and explains how the repository's reference C is checked against the simulation.

**Examples → 480 VAC flyback** opens a hand-authored 480 V RMS single-phase to 24 V / 1 A switching model with bridge rectification, magnetizing energy storage, soft start, and PI regulation. See the [flyback example guide](examples/FLYBACK.md) for assumptions, expected signals, and modeling limits.

**Examples → Data center cooling** opens a one-hour electrical–thermal benchmark with workload and cooling-capacity disturbances. Compare temperatures, electricity, and PI recovery using the [cooling example guide](examples/DATACENTER.md). This is a lumped control model, not a detailed facility model.
