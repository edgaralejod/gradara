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
| Block reference (Help and gradara.app/docs/blocks) | `lib/gradara/block-docs/`, `lib/gradara/block-reference.ts`, `components/gradara/block-help-dialog.tsx`, `scripts/build-block-docs.ts` | `docs/blocks/AGENT_BLOCK_GUIDE.md`. Regenerate the site pages with `npm run docs:blocks`. |
| Wiring / selection / routing | `lib/gradara/net-*.ts`, `routing.ts`, `selection.ts`, `grid.ts`, canvas/net components | `docs/architecture/WIRING.md`, model format, browser acceptance checks. |
| Definitions and physical blocks | `lib/gradara/*blocks.ts`, `model.ts`, `server/modelica.py` | Block guide and simulation execution guide. |
| Save/load and API | `server/workspace.py`, `server/app.py`, `lib/gradara/api.ts` | Model format and API guide. |
| Simulation engines | `server/engine.py`, `server/engines.py` (bundled, native, and Docker backends), `packaging/engine/` (built-in engine builds and the macOS VM agent), `safety.py`, `processes.py` | `server/AGENTS.md`, execution guide, `SECURITY.md`. |
| AI features and export | `agent.py`, `model_agent.py`, `model_edit.py`, `diagnose_agent.py`, `diagnostics.py`, `exporter.py`, `server/llm/` (dispatch and providers), `lib/gradara/proposal.ts` | Execution guide, distribution guide, `docs/PRIVACY.md`. |
| Desktop app and installers | `desktop/`, `packaging/`, `vite.desktop.config.ts`, `.github/workflows/release.yml` | Distribution guide, release checklist. |
| Gradara AI service | `cloud/` (gateway, sign-in pages, `deploy.sh`) | `cloud/README.md`, `docs/PRIVACY.md`. Privacy rules are enforced by its tests. |
| Website | `site/` | `site/README.md`. Keep claims in step with `docs/PRIVACY.md` and the code. |
| Templates | `models/examples/`, `scripts/style-examples.ts`, `scripts/grid-examples.ts`, buck/flyback/datacenter builders | Example notes, block design, template tests. |

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

## Keep documentation current

Documentation is part of every change, not a follow-up. A change that alters behavior, commands, settings, file locations, the API, data handling, prices, or supported platforms is not done while any doc still describes the old state.

1. **Update docs in the same change.** Use the map below to find the docs your change owns, and update them in the same commit or pull request.
2. **Search for what you replaced.** Before finishing, `git grep -n` the old name, command, path, setting, or behavior across `*.md`, `site/`, `.env.example`, and in-app text, and fix every hit.
3. **Describe the present.** Docs state what the product does now. When you ship something listed in `ROADMAP.md`, remove or shrink that item in the same change. Future work belongs only in `ROADMAP.md`, marked as future.
4. **Keep promises exact.** Privacy, pricing, and security statements in `docs/PRIVACY.md`, `SECURITY.md`, `site/public/`, and the app's Settings text must match the code. If you change what the gateway stores, logs, or charges, update all of them together.
5. **Fix, don't silence.** `python3 scripts/check-docs.py` checks links, backticked repository paths, `npm run` scripts, `cloud/deploy.sh` commands, and `GRADARA_*` variables in both directions. When it fails, fix the doc (or document the new variable). Do not loosen the check to pass.
6. **Leave it better.** Fix small stale passages you notice nearby. List larger ones in the pull request instead of ignoring them.

Pull requests get an advisory warning (`scripts/check-doc-drift.py`) when they change code in the left column without touching any doc in the right column. If no doc update is needed, say why in the pull request.

