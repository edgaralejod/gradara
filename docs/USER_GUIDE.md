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
