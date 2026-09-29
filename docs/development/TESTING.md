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
(cd cloud && ../.venv/bin/python -m pytest -q)   # after pip install -r cloud/requirements.txt
```

`npm test` runs Node/tsx tests of serialized document saves/recovery, immutable edits, geometry, gestures, selection, net identity, naming, block design, plots, and templates. `tests/hierarchy.test.ts` covers grouping (cut nets become typed ports), nesting, scope edits updating every instance, shared definitions and Make unique, and promoted parameters. `tests/subsystem-ports.test.ts` covers subsystem ports: per-kind numbering, adding, renumbering, renaming, retyping, and removing ports from outside, domain adoption, and dropping a wire on a subsystem block to add a port. `tests/variants.test.ts` covers parameter and diagram variants, ports one variant lacks, configurations at any depth, and the Run all overlay. `tests/codegen.test.ts` covers controller detection, including a grouped controller. These are not browser interaction tests. Python unit tests cover schemas, source emission, document persistence, diagnostics, and result handling. `tests/test_msl.py` checks that `lib/gradara/msl-blocks.ts` matches `scripts/msl-blocks.py`, that every wrapper block matches its class in the MSL index, and that wrappers with a wrong class, parameter, value, or conditional connector are refused. `tests/test_ctemplate.py` checks that C templates for custom blocks accept only numeric assignments, are ignored when stale, compile inside a generated unit, and that the AI job revises once with the rejection reason (fake provider). `tests/test_hierarchy.py` and `tests/test_variants.py` cover version 2 structure errors, recursion, nested emission, instance paths, idle ports, and configuration round trips. They create synthetic fixtures and do not require provider credentials. They also cover the local API boundary (host, origin, and client-header checks), keychain-free secret storage, provider request shapes with mocked HTTP, and the native engine plumbing with a stand-in `omc`. The gateway suite in `cloud/tests` covers sign-in, credit charging and refunds, Stripe webhook idempotency, account deletion, and that request content never reaches logs or the database.

`check-docs.py` checks that relative Markdown links resolve (outside code fences), that backticked repository paths exist, that `npm run` scripts and `cloud/deploy.sh` commands exist, and that the `GRADARA_*` variables in the docs match those the code reads. It does not check `#anchor` fragments. `check-repo.py` checks repository candidates for accidental local artifacts, private absolute paths, and a limited set of credential patterns without printing suspected secret values. It is not a comprehensive security audit or dependency vulnerability scanner.

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

This runs the complete Python suite, including real engine jobs. To run only the library, hierarchy, variant, and C code engine tests:

```sh
.venv/bin/python -m pytest -q -m integration tests/test_msl_engine.py tests/test_hierarchy.py tests/test_variants.py tests/test_codegen.py
```

