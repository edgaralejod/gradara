# Modeling with Gradara

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

Click a library component to insert it, or invoke the agent from a selected location or dangling connection. Select a component to edit its parameters in the inspector. Double-click a signal block to inspect or edit equations in Monaco. Built-in physical implementations use canonical Modelica wrappers; their displayed equations explain behavior.

Blocks get readable unique names such as Step, Step1, and Step2. IDs remain stable when names change. Drag a block label separately from the symbol; double-click the label to restore its default location. Resize using selection handles, or choose **Use standard size** in the inspector. The library, canvas, and [block catalog](http://localhost:4317/block-catalog) share the same visual design.

Port colors show the connector's domain, which can differ from its block's main domain. An actuator or sensor can have both a physical connector and a signal port. Signal wires connect an output to inputs; physical wires join compatible physical connectors. Crossing lines alone do not create a connection.

## Wire and arrange

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

The model inspector exposes blocks and logical nets. Nets receive stable IDs plus automatic names derived from their connection. Give a net a custom name when the engineering meaning is clearer than the default; its label and identity belong to the connected net, not each drawn segment.

## Simulate and inspect

Set the stop time and press **Run**. Compilation and simulation happen asynchronously. You can cancel from the run controls. Unconnected signal inputs and unsupported executable placeholders produce diagnostics; invalid or incomplete simulations do not become successful partial plots.

After a successful run, the workspace automatically switches to the **Results** tab (also called Data Inspector), which provides a dedicated view for inspecting simulation output. Switch between **Diagram** and **Results** tabs using the workspace tabs in the toolbar, or press ⌘/Ctrl+1 for Diagram and ⌘/Ctrl+2 for Results.

In Results view, choose a preset plot or available signal, optionally overlay a second series, and select a time window. **Fit Y** fits the displayed range. The buck template's **Last 1 ms** view reveals switching ripple. Download CSV when you need every output row; the interactive preview is reduced for responsiveness.

Moving blocks or labels does not invalidate simulation behavior. Changing equations, connections, parameters, or duration does. Reopened results must match the saved document and emitted source. A stale result is not evidence of the edited model's behavior.

## Ask for a component or export

Follow [AI feature setup](AGENT_SETUP.md) to connect your own Codex CLI account. A hosted Gradara account or Cursor installation is not required.

Describe the inputs, outputs, state, and timing you want, for example: “A first-order low-pass filter with a 50 ms time constant.” First choose the block type: Signal / control, Electrical, Mechanical (rotational), Thermal, or Multiple physical domains. For example, choose Electrical and ask for an ideal transformer to get physical winding terminals rather than signal inputs and outputs. The preview identifies each terminal domain. Refining a block preserves its type and existing terminal interface. It validates and compiler-checks a candidate before insertion. Ordinary editing and simulation still work when the agent is unavailable.

For generated C, select one block marked as a controller and use **Export**. The package includes a header, source, original contract, and timing/integration notes. Review the chosen discretization and validate behavior for your application. Whole-subsystem and HDL exports remain future work.

See [data handling](../SECURITY.md) before sending proprietary equations or model information to an agent provider.

### Reuse AI blocks

Successfully generated and compiler-checked blocks are automatically saved to **Library → AI blocks**, even before you add them to a diagram. Search, click, or drag them into any model; the dangling-wire picker also offers compatible AI blocks. The block design catalog has the same AI collection. Each insertion is an independent copy. Refinements create new library entries when the definition changes, without updating other models. Identical definitions are deduplicated. Existing generated blocks in saved models are imported once and labeled **From saved model**, rather than claiming a fresh compiler check. This library is local to your workspace, not a public marketplace.

### Data Inspector navigation and signal logging

Select a wire and choose **Log signal** in the wire toolbar, or enable **Log to Data Inspector** in its net properties. A dot beside the net name indicates logging. Run again to capture the signal. Only signal/control nets can be logged: use a voltage, current, speed, or other sensor to choose a physical quantity, then log its signal output. A physical connection itself cannot be logged. Existing automatically captured block outputs remain available for compatibility and are distinct from the **Logged nets only** filter.

In Results, choose one plot, two stacked, two side by side, a 2×2 grid, or a 3×2 grid. Select a plot with its header or canvas, then check signals in the left panel; you can also drag a signal directly onto any plot. The same signal can appear in multiple plots. Removing a signal or clearing a plot changes only the view. Layout changes retain assignments for temporarily hidden plots.

Use **Pan**, **Box zoom**, or **Cursor**, with **X only**, **Y only**, or **X + Y** axes. The mouse wheel zooms around the pointer; plus/minus zoom around the center. Link X axes to keep plots synchronized in time while their Y ranges remain independent. **Fit X**, **Fit Y**, and **Fit both** reset the selected ranges; double-click or Home fits both. Arrow keys pan a focused plot. Maximize a plot to inspect it alone, then restore the layout. Cursor values report saved samples (the last sample at or before the selected time), preserving pre/post-event discontinuities rather than inventing interpolated values.

The inspector loads full stored CSV samples, retaining repeated event times. If that request fails, it explicitly shows the reduced preview and offers Retry. CSV export retains the complete run. Plot layout, signal assignments, and axis ranges are saved locally in this browser per model; they do not change the simulation or get embedded in exported model documents. Signals unavailable in a later run remain identified rather than being silently replaced. Different units on one plot share a numeric Y axis; use separate plots when their scales differ.

## Ask an agent for a complete model

Open **Ask agent**, choose **Full model / circuit**, and describe the system, inputs, component values, measurements, and simulation duration. This creates a separate model; it does not modify the open diagram.

The builder inspects the built-in catalog and your local AI block library. It reuses suitable components, creates missing components through the typed block creator, waits for their Modelica checks and library saves, then assembles the circuit. The complete draft must finish an OpenModelica simulation before it is offered for opening. Progress reports the current stage. Close the creator to cancel.

Review the diagram, library choices, and assumptions, then choose **Open as new model**. Your current model is saved before switching. The new model uses normal editable blocks and wires. Click **Run** to capture results under the new saved model's identity in Data Inspector. The builder's trial run is a separate validation snapshot.

Currently the builder supports flat models with up to 80 instances and four newly created component types per request. Supported domains match the block creator: scalar signals, electrical, rotational mechanical, thermal, and their couplings. Unsupported domains are reported instead of substituted. A simulation failure gets one assembly repair; unresolved diagnostics remain visible. Missing blocks that completed successfully remain in the AI library even if later assembly fails or is cancelled. Generation is not resumable after closing the creator or restarting the service.

## Flyback power-supply example

**Examples → 480 VAC flyback** opens a hand-authored 480 V RMS single-phase to 24 V / 1 A switching model with bridge rectification, magnetizing energy storage, soft start, and PI regulation. See the [flyback example guide](examples/FLYBACK.md) for assumptions, expected signals, and modeling limits.
