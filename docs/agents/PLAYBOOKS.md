# Agent task playbooks

Start with [AGENTS.md](../../AGENTS.md). These recipes are navigation and acceptance guidance, not permission barriers. Complete a scoped task, preserve unrelated work, and leave a reviewable result. Avoid broad rewrites that make a small interaction fix hard to assess.

## A good task brief

```text
Outcome: what a user should be able to do.
Reproduction: a synthetic model, starting state, and exact steps.
Scope: relevant subsystem and files likely to change.
Invariants: identities, physics, geometry, or compatibility to preserve.
Acceptance: visible behavior and meaningful tests.
Handoff: changed behavior, evidence, limitations, and follow-up work.
```

Do not include credentials or an entire personal workspace. Inspect the current code rather than assuming filenames or old audit statements are still authoritative.

## Wiring or selection fix

Read [WIRING.md](../../WIRING.md), the [wiring audit](../../WIRING_AUDIT.md), and [model format](../architecture/MODEL_FORMAT.md). Trace pointer ownership from canvas/net components into `net-session.ts`, `net-draw.ts`, or `net-edit.ts`, then the immutable project operation and normalization. Keep route geometry distinct from logical net identity.

Reproduce before changing the policy. Fix the general rule, not a template's coordinates. Exercise above/below alignment, reversed port sides, a physical net, a signal branch, multiple zoom levels, Escape, undo/redo, and save/reload. Pointer previews should remain smooth and one gesture should commit once. Add a regression for the broken geometric or graph invariant, then confirm the actual gesture in a browser.

## New block or changed visual

Follow the [block authoring guide](../blocks/AGENT_BLOCK_GUIDE.md) and [design contract](../../BLOCK_DESIGN.md). Start from a neighboring library definition. Choose stable port/parameter IDs, concise labels and notation, and shared size/port rules. Do not introduce an independent canvas or library renderer.

For a signal block, validate generated Modelica and meaningful parameter/state behavior. For a physical block, implement a canonical wrapper and verify connector laws with an executable model. Inspect the library specimen, canvas block, inspector, and catalog. Refresh `BLOCK_AUDIT.md` when needed. Leave saved user instances unchanged unless the task explicitly includes a migration.

## Persistence or API change

Read the model-format and [API](../API.md) guides. Identify whether a field belongs to physics, layout, identity, or provenance. Update TypeScript and Pydantic together; preserve optional-field semantics. Add a legacy fixture and round-trip/identity check when changing saved data. Use temporary test directories so tests cannot replace the active workspace.

Check creating two independent models, saving/reopening each, switching documents, preserving names and IDs, and rejecting malformed input without partial mutation. Layout-only changes must preserve source-derived result validity. Do not claim multi-client conflict resolution unless it is implemented and tested.

## Simulation or engine change

Read [execution](../architecture/EXECUTION.md) and `server/AGENTS.md`. Start with a small reproducible project and expected numerical behavior. Inspect emitted source and real diagnostics before changing the solver adapter. Keep jobs immutable, output validation strict, and cancellation cleanup intact.

Run relevant unit tests and actual Docker/OpenModelica integration tests. Include both a successful numerical case and a meaningful failure or cancellation path where relevant. Report engine/library versions and tolerance; do not replace actual simulation with frontend approximations to make a demo pass.

## Agent or controller-export change

Keep structured generation separate from model mutations. Preserve compatible port IDs when refining. Use deterministic fakes for transport/schema tests and clearly label any real-provider smoke test. Never add personal provider credentials to CI.

C export must retain the exact input contract, generated source, timing assumptions, and build evidence. Compilation and behavioral comparison are different checks. A whole-controller or HDL feature needs an explicit boundary/clock design before adding another prompt string.

## Example or documentation contribution

Use `models/examples/` and the existing builders; never copy a personal `projects/workspace.json` directly into a public PR. Keep all blocks on shared size rules, labels readable, routes intentional, and plots selected to explain behavior. Document physical assumptions and demonstrate the model with a real run.

For documentation, link to existing source contracts and remove stale claims instead of adding competing versions. Run `python3 scripts/check-docs.py` and `python3 scripts/check-repo.py`. A useful guide tells the next contributor what to inspect, change, and verify.

## Handoff format

Report the resulting behavior, changed contracts, checks actually run, and known limitations. Include browser evidence for interaction changes and numerical evidence for physics changes. Leave a narrow follow-up task when work exceeds the agreed scope. Do not claim a clean build, tested platform, or solved physics unless you have that evidence.
