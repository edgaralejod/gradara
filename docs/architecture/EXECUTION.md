# Simulation, agents, and exports

## Run lifecycle

1. The browser submits the current `Project` to `POST /api/runs`.
2. FastAPI/Pydantic validates structure. Empty models fail immediately. The job runner checks unsupported components and required scalar inputs before numerical execution.
3. `server/modelica.py` emits a complete Modelica model from the snapshot. Built-in physical kinds use canonical wrappers; signal and generated physical components use bounded definitions with standard Modelica connectors.
4. `server/engine.py` records the snapshot and source in a unique run directory and invokes `engine_runner.py` inside the engine container.
5. OpenModelica loads MSL, compiles, initializes, and simulates. The adapter requires explicit successful completion, a result file, sufficient coverage, and finite preview data.
6. The service saves a result preview and retains full CSV output. The browser polls the job and renders results or diagnostics.

The job registry is in memory. API job statuses are `queued`, `running`, `complete`, `failed`, and `cancelled`. At most four operations are active across simulation/component/export jobs. Engine execution has its own two-slot semaphore. Restarting the service loses job status; it does not delete completed run directories. There is no durable queue or automatic resume.

## Engine supervision

The engine is `gradara-engine:1.27.0`, built from the OpenModelica 1.27.0 OMPython image with MSL 4.1.0. The image runs as an unprivileged user. Simulation containers disable networking, drop Linux capabilities, disallow privilege escalation, and limit resources to 2 CPUs, 2 GiB memory, and 256 processes. They mount their job directory, not the entire repository. Host Docker access remains part of the trust boundary.

Numerical operations have a 120-second process timeout. Cancellation terminates the supervised process and removes its named container. Preserve cleanup in exceptions, timeouts, service shutdown, and user cancellation when editing this adapter. Agent generation and C compilation have separate lifecycle code; do not assume they share every engine cleanup guarantee.

Defaults are DASSL, tolerance `1e-6`, and 6,000 output intervals. These settings are currently implementation constants rather than a general solver-settings UI. A declared maximum of 1,000 blocks in the schema is a validation bound, not a performance benchmark.

## Results

`result.json` includes run ID, engine label, project key, model hash, revision, full input snapshot, stop time, elapsed time, sample count, a common time array, signal series, and diagnostics. Series use component/variable keys such as `voltageProbe.y`.

The preview combines a reduced overview with event pairs, extrema, and a dense final window. All series use the same sample indices. The preview is not the full numerical output, and event-heavy models can still make it large. CSV downloads retain the full output file. OpenModelica can emit an extra grid row beyond the requested stop time; preview data excludes it.

The latest-result lookup requires matching document identity and emitted-source hash. Layout changes should leave results valid. A failed or cancelled run must not be surfaced as a successful partial result. See [testing](../development/TESTING.md) for engine regressions and [API](../API.md) for access.

## Component generation

For installation, account ownership, and first-use troubleshooting, see [AI feature setup](../AGENT_SETUP.md). The provider path currently uses the user's local Codex CLI; there is no hosted Gradara agent service or provider/model selector.

`server/agent.py` invokes the locally installed Codex CLI with a structured output schema, ephemeral execution, ignored user configuration, read-only sandbox mode, and the shell tool disabled. Requests instruct it to return data and not execute tools. The prompt contains user intent and, when refining, the selected existing definition.

The selected block type constrains the schema: scalar Real signals, electrical pins, rotational mechanical flanges, thermal ports, or a coupling of multiple physical domains. Physical definitions may also have scalar signal ports. Server validation rejects mismatched port domains/directions, signal-only substitutes for physical requests, and refinement that changes existing terminal identity or semantics. All types support numeric parameters, declarations, equations, and a short symbol; controller export metadata is restricted to signal blocks. Generated definitions are checked by Pydantic and OpenModelica. A failed integration check can trigger one repair attempt containing the candidate and diagnostics. A successful result returns to the frontend for insertion; the subprocess does not directly edit the saved model.

Generation has a 180-second timeout per CLI invocation. Prompts, responses, and stderr are retained locally. The implementation uses POSIX process groups for cancellation; native Windows parity is unfinished. Ordinary simulation does not call the provider.

Successful generation establishes schema/compiler compatibility. It does not independently verify the user's intended physics. The design intentionally supports rapid authoring without inserting a separate physics-approval workflow.

## Controller C export

`server/exporter.py` requires a selected block whose definition has `controller: true`. It builds a package with project name/revision, the block definition and values, emitted controller source, adjacent connections, and an explicit C11 double-precision init/step target.

The agent returns a header, source, and integration notes. GCC checks `-std=c11 -Wall -Wextra -Werror` in a container; one compiler-driven repair is allowed. Files are stored exactly and zipped with the original controller contract. The C is compiled, not executed against the Modelica trajectory. Continuous-state discretization is chosen and described by the generator.

Current gaps include behavioral comparison, whole-subsystem boundaries, clock/rate analysis, fixed-point formats, HDL targets, and complete cancellation cleanup in the C compilation path. These are explicit [roadmap](../../ROADMAP.md) items. Generated source can be rebuilt; asking an LLM to regenerate it is not a deterministic rebuild.

## Extension rules

Keep the frontend responsive while these operations run. Pass snapshots across the boundary, preserve diagnostics, and use structured IDs rather than filesystem paths in APIs. Keep engine-specific logic inside the adapter and emitter. A future backend must declare what component, connector, state, and event semantics it supports; replacing OpenModelica with arbitrary numerical libraries is not a drop-in change.

The current service is intended for trusted local use. Read [SECURITY.md](../../SECURITY.md) before changing transport, model validation, container mounts, agent tool access, or execution privileges.
