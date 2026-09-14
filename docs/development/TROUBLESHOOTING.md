# Troubleshooting

## Workbench cannot connect

Check [service health](http://127.0.0.1:8765/api/health). If it is unreachable, inspect `.runtime/service.log` and the launcher terminal. Check `.runtime/workbench.log` for frontend startup errors. Avoid starting a second launcher while the first is still running. Ports 4317 and 8765 must be free or occupied by the intended Gradara processes.

The backend origin allowlist expects localhost/127.0.0.1 at the documented ports. A different hostname or port can return 403. Keep the service bound to loopback; changing CORS is not a substitute for authentication.

## Engine unavailable

Check Docker in the context Gradara uses. On macOS that may be `colima-gradara` or `colima-flux`, even when Docker Desktop is your shell's active context. Use `GRADARA_DOCKER_CONTEXT` to select it explicitly, then restart the service so its cached context changes.

Run the launcher to build the image if it is missing. A first build needs network access. Ensure the runtime can mount the repository's run directories and has sufficient disk/memory. On Linux the image's `ENGINE_UID` should match the user creating run folders. The [setup guide](SETUP.md) and [manual engine build](TESTING.md) describe both paths.

## Model does not simulate

Read the error detail first. Unconnected scalar inputs should name the block and port. A graph can be saved while incomplete; it is checked again before Run. Mux/demux and subsystem placeholders do not yet execute their intended behavior.

Inspect emitted source and the failing run folder's diagnostics. Check parameter ranges, equation balance, initial conditions, feedback sign, and physical references. Ideal switch networks can be singular for particular configurations. Do not treat partial CSV output as a successful solution or weaken completion checks to remove the error.

## Results are missing after editing or reopening

Results are reused only for the same model ID and emitted-source hash. Changing parameters, connections, equations, or stop time requires another run. Moving or resizing a block should not. If changing only layout loses results, include that minimal project and gesture in a bug report.

Jobs are in memory. A backend restart can make a job ID return 404 even though a completed run's files remain on disk. Reopen the model to load a matching completed result. Partial jobs are not resumed automatically.

## Agent unavailable or generation fails

The CLI must be installed, signed in, and able to reach its provider. `agentReady` checks executable presence only. Set `GRADARA_CODEX_BIN` in the service's environment if executable discovery is wrong. Generation may take tens of seconds and has a timeout.

Review diagnostics in the UI. Local prompts, responses, and agent logs are under `projects/agent/`; they may contain proprietary model content, so redact before sharing. The current generator accepts scalar signal components, not arbitrary Modelica packages or physical connector definitions. Editing and ordinary simulation remain available without an agent.

## Install fails at the React Flow patch

Use `npm ci` with the committed lockfile and the supported Node version. An upstream version or observer implementation mismatch intentionally stops installation. Do not delete the postinstall script, suppress native errors, or patch a global browser API. Follow [patch maintenance](../../patches/README.md) when intentionally upgrading.

## Changes are not showing

Frontend files use hot reload. A backend launched with `scripts/start.py` does not auto-reload Python changes; restart it, or use the documented separate `uvicorn --reload` command. Refreshing a browser does not restart Python.

Template improvements apply to newly created models. Existing saved documents retain their geometry and definitions. Use **New model** to inspect an updated template; do not delete your saved workspace to make it appear.

## Report a useful bug

Include the commit, OS/browser, model origin, exact reproduction steps, expected/actual result, and relevant errors. For wiring, mention zoom, modifier keys, start/end ports, and undo/reload behavior. For simulation, include a small synthetic `.gradara.json`, parameter values, engine version, and diagnostic excerpt. Never attach all of `projects/`, credentials, or private model data. Security reports follow [SECURITY.md](../../SECURITY.md).
