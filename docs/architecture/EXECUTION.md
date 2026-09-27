# Simulation, agents, and exports

## Run lifecycle

1. The browser submits the current `Project` to `POST /api/runs`.
2. FastAPI/Pydantic validates structure. Empty models fail immediately. The job runner checks unsupported components and required scalar inputs before numerical execution.
3. `server/modelica.py` emits a complete Modelica model from the snapshot. Built-in physical kinds use canonical wrappers; signal and generated physical components use bounded definitions with standard Modelica connectors.
4. `server/engine.py` records the snapshot and source in a unique run directory and runs it on the selected backend: `engine_runner.py` in the engine container, or a generated `.mos` script with the host `omc`.
5. OpenModelica loads MSL, compiles, initializes, and simulates. The adapter requires explicit successful completion, a result file, sufficient coverage, and finite preview data.
6. The service saves a result preview and retains full CSV output. The browser polls the job and renders results or diagnostics.

Failures raise `SimulationFailure` (`server/diagnostics.py`). Its message is the readable text stored as the job `error`; its structured `Diagnostic` list is stored as the job `diagnostics` (see the [job contract](../API.md#job-contract)). Validation and safety problems name their blocks and ports directly. For solver text, `failure_diagnostics` makes one entry per compiler `Error:` line, maps instance IDs that appear as component references, and, for singular linear systems, names the signal blocks on a direct-feedthrough cycle (a block whose equations use `der`, `sample`, `delay`, or `pre` breaks the cycle). Engine start-up failures are `engine` diagnostics. Once a run folder exists, a failure also writes `diagnostics.json` beside `model.mo`, and `GET /api/runs/{runId}/diagnostics` returns it. Successful runs parse solver warnings into `result.problems` and keep the raw `diagnostics` string.

The job registry is in memory. API job statuses are `queued`, `running`, `complete`, `failed`, and `cancelled`. At most four operations are active across simulation/component/export jobs. Engine execution has its own two-slot semaphore. Restarting the service loses job status; it does not delete completed run directories. There is no durable queue or automatic resume.

## Engine supervision

Two backends run the same job folder (`server/engines.py`). The **native** backend drives a host OpenModelica install with a generated `.mos` script; it runs as the user, so definition text is screened by `server/safety.py` first. The **Docker** engine is `gradara-engine:1.27.0`, built from the OpenModelica 1.27.0 OMPython image with MSL 4.1.0. The image runs as an unprivileged user. Simulation containers disable networking, drop Linux capabilities, disallow privilege escalation, and limit resources to 2 CPUs, 2 GiB memory, and 256 processes. They mount their job directory, not the entire repository. Host Docker access remains part of the trust boundary.

Numerical operations have a 120-second process timeout. Cancellation terminates the supervised process and removes its named container. Preserve cleanup in exceptions, timeouts, service shutdown, and user cancellation when editing this adapter. Agent generation and C compilation have separate lifecycle code; do not assume they share every engine cleanup guarantee.

Defaults are DASSL, tolerance `1e-6`, and 6,000 output intervals. These settings are currently implementation constants rather than a general solver-settings UI. A declared maximum of 1,000 blocks in the schema is a validation bound, not a performance benchmark.

Manual models support stop times up to 86,400 simulated seconds for slow thermal/control studies, including the [data-center cooling example](../examples/DATACENTER.md). The wall-clock timeout and output-interval count are unchanged; a longer horizon is not a guarantee of adequate fast-event resolution or completion within the resource budget. Full-model agent planning retains its separate 60-second limit.

## Results

`result.json` includes run ID, engine label, project key, model hash, revision, full input snapshot, stop time, elapsed time, sample count, a common time array, signal series, the raw solver diagnostics string, and the structured warnings in `problems`. Series use component/variable keys such as `voltageProbe.y`.

The preview combines a reduced overview with event pairs, extrema, and a dense final window. All series use the same sample indices. The preview is not the full numerical output, and event-heavy models can still make it large. CSV downloads retain the full output file. OpenModelica can emit an extra grid row beyond the requested stop time; preview data excludes it.

The latest-result lookup requires matching document identity and emitted-source hash. Layout changes should leave results valid. A failed or cancelled run must not be surfaced as a successful partial result. See [testing](../development/TESTING.md) for engine regressions and [API](../API.md) for access.

## Component generation

For installation, account ownership, and first-use troubleshooting, see [AI feature setup](../AGENT_SETUP.md). Every AI call goes through `server/llm/dispatch.py`, which routes to the provider chosen in Settings → AI: Gradara AI (hosted, prepaid credits), OpenAI or Anthropic with the user's own key, the local Codex CLI, or off. See [distribution and AI providers](DISTRIBUTION.md#ai-providers).

`server/agent.py` builds the prompt and output schema and calls `dispatch.generate`. Each call is one schema-constrained generation: OpenAI and Anthropic use strict JSON-schema output, Gradara AI forwards the schema to its gateway, and `server/llm/codex.py` runs the Codex CLI with ephemeral execution, ignored user configuration, read-only sandbox mode, and the shell tool disabled. Requests instruct the model to return data and not execute tools. The prompt contains user intent and, when refining, the selected existing definition.

The selected block type constrains the schema: scalar Real signals, electrical pins, rotational mechanical flanges, thermal ports, or a coupling of multiple physical domains. Physical definitions may also have scalar signal ports. Server validation rejects mismatched port domains/directions, signal-only substitutes for physical requests, and refinement that changes existing terminal identity or semantics. All types support numeric parameters, declarations, equations, and a short symbol; controller export metadata is restricted to signal blocks. Generated definitions are checked by Pydantic and OpenModelica. A failed integration check can trigger one repair attempt containing the candidate and diagnostics. A successful result returns to the frontend for insertion; the subprocess does not directly edit the saved model.

Codex CLI calls have a 180-second timeout; HTTP providers have their own request timeouts. Prompts and responses are not kept locally unless `GRADARA_KEEP_AI_TRANSCRIPTS=1` is set (the Codex path always keeps a copy of its prompt, schema, response, and CLI log under the data folder's `agent/` directory for diagnosis). Cancellation and timeout go through `server/processes.py`: POSIX process groups on macOS/Linux, and `taskkill.exe /T /F` on native Windows to stop the generation process tree. Windows cleanup runs without a console window and reports termination failures. The Codex path on native Windows is less exercised than the HTTP providers. Ordinary simulation does not call the provider.

Successful generation establishes schema/compiler compatibility. It does not independently verify the user's intended physics. The design intentionally supports rapid authoring without inserting a separate physics-approval workflow.

## Model editing

`POST /api/models/edit` (`server/model_edit.py`) edits the open model through bounded operations; the agent never returns a Project. The request carries the prompt, the current `Project`, the UI catalog, an optional selection of block IDs, an optional `context` (Phase 4 passes run diagnostics), and `verify` (default true). The prompt contains the model without layout (no positions, sizes, routes, junctions, plots, or annotations), the selected block names, and the catalog description shared with full-model generation.

The agent returns an `EditPlan`: a summary, assumptions, `unsupported` (non-empty refuses the request), and 1–40 operations applied in order. The operations are `add_block`, `create_block` (at most two), `revise_definition`, `remove_block`, `rename_block`, `set_parameter`, `connect`, `disconnect`, and `set_duration`. At most three definitions per edit are created or rewritten; each goes through the typed component generator, with its compile check and port-preserving refinement.

`apply_operations` applies every operation or none. It resolves aliases of added blocks and rejects unknown blocks, ports, and parameters, out-of-range values, a second driver on a signal input, input-to-input or cross-domain connections, duplicate connections, and self connections. It re-validates parameter ranges and the whole document. Existing IDs, wires, nets, labels, plots, `modelId`, and `revision` are unchanged unless an operation targets them. Removed wires leave their nets, and each new wire joins (and may merge) the nets its ports are on, or gets a new hidden net.

The pipeline has two attempts. A plan that cannot be applied, or an edited model that fails `validate_simulation` or a trial `simulate`, is sent back with the error for one revision. If the second attempt fails its check, the proposal is returned with `verified: false` and structured `diagnostics` instead of failing the job. A second plan that cannot be applied fails the job; cancellation never becomes a revision. The job result is `{project, summary, assumptions, changes, generated, verified, diagnostics, samples, provider}`, with `changes` as `{op, blockIds, wireIds, description}`.

The client applies a proposal with `mergeProposal` (`lib/gradara/proposal.ts`). It keeps its own objects for untouched blocks and wires, so routes and the absent-versus-empty waypoint distinction survive, and takes definitions, new blocks (snapped at standard size), new wires (without routes), removals, the name, and the stop time from the proposal. The result goes through one `commit`, which is one undo step. A proposal made for an earlier `revision` cannot be applied.

## Diagnosis

`POST /api/diagnose` (`server/diagnose_agent.py`) explains problems and can propose a fix. The request carries the `Project`, 1–50 `Diagnostic` entries (live checks, the last run, or one row), an optional `runId`, the UI catalog, an optional question, and `proposeFix`. The run's emitted `model.mo` and saved solver text are added only when the run ID is alphanumeric and its `project.json` has the same `modelId` as the request; otherwise the run ID is ignored.

Stage 1 asks for a `Diagnosis`: a summary, causes (diagnostic IDs, block IDs, explanation), `fixable`, up to eight manual steps, and an `editPrompt` when a fix is possible. Unknown block and diagnostic IDs are removed. Stage 2 runs only when `proposeFix` is set and the diagnosis is fixable. It calls the model-editing pipeline with the edit prompt, the cause blocks as the selection, and the problems as `context`, with verification on. The result is `{diagnosis, proposal, provider}`, plus `fixError` when a requested fix could not be built. The job kind is `diagnose`. The workbench only starts a diagnosis when the user clicks Explain, Fix with AI, or a row's ask button.

## Controller C export

`server/exporter.py` requires a selected block whose definition has `controller: true`. It builds a package with project name/revision, the block definition and values, emitted controller source, adjacent connections, and an explicit C11 double-precision init/step target. The target also states the detected sample-period parameter (`samplePeriod` or `Ts`, with value and unit), the `discrete` states named in the declarations, and whether the equations are sampled, so the prompt does not have to infer timing.

The agent returns a header, source, and integration notes. A C compiler checks `-std=c11 -Wall -Wextra -Werror` through the selected backend (GCC in the engine container, or the host `gcc`/`cc` with the native backend); one compiler-driven repair is allowed. Files are stored exactly and zipped with the original controller contract and a README containing the notes. The job result returns `{id, blockId, header, source, notes, compiled, compiler}`, where `compiler` is the exact compile command; the Export dialog previews the files from it. Generated C is compiled, not executed against the Modelica trajectory. Continuous-state discretization is chosen and described by the generator.

For sampled controllers, the repository has a behavioral reference. The [Servo position example](../examples/SERVO.md) ships a hand-reviewed C implementation of its Discrete PID in `tests/fixtures/servo-controller/`. An integration test in `tests/test_exporter.py` replays the solver's sampled controller inputs through that C and requires the outputs to match the simulated controller at every sample instant. This checks the reference and the block semantics, not each newly generated export.

Current gaps include behavioral comparison of generated exports, whole-subsystem boundaries, clock/rate analysis, fixed-point formats, HDL targets, and complete cancellation cleanup in the C compilation path. These are explicit [roadmap](../../ROADMAP.md) items. Generated source can be rebuilt; asking an LLM to regenerate it is not a deterministic rebuild.

## Extension rules

Keep the frontend responsive while these operations run. Pass snapshots across the boundary, preserve diagnostics, and use structured IDs rather than filesystem paths in APIs. Keep engine-specific logic inside the adapter and emitter. A future backend must declare what component, connector, state, and event semantics it supports; replacing OpenModelica with arbitrary numerical libraries is not a drop-in change.

The current service is intended for trusted local use. Read [SECURITY.md](../../SECURITY.md) before changing transport, model validation, container mounts, agent tool access, or execution privileges.

## Inspector observations

`logging_signals.py` maps explicitly logged signal nets to their source variable. It rejects physical-net logging; sensor outputs carry those measurements. `modelica.py` emits output observation variables so the compiler retains them in CSV. Missing/non-finite logged output is a run failure, not an empty successful trace. Existing automatic output channels remain available alongside explicitly logged nets.

The dedicated Data Inspector uses a canvas renderer and frame-scheduled gestures. It loads full stored samples through the data endpoint, clips plotting to the visible time interval, preserves event pairs, and stores layouts/assignments/ranges as browser-local model preferences. It supports up to six time plots with independent Y ranges and optional linked X ranges. It does not yet provide multiple-run comparisons, dual cursors, frequency-domain views, independently scaled dual Y axes, or live streaming.

## Full-model generation

`server/model_agent.py` orchestrates library planning, dependency generation, assembly, and trial simulation as one cancellable job. The browser sends its built-in library snapshot; the service adds the current immutable AI collection. Model assembly cannot inject definitions: it references the frozen catalog, copies definitions, applies bounded numeric overrides, and validates the resulting `Project`. Plan-time unsupported domains stop the job. Drawing-only built-ins are not offered.

Up to four missing definitions are generated sequentially through `generate_component`, with its existing selected-type contract, repair, compiler check, and archive behavior. Only after those awaits finish does assembly begin. Assembly supports up to 80 blocks and 240 connections, with distinct bounded layout cells. The frontend applies shared block sizing and centered grid placement for preview/insertion; layout is not solver semantics. OpenModelica must finish a full trial run. Schema, connection, or simulation errors permit one assembly repair using the diagnostic. Cancellation propagates without becoming a repair attempt. Each provider call and numerical run retains the existing timeout and process supervision; this is a bounded multi-stage workflow, not an autonomous tool loop.

The draft has no saved model identity. Acceptance saves the active document and creates a separate model using normal persistence operations. Trial artifacts keep their original identity, so the saved model must run again for its own results. Successfully generated components survive later model failure or cancellation. Jobs remain in-memory, without resume or hierarchical subsystem generation.