`tests/test_validation.py` compares three textbook responses with their closed forms (RC charging, a thermal RC, and a mass-spring-damper step's overshoot and peak time); [validation](../VALIDATION.md) lists every engine check with its measured values. `tests/test_msl_engine.py` compiles and runs every MSL wrapper block in a small harness (or a working circuit for blocks that need one) and checks physics for a translational spring-mass (settles at force over stiffness), a heat capacitor (integrates heat flow), and an inverting op-amp amplifier (gain −10). `tests/test_hierarchy.py` requires the grouped DC motor fixture to reach the same final speed as the flat template, and `tests/test_variants.py` requires switching variants to change the result by the expected gain ratio. It also compiles inactive variants with the engine and runs both configurations of the EV drivetrain example, which must settle at its 5 m/s cruise speed. Integration tests cover the DC motor and parameter response, FOC behavior, ideal buck switching at two duties, flyback startup and regulation, data-center electrical/thermal balances, singular-model failure handling, and the servo controller replay. The replay test (`tests/test_exporter.py`) simulates the servo example, feeds the solver's sampled controller inputs to the reference C in `tests/fixtures/servo-controller/` through a host `gcc`/`cc` build, and compares outputs at every sample. It is skipped with a reason when no host C compiler exists. The C code generator's replay test (`tests/test_codegen.py`) simulates the DC motor, servo, FOC, and grouped DC models, generates C for each controller, and requires the compiled code to reproduce the simulated controller outputs from the recorded inputs; its unit tests compile generated code with the host `gcc` and are skipped without one. The AI exporter's unit tests use a fake provider and compiler; a separate unit test compiles the reference with the export flags when a host compiler is present. They write uniquely named job artifacts under ignored `projects/runs/`. Do not delete that entire directory to clean tests; it also contains user runs.

### Built-in engine

The same integration suite runs against a built-in engine bundle (see [setup](SETUP.md#built-in-engine-bundles)):

```sh
GRADARA_ENGINE=bundled GRADARA_ENGINE_BUNDLE=build/engine .venv/bin/python -m pytest -q -m integration
```

For the macOS VM image, run its contents under Docker on Linux and point the VM backend at the guest agent over TCP; everything but the virtual machine itself (vsock and vfkit) is exercised, including the path mapping to `/data`:

```sh
docker run -d --name agent --user "$(id -u):$(id -g)" -p 127.0.0.1:18024:18024 -e GRADARA_AGENT_TCP=18024 \
  -v "$PWD/projects:/data" gradara-guest:amd64 python3 -u /opt/gradara/agent.py
GRADARA_ENGINE=bundled GRADARA_ENGINE_BUNDLE=build/engine GRADARA_ENGINE_VM_TCP=127.0.0.1:18024 \
  .venv/bin/python -m pytest -q -m integration
```

On a Mac, `GRADARA_ENGINE=bundled GRADARA_ENGINE_BUNDLE=build/engine` boots the real VM. `tests/test_bundled_engine.py` (unit tests, no engine) covers bundle discovery, the bundled environment (only the bundle's library, gcc on Linux), the VM path mapping and vfkit arguments, and the guest agent's commands, timeouts, and cancellation.

Engine and block changes should add checks with engineering meaning: expected steady-state relations, correct event behavior, conserved connection laws, or a meaningful failure diagnostic. A screenshot or successful compile alone does not prove a changed physical implementation works.

## Browser acceptance

Use the real browser whenever a change affects interactions. Start from a new disposable model or template; do not rearrange someone else's saved document for QA.

1. Click New model, rename its title, and add the first Step block. **Without refreshing**, click its output port: the wire preview and Cancel control must appear. Cancel, add Gain, remove any automatically created wire, and connect by both click-to-click and drag-to-connect, with undo between attempts. Repeat with a first block dragged from the library, another blank model, and a model reopened through Models; each new canvas must acquire wiring listeners without a reload. Double-click the Step: the block dialog opens on Properties with focus in its first parameter, and the add-block picker does not. Change a parameter and the name, switch to Equations, then Apply: one undo reverts both. Repeat and press Escape: nothing changes. Double-click a Resistor: `R` is editable and its equations are read-only. Double-click empty canvas, including near the bottom edge: the picker opens fully on the sheet. Change a parameter and immediately create/open another model. Reopen the first model through Models search; verify the latest edits and run it. Verify My models and Examples remain separate. Exercise Save a copy, repeated imports, Trash/restore, and reload. In two tabs editing the same model, confirm a stale save gets an actionable conflict and saving a copy preserves both versions.
2. Draw click-to-click and drag-to-connect wires, branch onto wire ink, reshape/reconnect, cancel, undo, and redo. Check that canvas selection does not compete with drawing.
3. Move connected blocks and junctions, straighten near-horizontal runs, resize a block, and drag its label. Nudge the DC motor diagonally by a few units: its electrical run and its shaft both snap straight, and it lands where the preview showed. Drag a block past a pinned bend of its own wire and past its junction dot: no wire doubles back or crosses the block. Drag a block away and back: its dot and wires return. Confirm no leftover stubs or unexpected geometry changes after reload. `tests/drag.test.ts` covers the same cases without a browser, `tests/auto-layout.test.ts` holds agent placement to the template standard, and `tests/arrange.test.ts` checks that Arrange keeps every connection, is stable when repeated, and leaves no overlaps, loops, or wires through blocks on every example except the flyback converter, which it does not yet arrange stably. Press ⌘/Ctrl + Shift + A on an example and on a scrambled copy, then undo.
4. Ctrl-drag a block and a connected selection. Names and IDs must be unique, originals unchanged, and undo atomic.
5. Name a net, inspect its connected blocks, move its label, and save/reopen.
6. Open each fresh template (DC motor, servo position, FOC, buck, flyback, data center cooling, and EV drivetrain) and check block sizing, readable labels, ports, and routes at normal zoom. Run relevant templates and inspect actual result traces.
7. Test a narrow window, keyboard focus, Escape, and text fields. Canvas shortcuts must not consume normal text editing.
8. Problems dock: build a positive-feedback loop (Step → Subtract with `y = a + b`, Gain 1 back into Subtract) and run it. The dock opens on Problems, the workspace stays on Diagram, and the Last run row names Subtract and Gain; clicking a chip selects and centers that block, and expanding the row shows the hint and full solver text. Delete a source: Model checks shows the unconnected input and Last run turns stale. Resize and collapse the dock, reload, and confirm both persist. ⌘/Ctrl+J toggles it except while typing in a field. Below 700 px the dock is hidden and the status bar counts remain.
9. Inspect browser errors and service logs. Do not hide observer, promise, or script errors to make a test look clean.

For agent changes, separately test generation/refinement with a configured provider. Preserve compatible port identities. For C-export changes, inspect the contract and compile result, and verify cancellation/resource cleanup. Process-tree cancellation without a provider is covered by `tests/test_processes.py`. Agent provider calls are intentionally absent from automated CI.

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
npx tsx scripts/build-flyback-example.ts
npx tsx scripts/build-datacenter-example.ts
npx tsx scripts/style-examples.ts
npx tsx scripts/grid-examples.ts
npm run docs:blocks
```

Run only the relevant generator. `report:blocks` writes `reports/block-catalog.md`, which is ignored by Git and can be regenerated at any time. Review block visuals in the live `/block-catalog` page; structural inventory alone cannot verify appearance or physics.

The example builders rewrite checked-in template files, not user documents. `npm run docs:blocks` writes the block reference pages of gradara.app (`site/public/docs/blocks/`) from `lib/gradara/block-docs/` and the library, drawing each block with the workbench's renderer (and `site/public/assets/block-faces.css`); run it after changing a block, its face or `app/blocks.css`, its documentation, or an example (the pages list which examples use each block). Run `scripts/grid-examples.ts` after any builder: it puts the templates and test fixtures on the sheet grid, as the workbench does when a document opens, so the checked-in files are what the workbench shows. Review their diffs, run template tests, and inspect the resulting examples. A deliberate example change should not be mixed into unrelated work.

## CI

[Core CI](../../.github/workflows/ci.yml) runs typecheck, frontend tests, a check that the block reference pages are current (`npm run docs:blocks -- --check`), npm audit at high severity, web build, Python unit tests, documentation checks, and repository hygiene on hosted Ubuntu, for pull requests and pushes to `main` (not for branch or tag pushes). `scripts/check-docs.py` fails when docs mention a missing file, path, `npm run` script, or `cloud/deploy.sh` command, or when `GRADARA_*` variables in the docs and the code differ. On pull requests, `scripts/check-doc-drift.py` also warns (without failing) when code changes without the docs mapped to it in [AGENTS.md](../../AGENTS.md#keep-documentation-current). Lint is advisory. [Engine CI](../../.github/workflows/engine.yml) is manually dispatched and builds the Docker image before running the full Python suite. [Native OpenModelica](../../.github/workflows/native-engine.yml) installs OpenModelica on Ubuntu and Windows and runs the full suite with `GRADARA_ENGINE=native`. [Gradara AI gateway](../../.github/workflows/cloud.yml) runs the gateway tests and builds its image when `cloud/` or `server/llm/` change, on pull requests and `main`. [Desktop installers](../../.github/workflows/release.yml) first runs [Engine bundles](../../.github/workflows/engine-bundle.yml), which builds the four built-in engines and tests each one (the full integration suite on the Linux and Windows bundles and through the VM backend for both macOS images, clean-container simulations for Linux, and a real VM boot on an Intel Mac runner), then builds the installers with those engines and installs, launches, simulates on, and uninstalls each one on clean Windows, macOS, and Ubuntu runners; it runs on `v*` tags, on manual dispatch, and on pull requests that change packaging (see the [release checklist](../RELEASING.md#desktop-installers)). [Website](../../.github/workflows/site.yml) checks the site files and every link between its pages (`scripts/check-site-links.py`), and deploys them when a deploy key is configured. None of these invoke an AI provider or run on a maintainer's personal machine. All are read-only except the draft-release job in Desktop installers and the Website deploy.

Inspect [GitHub Actions](https://github.com/edgaralejod/gradara/actions) for results on the exact commit under review. Workflow files are configuration, not evidence of a successful hosted run. Observe checks before making them required, and dispatch engine CI when validating a release candidate. The [release checklist](../RELEASING.md) separates source availability, hosted checks, and supported distributions.
