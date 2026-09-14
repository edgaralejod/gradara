# Testing and acceptance

Install dependencies using [setup](SETUP.md). Run commands at the repository root. Use the virtual environment's Python; PowerShell uses `.\.venv\Scripts\python.exe` in place of `.venv/bin/python`.

## Fast checks

```sh
npm run typecheck
npm test
npm audit --audit-level=high
.venv/bin/python -m pytest -q -m "not integration"
python3 scripts/check-docs.py
python3 scripts/check-repo.py
npm run build
```

`npm test` runs Node/tsx tests of serialized document saves/recovery, immutable edits, geometry, gestures, selection, net identity, naming, block design, plots, and templates. These are not browser interaction tests. Python unit tests cover schemas, source emission, document persistence, diagnostics, and result handling. They create synthetic fixtures and do not require provider credentials.

`check-docs.py` checks relative Markdown file links, excluding code fences. `check-repo.py` checks repository candidates for accidental local artifacts, private absolute paths, and a limited set of credential patterns without printing suspected secret values. It is not a comprehensive security audit or dependency vulnerability scanner.

Whole-repository `npm run lint` currently fails on an existing backlog: React compiler/hook findings in the workspace, editor typing, and accessibility/type issues in UI primitives. CI runs it as an explicitly advisory step. Do not suppress the rules or claim it passes. Keep changed code lint-clean where feasible; a focused lint-cleanup PR should include browser regression checks before lint becomes a required gate.

## OpenModelica integration

The launcher builds the image for the selected Docker context. To build it manually on Linux/macOS/WSL, first select the intended context in the shell and run:

```sh
docker build -f Dockerfile.engine --build-arg ENGINE_UID="$(id -u)" -t gradara-engine:1.27.0 .
.venv/bin/python -m pytest -q -m integration
```

For a named context, add `--context CONTEXT` to the Docker command and set `GRADARA_DOCKER_CONTEXT=CONTEXT` for pytest. The manual Docker command uses the CLI's active context; the Python runtime has its own selection rules.

```sh
.venv/bin/python -m pytest -q
```

This runs the complete Python suite, including real engine jobs. Integration tests cover the DC motor and parameter response, FOC behavior, ideal buck switching at two duties, and singular-model failure handling. They write uniquely named job artifacts under ignored `projects/runs/`. Do not delete that entire directory to clean tests; it also contains user runs.

Engine and block changes should add checks with engineering meaning: expected steady-state relations, correct event behavior, conserved connection laws, or a meaningful failure diagnostic. A screenshot or successful compile alone does not prove a changed physical implementation works.

## Browser acceptance

Use the real browser whenever a change affects interactions. Start from a new disposable model or template; do not rearrange someone else's saved document for QA.

1. Click New model, rename its title, add Step and Gain, wire them, change a parameter, and immediately create/open another model. Reopen the first model through Models search; verify the latest edits and run it. Verify My models and Examples remain separate. Exercise Save a copy, repeated imports, Trash/restore, and reload. In two tabs editing the same model, confirm a stale save gets an actionable conflict and saving a copy preserves both versions.
2. Draw click-to-click and drag-to-connect wires, branch onto wire ink, reshape/reconnect, cancel, undo, and redo. Check that canvas selection does not compete with drawing.
3. Move connected blocks and junctions, straighten near-horizontal runs, resize a block, and drag its label. Confirm no leftover stubs or unexpected geometry changes after reload.
4. Ctrl-drag a block and a connected selection. Names and IDs must be unique, originals unchanged, and undo atomic.
5. Name a net, inspect its connected blocks, move its label, and save/reopen.
6. Open all three fresh templates and check block sizing, readable labels, ports, and routes at normal zoom. Run relevant templates and inspect actual result traces.
7. Test a narrow window, keyboard focus, Escape, and text fields. Canvas shortcuts must not consume normal text editing.
8. Inspect browser errors and service logs. Do not hide observer, promise, or script errors to make a test look clean.

For agent changes, separately test generation/refinement with a configured provider. Preserve compatible port identities. For C-export changes, inspect the contract and compile result, and verify cancellation/resource cleanup. Agent calls are intentionally absent from automated CI.

Record OS/browser, precise gestures, expected/observed behavior, and checks run in the PR. Use the [wiring contract](../architecture/WIRING.md) for implemented behavior and the [roadmap](../../ROADMAP.md) for open gaps. A passing geometry suite or a small smooth diagram does not establish performance or feature parity with another tool.

### Wiring regression fixtures

| Fixture | Verify |
| --- | --- |
| Source → sum → gain with feedback | Port exit direction, direct and pinned routes, branch creation, cancel, reconnect/redraw, and one-step undo. |
| Several junctions on one trunk | Dots follow the edited run in horizontal, vertical, mirrored, and reversed-endpoint layouts; connectivity survives normalization and reload. |
| Complete and partial connected selections | Internal geometry translates rigidly; boundary wires stretch; copies have independent IDs and no invented external connections. |
| Nearby or crossing nets | Alignment does not splice; attachment highlights the intended target; invalid joins leave the original document intact. |
| Repeated bend/straighten cycles | Nearly collinear runs coalesce without accumulating stubs; endpoint normals, real junctions, and useful manual bends remain intact. |
| Signal and physical connections | Driver rules differ from acausal terminal laws; geometry-only edits preserve emitted connections and result identity. |

Repeat affected gestures at 25%, 100%, and 200% zoom, including Escape, focus loss, undo/redo, and reload. Test input fields and Monaco separately so shortcuts do not steal text editing. Use the FOC template for a realistic dense sheet and synthetic load fixtures for performance measurements; record visible/total element counts and pointer-to-paint latency separately from numerical runtime.

## Generated fixtures and reports

```sh
npm run report:blocks
npx tsx scripts/build-buck-example.ts
npx tsx scripts/style-examples.ts
```

Run only the relevant generator. `report:blocks` writes `reports/block-catalog.md`, which is ignored by Git and can be regenerated at any time. Review block visuals in the live `/block-catalog` page; structural inventory alone cannot verify appearance or physics.

The example builders rewrite checked-in template files, not user documents. Review their diffs, run template tests, and inspect the resulting examples. A deliberate example change should not be mixed into unrelated work.

## CI

[Core CI](../../.github/workflows/ci.yml) runs typecheck, frontend tests, npm audit at high severity, web build, Python unit tests, documentation links, and repository hygiene on hosted Ubuntu. Lint is advisory. [Engine CI](../../.github/workflows/engine.yml) is manually dispatched and builds the Docker image before running the full Python suite. Neither workflow publishes artifacts or invokes an agent provider. They use read-only repository permissions and do not run pull requests on a maintainer's personal machine.

Workflow files are configuration, not evidence of a successful hosted run. The repository is currently hosted on Cursor Origin; GitHub Actions files do not establish an active CI service there. No Origin CI integration is connected. Observe the selected CI system's first execution before making its checks required. The [release checklist](../RELEASING.md) records the distinction.
