# Gradara

An agent-assisted workbench for graphical, multidomain simulation. Build a diagram, ask for a missing equation-based block, and run it with OpenModelica.

Gradara puts the diagram first: responsive orthogonal wiring, recognizable engineering symbols, domain-colored ports, and equations you can inspect. Agents help author components; the Modelica compiler and numerical runtime execute the model.

**Status: early working prototype.** The local macOS workflow has been exercised end to end. Linux and Windows support are development targets, not certified distributions. There are no desktop installers yet. MATLAB script compatibility is outside scope.

Created by **Edgar Duarte**. Engineering consulting through **[Virtu Services](https://virtu-services.us)**.

[Get started](docs/development/SETUP.md) · [Documentation](docs/README.md) · [Contribute](CONTRIBUTING.md) · [Agent instructions](AGENTS.md) · [Roadmap](ROADMAP.md)

Source: **[edgaralejod/gradara on GitHub](https://github.com/edgaralejod/gradara)** · [Report an issue](https://github.com/edgaralejod/gradara/issues) · Apache-2.0 licensed.

## Try it locally

Install **Node.js 22.13+**, **Python 3.12**, and a working **Docker** runtime. On macOS, the launcher supports Colima; for Docker Desktop, set the context as described in the setup guide. Clone the repository and start the workbench:

```sh
git clone https://github.com/edgaralejod/gradara.git
cd gradara
npm ci
python3 -m venv .venv
.venv/bin/python -m pip install -r server/requirements-dev.txt
.venv/bin/python scripts/start.py
```

Open **[localhost:4317](http://localhost:4317)**. The first start builds the OpenModelica image and downloads its standard library; allow several minutes and network access. Later simulations run locally. On macOS, **Start Gradara.command** also launches an installed checkout.

No AI account is needed to edit existing blocks, wire models, or simulate. Component generation and controller C generation optionally use your own installed, signed-in Codex CLI. Follow [AI feature setup](docs/AGENT_SETUP.md) for account connection, the first generated block, and current limitations. See [setup and platform notes](docs/development/SETUP.md) for Windows/WSL, frontend-only development, environment variables, and separate service startup.

## Start with a model

A fresh workspace opens with one empty **Untitled model**. Click its title to rename it, **New model** for another blank document, or **Examples** to create an independent copy of a built-in model. New documents receive unique names.

| Starting point | What to explore |
| --- | --- |
| Blank model | Add blocks from the library, connect ports, set parameters, and run. |
| [DC motor control](models/DC.md) | A sampled PI controller, electrical motor, rotational load, and speed feedback. |
| [AC motor · FOC](models/FOC.md) | PMSM field-oriented control, d/q transforms, current loops, and an averaged inverter. |
| [Buck converter](models/BUCK.md) | A 24 V to 12 V synchronous converter with actual ideal switches; inspect switching ripple with **Last 1 ms**. |

**Models** opens a searchable browser with **My models**, **Examples**, and recoverable **Trash**. Saved rows show block counts and last-save times. **Save a copy** preserves the original; **Import file** always creates a separate document with a unique name. Export a `.gradara.json` file to share a model. Original `.flux.json` files remain supported.

The repository includes only the curated example templates. Personal models, Trash, simulation runs, and generated artifacts are local data excluded from Git.

## What works today

- Orthogonal wires with snapping, branching onto existing wires, junctions, reconnecting, segment editing, redraw, and undo. Nets have stable IDs and readable automatic or custom names.
- A shared block design system, searchable library, model inspector, resize handles, movable labels, selection tools, and Ctrl-drag duplication.
- Signal/control components alongside electrical and rotational mechanical components. Physical ports can cross block domains through explicit sensors and actuators.
- Asynchronous OpenModelica simulation, cancellation, diagnostics, saved runs, plots, and complete CSV downloads.
- Agent-created scalar signal blocks with algebraic equations, continuous state, or sampled updates; optional Monaco equation editing.
- Modelica source export, portable project export, and agent-generated, compile-checked C11 for **one controller block**.

Drawing, dragging, and routing stay in the browser. The FastAPI service saves project documents and supervises isolated OpenModelica jobs. The authoring representation is currently **Gradara JSON**; Modelica is generated from it. Editing an exported `.mo` file does not update the canvas.

## Controls

Drag between ports, or click a port and then its destination. Drop on wire ink to join a net. Select a wire to reshape it; **D** redraws and **R** restores automatic routing. **Escape** cancels a gesture. Drag a block's name to reposition its label.

Drag empty canvas to select. Pan with the middle/right mouse button or Space. **F** fits the model; **⌘/Ctrl+Z** undoes; **⌘/Ctrl+D** duplicates. The in-app Shortcuts dialog lists more gestures. See the [user guide](docs/USER_GUIDE.md) and [wiring contract](docs/architecture/WIRING.md).

## Boundaries

This is a trusted, single-user local application. **Do not expose the Python service to a public network.** It has no authentication or multi-user authorization. Model files, run data, prompts, and generated artifacts live in the ignored `projects/` directory. See [security and data handling](SECURITY.md).

Hierarchical subsystems, vector/bus execution, arbitrary Modelica import and round trips, general solver interchangeability, FMI, remote execution, and HDL generation are future work. Mux/demux and subsystem placeholders are visible but report their simulation limitations. C compilation does not establish behavioral equivalence or target-hardware correctness. The [roadmap](ROADMAP.md) describes bounded opportunities to help.

## Develop and contribute

```sh
npm run typecheck
npm test
npm audit --audit-level=high
.venv/bin/python -m pytest -q -m "not integration"
python3 scripts/check-docs.py
python3 scripts/check-repo.py
npm run build
```

Real-engine tests additionally require the Docker image; see [testing](docs/development/TESTING.md). Whole-repository lint currently has a recorded backlog and is advisory in CI. Follow [CONTRIBUTING.md](CONTRIBUTING.md); agents should start with [AGENTS.md](AGENTS.md) and the [task playbooks](docs/agents/PLAYBOOKS.md).

## Creator and engineering services

Gradara is created and maintained by **Edgar Duarte**, exploring how responsive graphical tools and agent-assisted authoring can make engineering models easier to build and understand.

For paid work in FPGA/RTL, embedded systems, connected products, engineering software, or business automation, visit **[Virtu Services](https://virtu-services.us)** to discuss a project. Consulting is optional; using or contributing to Gradara does not require a services engagement.

## License

Copyright 2026 Edgar Duarte and the Gradara contributors.

Gradara's original source code, documentation, and bundled example models are licensed under the **[Apache License, Version 2.0](LICENSE)**. You may use, modify, and distribute them, including commercially, subject to that license. They are provided without warranties. See [NOTICE](NOTICE) for attribution.

Third-party material retains its own terms; see [third-party notices](THIRD_PARTY_NOTICES.md) and `LICENSES/`. OpenModelica's compiler/runtime and the Modelica Standard Library are separately licensed. This license does not change ownership of models you create or grant trademark rights beyond those stated in Apache-2.0.

Gradara is an independent project and is not affiliated with or endorsed by MathWorks. MATLAB and Simulink are referenced as compatibility or usability context, not as project components.
