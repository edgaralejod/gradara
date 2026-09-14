# Modeling with Gradara

## Create, save, and share

Use **New model** to start blank or copy a template. Choose a descriptive name. The model selector opens saved documents; choosing a template again makes another document instead of replacing previous work.

Edits autosave through the local service. Keep it running and watch connection/save errors. The current implementation assumes one active editing client; two browser sessions editing the same document do not have conflict resolution. Undo history belongs to the current browser session.

Use **Export** for a portable `.gradara.json` file or generated Modelica source. The upload button opens a project file. Modelica import is not implemented. Export before experimenting with a valuable model, and back up `projects/` for the full local history of documents and run artifacts.

## Build a diagram

Click a library component to insert it, or invoke the agent from a selected location or dangling signal connection. Select a component to edit its parameters in the inspector. Double-click a signal block to inspect or edit equations in Monaco. Built-in physical implementations use canonical Modelica wrappers; their displayed equations explain behavior.

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

Nearby parallel segments snap together and shed redundant bends. Junctions should follow their horizontal run as connected blocks move. One completed gesture should be one undo step. Report a minimal reproduction when a gesture behaves differently; the [wiring audit](../WIRING_AUDIT.md) is the acceptance reference.

The model inspector exposes blocks and logical nets. Nets receive stable IDs plus automatic names derived from their connection. Give a net a custom name when the engineering meaning is clearer than the default; its label and identity belong to the connected net, not each drawn segment.

## Simulate and inspect

Set the stop time and press **Run**. Compilation and simulation happen asynchronously. You can cancel from the run controls. Unconnected signal inputs and unsupported executable placeholders produce diagnostics; invalid or incomplete simulations do not become successful partial plots.

Choose a preset plot or available signal, optionally overlay a second series, and select a time window. **Fit Y** fits the displayed range. The buck template's **Last 1 ms** view reveals switching ripple. Download CSV when you need every output row; the interactive preview is reduced for responsiveness.

Moving blocks or labels does not invalidate simulation behavior. Changing equations, connections, parameters, or duration does. Reopened results must match the saved document and emitted source. A stale result is not evidence of the edited model's behavior.

## Ask for a component or export

Follow [AI feature setup](AGENT_SETUP.md) to connect your own Codex CLI account. A hosted Gradara account or Cursor installation is not required.

Describe the inputs, outputs, state, and timing you want, for example: “A first-order low-pass filter with a 50 ms time constant.” The current generator supports scalar signal ports. It validates and compiler-checks a candidate before insertion. Ordinary editing and simulation still work when the agent is unavailable.

For generated C, select one block marked as a controller and use **Export**. The package includes a header, source, original contract, and timing/integration notes. Review the chosen discretization and validate behavior for your application. Whole-subsystem and HDL exports remain future work.

See [data handling](../SECURITY.md) before sending proprietary equations or model information to an agent provider.
