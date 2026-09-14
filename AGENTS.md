# Working on Gradara as an agent

Gradara is a local graphical multidomain simulator. The usability goal is a responsive engineering workbench; the numerical backend is OpenModelica. Help with a concrete scoped change, preserve existing work, and report what you actually verified.

## Start here

1. Read [CONTRIBUTING.md](CONTRIBUTING.md), [ARCHITECTURE.md](ARCHITECTURE.md), and the relevant task playbook in [docs/agents/PLAYBOOKS.md](docs/agents/PLAYBOOKS.md).
2. Inspect `git status` and relevant code before editing. Existing changes and ignored `projects/` files may be user work. Do not revert unrelated edits or regenerate user models.
3. Read any directory-specific `AGENTS.md` for files you change. Use [setup](docs/development/SETUP.md) and [testing](docs/development/TESTING.md) for commands and prerequisites.

## Where to work

| Change | Main code | Read first |
| --- | --- | --- |
| Workspace and panels | `app/page.tsx`, `app/engineering.css`, `components/gradara/` | User guide, browser acceptance checks, component agent guidance. |
| Block visuals / library | `block-face.tsx`, `block-symbol.tsx`, `lib/gradara/block-design.ts` | `docs/blocks/DESIGN.md`, `docs/blocks/AGENT_BLOCK_GUIDE.md`. |
| Wiring / selection / routing | `lib/gradara/net-*.ts`, `routing.ts`, `selection.ts`, canvas/net components | `docs/architecture/WIRING.md`, model format, browser acceptance checks. |
| Definitions and physical blocks | `lib/gradara/*blocks.ts`, `model.ts`, `server/modelica.py` | Block guide and simulation execution guide. |
| Save/load and API | `server/workspace.py`, `server/app.py`, `lib/gradara/api.ts` | Model format and API guide. |
| Simulation / agents / export | `server/engine*.py`, `agent.py`, `exporter.py` | `server/AGENTS.md`, execution guide, `SECURITY.md`. |
| Templates | `models/examples/`, `scripts/style-examples.ts`, buck builder | Example notes, block design, template tests. |

## Invariants

- The editable Gradara JSON document is the current authoring authority. Modelica source is generated from it; no general source round trip exists.
- Keep React Flow view objects and screen geometry out of numerical execution semantics. Physical nets and signal nets have different connection laws.
- Preserve stable IDs, custom dimensions, port identity, labels, manual routes, and unrelated parameter values. Renaming is not duplication. Presentation changes must not change emitted equations or result identity.
- Apply model changes through immutable, undoable operations. One completed gesture should be one undo action; previews stay local and frame-batched.
- Keep the canvas, library, and catalog on shared `BlockFace` rendering and shared port geometry. Use `npm run report:blocks` to inspect a local inventory when catalog or size rules change; generated reports stay out of Git.
- Agents generate bounded definitions and artifacts. Conventional code handles connectivity, equation packaging, and deterministic simulation execution. Do not put provider calls in the pointer or solver loop.
- Preserve the local launcher, ports, dependency workflow, and runtime isolation. Routine changes do not include publishing, replacing the local service with a hosted app, or changing unrelated system Docker state.
- Do not hide errors, bypass schema checks, or report incomplete simulation output as success. Read the pinned React Flow patch notes before changing that dependency.
- Keep original and upstream license notices. Do not add secrets, personal models, provider transcripts, or generated run directories to Git.

## Verification and handoff

Run checks appropriate to the change and record exact commands/results. Use a real browser for interaction changes; pure routing tests do not establish smooth pointer behavior. Use engine integration tests for physical/compiler/runtime changes. Documentation-only work needs link/hygiene checks, not a paid agent call or a simulation of every model.

Describe the resulting behavior, changed contracts, validation, and remaining limitations. If a check cannot run, say why. The current lint backlog is documented; do not silently disable lint rules to claim a clean run. Update the relevant guide when behavior changes, and keep proposals labeled as future work.

Keep documentation about the current product. Record task-specific test results in the PR or handoff; do not add session transcripts, dated audit diaries, personal workspace examples, or launch drafts to the repository. Put durable contracts in `docs/` and unresolved work in `ROADMAP.md`.