<!-- doc-map:start -->
| When you change | Update |
| --- | --- |
| `server/app.py`, `lib/gradara/api.ts` | `docs/API.md` |
| `server/models.py`, `lib/gradara/model.ts`, `server/workspace.py` | `docs/architecture/MODEL_FORMAT.md`, `docs/API.md` |
| `server/engine.py`, `server/engines.py`, `server/engine_runner.py`, `server/safety.py`, `Dockerfile.engine` | `docs/architecture/EXECUTION.md`, `docs/development/TROUBLESHOOTING.md`, `SECURITY.md` |
| `server/llm/`, `server/agent.py`, `server/model_agent.py`, `server/exporter.py` | `docs/architecture/EXECUTION.md`, `docs/architecture/DISTRIBUTION.md`, `docs/AGENT_SETUP.md`, `docs/PRIVACY.md` |
| `server/model_edit.py`, `server/diagnose_agent.py`, `server/diagnostics.py` | `docs/architecture/EXECUTION.md`, `docs/API.md`, `docs/AGENT_SETUP.md`, `docs/PRIVACY.md`, `SECURITY.md` |
| `components/gradara/problems-panel.tsx`, `components/gradara/assistant-panel.tsx`, `components/gradara/diagnostics-dock.tsx` | `docs/USER_GUIDE.md` |
| `cloud/gateway/config.py` | `docs/AGENT_SETUP.md`, `docs/architecture/DISTRIBUTION.md`, `site/public/index.html`, `site/public/terms.html` |
| `server/credentials.py`, `server/settings.py`, `server/paths.py` | `SECURITY.md`, `docs/development/SETUP.md`, `.env.example` |
| `lib/gradara/net-*.ts`, `lib/gradara/routing.ts`, `lib/gradara/selection.ts` | `docs/architecture/WIRING.md` |
| `lib/gradara/block-design.ts`, `components/gradara/block-face.tsx` | `docs/blocks/DESIGN.md` |
| `lib/gradara/block-docs/`, block definitions, `models/examples/` | `site/public/docs/blocks/` (run `npm run docs:blocks`) |
| `components/gradara/settings-dialog.tsx` | `docs/USER_GUIDE.md`, `docs/AGENT_SETUP.md` |
| `desktop/`, `packaging/`, `vite.desktop.config.ts` | `docs/architecture/DISTRIBUTION.md`, `docs/development/SETUP.md`, `docs/RELEASING.md` |
| `cloud/gateway/` | `cloud/README.md`, `docs/PRIVACY.md`, `site/public/privacy.html` |
| `cloud/deploy.sh`, `cloud/deploy.env`, `cloud/Dockerfile` | `cloud/README.md` |
| `.github/workflows/` | `docs/development/TESTING.md`, `docs/RELEASING.md` |
| `package.json`, `scripts/` | `docs/development/SETUP.md`, `docs/development/TESTING.md` |
<!-- doc-map:end -->

## Verification and handoff

Run checks appropriate to the change and record exact commands/results. Use a real browser for interaction changes; pure routing tests do not establish smooth pointer behavior. Use engine integration tests for physical/compiler/runtime changes. Documentation-only work needs link/hygiene checks, not a paid agent call or a simulation of every model.

Describe the resulting behavior, changed contracts, validation, and remaining limitations. If a check cannot run, say why. The current lint backlog is documented; do not silently disable lint rules to claim a clean run. Update the docs your change owns (see [Keep documentation current](#keep-documentation-current)), and keep proposals labeled as future work.

Keep documentation about the current product. Record task-specific test results in the PR or handoff; do not add session transcripts, dated audit diaries, personal workspace examples, or launch drafts to the repository. Put durable contracts in `docs/` and unresolved work in `ROADMAP.md`.

## Pull requests and git messages

Git history is the durable record; GitHub PR text is the review record. Keep them separate.

- Write ordinary git messages: one short subject and, when useful, a few sentences. Same rule for merge commits.
- Fill [the PR template](.github/PULL_REQUEST_TEMPLATE.md) on GitHub. Do not copy that template, HTML, checklists, agent UI, or session notes into a commit or merge message.
- When opening or merging a PR, set the merge commit to the same short style as the branch commits. A squash or merge title plus two or three sentences is enough; the PR body can stay longer.
- Do not use `git commit --amend` or history rewrites to “improve formatting” of already-published work unless a maintainer asked for that rewrite.
