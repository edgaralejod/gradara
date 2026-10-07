# Gradara

An agent-assisted workbench for graphical, multidomain simulation. Build a diagram, ask for a missing equation-based block, and run it with OpenModelica.

Gradara puts the diagram first: responsive orthogonal wiring, recognizable engineering symbols, domain-colored ports, and equations you can inspect. Agents help author components; the Modelica compiler and numerical runtime execute the model.

**Status: early release.** Desktop apps are available for Windows, macOS, and Linux. Every installer is built, installed on a clean machine, and run automatically, including a simulation on Windows, macOS Intel, and Ubuntu; the Apple silicon simulation is checked by hand for each release (see [supported platforms](docs/PLATFORMS.md)). Please report problems on your system. Gradara does not run MATLAB scripts or open Simulink files.

Gradara is not certified for safety-critical use; verify results independently. [Validation](docs/VALIDATION.md) shows its results next to closed-form answers.

Created by **Edgar Duarte**. Published by **Virtu Services LLC**. Engineering consulting through **[Virtu Services](https://virtu-services.us)**.

[Get started](docs/INSTALL.md) · [User guide](docs/USER_GUIDE.md) · [FAQ](docs/FAQ.md) · [Documentation](docs/README.md) · [Developer setup](docs/development/SETUP.md) · [Contribute](CONTRIBUTING.md) · [Roadmap](ROADMAP.md)

Source: **[edgaralejod/gradara on GitHub](https://github.com/edgaralejod/gradara)** · [Report an issue](https://github.com/edgaralejod/gradara/issues) · Apache-2.0 licensed.

## Install

Download the installer for your computer from **[gradara.app](https://gradara.app/)** or the [latest GitHub release](https://github.com/edgaralejod/gradara/releases/latest): Windows (`.exe`), macOS (`.dmg`, Apple silicon or Intel), or Linux (`.AppImage` or `.deb`). The [install guide](docs/INSTALL.md) walks through each system.

Each installer includes the simulation engine (OpenModelica 1.27.1 with the Modelica Standard Library 4.1.0), so there is nothing else to install: no OpenModelica download, no Docker. On macOS the engine runs in a small virtual machine built into the app. Then follow [your first 10 minutes](docs/USER_GUIDE.md#your-first-10-minutes).

AI features are optional. Choose **Gradara AI** (sign in, 20 free credits, then prepaid packs), your own OpenAI or Anthropic API key, or turn AI off in **Settings → AI**. See [AI features](docs/AGENT_SETUP.md) and [privacy](docs/PRIVACY.md).

## Run from source

Install **Node.js 22.13+**, **Python 3.12**, and either OpenModelica or a working **Docker** runtime. Clone the repository and start the workbench:

```sh
git clone https://github.com/edgaralejod/gradara.git
cd gradara
npm ci
python3 -m venv .venv
.venv/bin/python -m pip install -r server/requirements-dev.txt
.venv/bin/python scripts/start.py
```

Open **[localhost:4317](http://localhost:4317)**. With Docker, the first start builds the OpenModelica image; allow several minutes and network access. On macOS, double-clicking **Start Gradara.command** launches this checkout the same way. See the [developer setup](docs/development/SETUP.md) for the desktop build, engine choices, and separate service startup.

## Start with a model

A fresh workspace opens with one empty **Untitled model**. Click its title to rename it, choose **New model** for another blank model, or **Examples** to save your own copy of a built-in model.

| Starting point | What to explore |
| --- | --- |
| Blank model | Add blocks from the library, connect ports, set parameters, and run. |
| [DC motor control](models/DC.md) | A sampled PI controller, electrical motor, rotational load, and speed feedback. |
| [EV drivetrain](docs/examples/EV.md) | Battery, averaged converter, motor, and vehicle in three levels of subsystems, with battery-chemistry and motor-type variants and two configurations. |
| [Servo position control](docs/examples/SERVO.md) | A 1 kHz sampled PID position loop on a DC motor, built to export its controller to C and compare it with the simulation. |
| [AC motor · FOC](models/FOC.md) | PMSM field-oriented control, d/q transforms, current loops, and an averaged inverter. |
| [Buck converter](models/BUCK.md) | A 24 V to 12 V synchronous converter with actual ideal switches; inspect switching ripple with **Last 1 ms**. |
| [480 VAC flyback](docs/examples/FLYBACK.md) | Bridge rectification, magnetizing energy storage, and 50 kHz switching to 24 V / 1 A. |
| [Data center cooling](docs/examples/DATACENTER.md) | A one-hour lumped electrical–thermal PI benchmark with load and cooling-capacity disturbances. |

**Models** opens a searchable browser with **My models**, **Examples**, **Block examples** (a small runnable model for every library block), and **Trash**. **Save a copy** keeps the original; **Import file** always creates a separate model. Export a `.gradara.json` file to share a model.

Your models, results, and settings stay in your data folder on your computer (**Help → Open Data Folder**). The repository includes only the built-in examples.

## What works today

- Orthogonal wires with snapping, branching onto existing wires, junctions, reconnecting, segment editing, redraw, and undo. Nets have stable IDs and readable automatic or custom names.
- A shared block design system, searchable library, model inspector, resize handles, movable labels, selection tools, and Ctrl-drag duplication.
- A library of 217 blocks: signal, Boolean logic, electrical, semiconductor, converter, machine, 3-phase, rotational and translational mechanical, thermal, and magnetic. Most physical blocks are Modelica Standard Library 4.1.0 components. Physical ports can cross block domains through explicit sensors and actuators.
- Hierarchical subsystems: group a selection with ⌘/Ctrl+G, open and navigate nested sheets, share one definition between instances, and promote parameters. Variants keep alternative insides behind one set of ports, and configurations switch them together or run them all for comparison.
- Asynchronous OpenModelica simulation, cancellation, saved runs, plots, and complete CSV downloads. Each model can choose its solver (DASSL, Implicit Runge-Kutta, Backward Euler, or Runge-Kutta 4), tolerance, maximum step, and output interval, with an in-app [guide](docs/SOLVER.md) to what each one does. A Problems dock lists live model checks and block-mapped run diagnostics; click one to select the blocks involved.
- Agent-created signal, electrical, rotational and translational mechanical, magnetic, thermal, and multidomain blocks, with an explicit type selector and real Modelica terminals. A block dialog edits a block's name and parameters, and its equations in Monaco.
- An Assistant that proposes checked edits to the open model and explains or fixes failed runs; every proposal is reviewed and applied as one undo step.
- Modelica source export, portable project export, and C11 code for a controller: a subsystem, the selected signal blocks, or the controller Gradara detects on the sheet. Choose Tustin, backward, or forward Euler for continuous blocks, then check the compiled code against the last run's recorded inputs and outputs.
- Desktop installers with a built-in simulation engine (no setup; a small built-in VM on macOS), automatic updates, and a choice of Gradara AI (20 free credits, then prepaid packs), your own OpenAI or Anthropic key, or no AI.

Drawing, dragging, and routing stay in the workbench. The local FastAPI service saves project documents and supervises OpenModelica jobs on the built-in engine (installed apps), a native OpenModelica install, or the pinned container image. Models are stored as **Gradara JSON**; Modelica is generated from it. Editing an exported `.mo` file does not update the canvas.

## Controls

Drag between ports, or click a port and then its destination. Drop on a wire to join it. Select a wire to reshape it; **D** redraws and **R** restores automatic routing. **Escape** cancels a gesture. Double-click empty canvas to add a block; double-click a block to edit it.

Drag empty canvas to select. Pan with the middle or right mouse button or Space. **F** fits the model; **⌘/Ctrl+Enter** runs; **⌘/Ctrl+Z** undoes. Press **?** in the app for every shortcut, or see the [keyboard shortcuts](docs/USER_GUIDE.md#keyboard-shortcuts) table. Developers: see the [wiring contract](docs/architecture/WIRING.md).

## Boundaries

This is a trusted, single-user local application. **Do not expose the local service to a public network.** It accepts only loopback requests from its own workbench and has no multi-user authorization. Models and runs live in your data folder (`projects/` in a source checkout). See [security](SECURITY.md) and [privacy](docs/PRIVACY.md).

Signal buses (Mux, Demux, Bus Creator, Bus Selector) carry and route several signals on one wire, but element-wise math on a bus is not available yet. Modelica import, FMI, remote simulation, and HDL generation are not available. Checking C code against a simulation does not prove it behaves correctly on your target hardware. Gradara is not certified for safety-critical use; verify results independently. The [roadmap](ROADMAP.md) lists planned work.

## Develop and contribute

```sh
npm run typecheck
npm test
python3 scripts/check-audit.py
.venv/bin/python -m pytest -q -m "not integration"
(cd cloud && ../.venv/bin/python -m pytest -q)   # AI gateway; needs cloud/requirements.txt
python3 scripts/check-docs.py
python3 scripts/check-repo.py
npm run build
```

Real-engine tests additionally require the Docker image or a native OpenModelica install; see [testing](docs/development/TESTING.md). Whole-repository lint currently has a recorded backlog and is advisory in CI. Follow [CONTRIBUTING.md](CONTRIBUTING.md); agents should start with [AGENTS.md](AGENTS.md) and the [task playbooks](docs/agents/PLAYBOOKS.md).

## Creator and engineering services

Gradara is created and maintained by **Edgar Duarte**, exploring how responsive graphical tools and agent-assisted authoring can make engineering models easier to build and understand.

For paid work in FPGA/RTL, embedded systems, connected products, engineering software, or business automation, visit **[Virtu Services](https://virtu-services.us)** to discuss a project. Consulting is optional; using or contributing to Gradara does not require a services engagement.

## License

Copyright 2026 Edgar Duarte and the Gradara contributors.

Gradara's original source code, documentation, and bundled example models are licensed under the **[Apache License, Version 2.0](LICENSE)**. You may use, modify, and distribute them, including commercially, subject to that license. They are provided without warranties. See [NOTICE](NOTICE) for attribution.

Third-party material retains its own terms; see [third-party notices](THIRD_PARTY_NOTICES.md) and `LICENSES/`. OpenModelica's compiler/runtime and the Modelica Standard Library are separately licensed. This license does not change ownership of models you create or grant trademark rights beyond those stated in Apache-2.0.

Gradara is an independent project and is not affiliated with or endorsed by MathWorks. MATLAB and Simulink are referenced as compatibility or usability context, not as project components.
