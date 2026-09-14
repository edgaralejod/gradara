# Local development setup

Run commands from the repository root. Use a checkout or source download of this repository; no Codex application or hosted Gradara account is required.

## Prerequisites and platform status

| Tool | Requirement |
| --- | --- |
| Node.js / npm | Node 22.13 or newer. CI uses the Node 22 line. Use the committed npm lockfile. |
| Python | Python 3.12 is the development and CI baseline. Use a repository-local virtual environment. |
| Docker | A running Docker-compatible Linux engine for simulation and C compilation. No host OpenModelica installation is required. |
| Codex CLI | Optional, installed and signed in, for component generation and controller C export. |

macOS with Colima has been exercised end to end. Linux uses the active Docker context; its hosted CI jobs are configured but must be observed after publication. On Windows, use WSL2 with Linux Node/Python and a Docker engine available inside WSL for the complete workflow. Native Windows process-group cancellation in the agent adapter is not implemented, and the launcher is not fully verified there. Do not interpret passing frontend tests on an OS as validation of its complete runtime.

## Install

macOS, Linux, or a WSL terminal:

```sh
npm ci
python3 -m venv .venv
.venv/bin/python -m pip install -r server/requirements-dev.txt
```

For runtime only, `server/requirements.txt` omits pytest. Direct Python dependencies are pinned; their transitive dependencies are not yet captured in a full lockfile.

`npm ci` runs the version-checked React Flow observer patch. Do not bypass a patch failure or use `--ignore-scripts` for a working development install. See [patch maintenance](../../patches/README.md).

On native Windows, frontend and pure backend development can use:

```powershell
npm ci
py -3.12 -m venv .venv
.\.venv\Scripts\python.exe -m pip install -r server/requirements-dev.txt
.\.venv\Scripts\python.exe -m pytest -q -m "not integration"
```

## Select the Docker runtime

On macOS, install Docker CLI and Colima if using the default launcher path. It prefers an existing `colima-gradara` context, then the earlier `colima-flux`, and otherwise prepares a `gradara` profile. The VM starts with 4 CPUs, 4 GiB memory, and 30 GiB disk.

For Docker Desktop or another already running runtime, explicitly use the active context:

```sh
export GRADARA_DOCKER_CONTEXT=""
docker info
```

Or choose a context by its exact name from `docker context ls`:

```sh
export GRADARA_DOCKER_CONTEXT="your-context-name"
```

Linux and WSL use the active context by default. Keep the same context in the launcher, service terminal, and integration-test terminal. A successful `docker info` in a different context does not establish engine availability for Gradara.

## Start and stop

```sh
.venv/bin/python scripts/start.py
```

The launcher checks dependencies, builds `gradara-engine:1.27.0` if missing, starts both services, and opens the browser. The first engine build downloads OpenModelica's base image and Modelica Standard Library 4.1.0. It does not install Codex or sign you into a provider.

- Workbench: [http://localhost:4317](http://localhost:4317)
- Service health: [http://127.0.0.1:8765/api/health](http://127.0.0.1:8765/api/health)
- API reference: [http://127.0.0.1:8765/docs](http://127.0.0.1:8765/docs)

Keep the launcher terminal running. Use `--no-open` to skip browser opening. If both services already respond, the launcher opens the existing workspace. Logs are in `.runtime/service.log` and `.runtime/workbench.log`.

```sh
.venv/bin/python scripts/stop.py
```

Stopping preserves saved projects. Colima is a separate VM; `colima stop --profile gradara` stops it when no longer needed. Use the actual profile name if using the legacy `flux` profile. Do not stop a shared Docker runtime used by unrelated work.

## Run services separately

For backend hot reload, use two terminals after dependency installation and engine preparation:

```sh
.venv/bin/python -m uvicorn server.app:app --host 127.0.0.1 --port 8765 --reload --reload-dir server
```

```sh
npm run dev -- --port 4317
```

The Vite proxy forwards `/api` to the service. Keep these ports unless changing the proxy, origin allowlist, launcher, and documentation together. A manually started backend does not build the engine image; use the launcher first or the build command in [testing](TESTING.md).

Frontend-only work requires just `npm ci` and `npm run dev`. The block catalog at `/block-catalog` supports visual work without Docker. The full model workflow needs the Python service; offline save and simulation are not implemented. Pure backend tests do not need Docker or an agent account.

## Optional agent configuration

Follow [AI feature setup](../AGENT_SETUP.md) to install the public Codex CLI, sign into your own account, and try a generated block. The adapter uses the executable from `GRADARA_CODEX_BIN`, PATH, or an older macOS application fallback. If needed:

```sh
export GRADARA_CODEX_BIN="/path/to/codex"
```

The service reads process environment variables directly. `.env.example` is documentation; copying it to `.env` does **not** load variables into the Python service. Set variables in the launching shell. Legacy `FLUX_DOCKER_CONTEXT` and `FLUX_CODEX_BIN` remain aliases; prefer current names. Never commit credentials or your CLI configuration.

`agentReady` means an executable was found, not that provider authentication or connectivity was tested. Read [security and data handling](../../SECURITY.md) for what generation sends to the provider.

## Files you own

`projects/models/` holds documents; `projects/workspace.json` is the active model; run snapshots, CSVs, prompts, and exports also live under `projects/`. These files and `.runtime/`, `.venv/`, build outputs, and local environment files are ignored by Git. Back them up separately. Contributors should use synthetic examples and never force-add a personal workspace to a PR.

The repository retains optional Sites/Cloudflare build scaffolding with no database or bucket bindings. You do not need to register or publish a site to run Gradara locally. `npm run build` verifies the web bundle; it does not package the Python service or engine.
