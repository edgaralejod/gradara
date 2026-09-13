# Gradara

A local multidomain modeling workbench. Build and edit a connected motor-control diagram, ask an agent for a new equation-based component, run OpenModelica, and inspect the results.

## Open it

On this Mac, double-click **Start Gradara.command**. The workspace opens at **http://localhost:4317**. If it is already running, the launcher opens the existing workspace.

To stop the background launcher, run `.venv/bin/python scripts/stop.py`. The local Colima virtual machine can separately be stopped with `colima stop --profile gradara` when it is no longer needed. If this machine still uses the earlier engine VM, the profile name is `flux`.

## First things to try

- Choose **AC motor · Field-oriented control** in the example selector. Run the PMSM with cascaded speed and current loops, an averaged inverter, and a mechanical load step. Explore the **d/q currents**, **Phase currents**, and **Torque** plots. See [the FOC example notes](models/FOC.md) for its assumptions.
- The canvas uses engineering notation: triangular gains, round summing junctions, transfer functions, and domain-colored physical blocks. Select a block and drag a corner to resize it; names remain outside the block.

- Click **Run**. The default model simulates a 100 rad/s speed request with a 24 V limited PI controller, electrical motor dynamics, rotational inertia, and shaft feedback.
- Select **Speed reference**, change **Target speed** to 60, then run again. Click the Speed, Current, and Drive voltage plot tabs.
- Press **A**, ask for “A first-order low-pass filter with a 50 ms time constant,” and insert the generated component. Connect it into a signal path; select the old wire and drag its round end to reconnect it.
- Drag from a signal port into empty canvas to create and automatically connect a new component.
- Select a signal component and click **Refine with agent**. Compatible port identities and connections are preserved.
- Double-click a signal block to edit equations and internal state in Monaco.
- Select **Export** for a complete Modelica model, a portable Gradara project, or agent-generated C for a controller block. C packages include a header, source, original controller contract, and integration notes.

Drag blocks to arrange them. Drag the blank canvas to select a region. Pan with the middle/right mouse button or hold Space; zoom with the trackpad/wheel. **F** fits the model; **⌘/Ctrl+Z** undoes; **⌘/Ctrl+D** duplicates; **Delete** removes the selection. The Shortcuts button lists the rest.

## What runs where

The React/TypeScript workbench runs locally through Vite/Vinext. FastAPI supervises immutable OpenModelica jobs. OpenModelica 1.27.0 and Modelica Standard Library 4.1 run inside a dedicated local container, as an unprivileged user with networking disabled during simulation. On this Mac, that container runs in a dedicated Colima profile named `gradara` (or an existing `flux` profile from earlier installs).

The diagram's physical connectors produce Modelica `connect` equations. There is no JavaScript physics approximation or LLM interpreting a model during simulation. The first physical palette covers a voltage drive, motor, inertia/load, ground, and speed sensor, alongside signal/control blocks.

The agent uses the installed Codex CLI and its existing ChatGPT sign-in. Generation can take tens of seconds and requires connectivity. Each request returns a bounded component definition, is checked by OpenModelica, and becomes saved source. It does not execute project-editing commands. If Codex is unavailable, ordinary editing and simulation still work.

DC and AC diagrams are saved separately in `projects/examples/`; switching examples preserves their edits. The active project data is saved in `projects/workspace.json`, with executable source in `projects/workspace.mo`. Run snapshots, complete CSV results, generated component responses, and exports stay under `projects/`. Plot previews are reduced in size; CSV downloads retain every output sample. The `.gradara.json` export can be reopened with the upload button.

The original `.flux.json` project files still open as Gradara projects. `GRADARA_DOCKER_CONTEXT` and `GRADARA_CODEX_BIN` are the current environment variables; the earlier `FLUX_*` names remain aliases. An existing `flux-engine:1.27.0` image is retagged as `gradara-engine:1.27.0` on first launch.

## Current boundaries

This is the first functional desktop-browser demo. Agent-created components currently have scalar signal inputs/outputs and optional continuous/discrete state. Physical library components expose parameters and inspected equations. The C exporter operates on one controller block, with explicit state and timing in its contract; compiled C has not been tested on target hardware. Hierarchical subsystems, HDL generation, arbitrary Modelica import, collaborative editing, full library browsing, binary caching, and Electron installers remain future work.

The editable project graph is the current authoring representation; each save and run produces Modelica source. Editing a `.mo` file externally does not yet update the canvas. That source round trip is an explicit next architecture milestone. UI positions are excluded from simulation identity, so rearranging the diagram keeps existing results current.

Orthogonal nets, pin-exit drawing, snap anchors, T-junctions, and feedback U-paths are specified in [WIRING.md](WIRING.md). That document is the product spec for the next wiring pass; live canvas drawing is not yet at that bar.

## Developer setup

Requirements: Node.js 22.13+, Python 3.11+, Docker, and optionally the Codex CLI signed in for component generation. macOS uses Colima by default; Linux and Windows can use their Docker runtime.

```sh
npm install
python3 -m venv .venv
.venv/bin/pip install -r server/requirements.txt
python3 scripts/start.py
```

On Windows, use `.venv\Scripts\python` and `.venv\Scripts\pip` instead. `scripts/start.py` uses the correct interpreter path. Set `GRADARA_DOCKER_CONTEXT` to choose another Docker context, or `GRADARA_CODEX_BIN` for a custom Codex executable. The launcher builds the local engine image if missing; package installation requires network access. The running service reads environment variables directly.

For separate development sessions:

```sh
.venv/bin/python -m uvicorn server.app:app --host 127.0.0.1 --port 8765 --reload --reload-dir server
npm run dev -- --port 4317
```

`npm run build` builds the web application. `npm run typecheck` checks TypeScript; `npm test` exercises editing operations; `npm run engine:test` exercises contracts and real simulations (install pytest first). Browser interaction QA is separate from these checks.

The prototype exposes optional WebMCP tools for reading the model and editing a parameter when the browser supports that API. Those tools use the same model commands. They have been exercised through the in-app browser during interaction QA.

## Structure

- `app/`: working surface, styles, and application metadata.
- `components/gradara/`: diagram nodes, inline agent UI, results, source editor, and export UI.
- `lib/gradara/`: model contract, shared editing operations, and application-service client.
- `server/`: project persistence, Modelica packaging, numerical job supervision, agent integration, and controller export.
- `models/`: initial example source.
- `tests/`: editing and engine integration checks.
- `ARCHITECTURE.md`: product direction and intended growth boundaries.

OpenModelica and the standard library retain their own licenses. See the architecture document's upstream references before distributing a packaged engine.

### Wiring playground

Choose **Wiring playground** from Examples to try the net editor on a running feedback controller.

- **Draw:** drag between ports, or click a port and then its destination. Drop on existing wire ink to join that net. Release in empty space and click to pin bends.
- **Reshape:** select a wire, then drag a segment or its midpoint grip. Even a straight connection can become a dogleg. Square handles move corners; round end handles reconnect either endpoint to a port or wire.
- **Redraw:** select a wire and press **D**, or use the on-canvas **Redraw** button. Click to place bends, then click the highlighted destination or press **Enter**. A ghost of the old route remains visible until you finish.
- **Branch:** drag an unselected wire, or **Alt-drag** any wire. Click a junction to branch, drag it to move, or Alt-drag to branch directly.
- **Recover:** **Backspace** unpins; **Escape** cancels the entire edit. **R** restores automatic routing. Each completed gesture is one undo step.

The interaction contract and implementation notes live in [WIRING.md](WIRING.md).
