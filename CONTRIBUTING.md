# Contributing to Gradara

Help make graphical simulation pleasant, trustworthy, and easy to extend. Useful contributions include small interaction fixes, well-tested blocks, realistic examples, documentation, accessibility improvements, and reproducible platform testing. See the [roadmap](ROADMAP.md) for bounded starting points.

## Choose a useful change

For a bug, provide a minimal reproduction and the expected behavior before changing code. For a new block, state its ports, units, equations, assumptions, and a small executable example. For architecture changes, explain the constraint the existing design cannot satisfy and the migration impact.

Small fixes and documentation improvements can go directly to a pull request. Discuss substantial schema, dependency, engine, or interaction redesigns in an issue first so contributors do not build incompatible approaches. There is no blanket approval requirement for routine local fixes.

The repository is hosted at [edgaralejod/gradara on GitHub](https://github.com/edgaralejod/gradara). Fork it, create a branch in your fork, and open a pull request against `main`. Keep one coherent change per PR. Use [issues](https://github.com/edgaralejod/gradara/issues) for reproducible bugs, feature proposals, and substantial design discussions.

## Development workflow

1. Follow [setup](docs/development/SETUP.md). Pure frontend work and backend unit tests do not require an AI account.
2. Read the [architecture](ARCHITECTURE.md), [agent/repository guidance](AGENTS.md), and relevant subsystem docs.
3. Implement the change using existing model operations and shared visual primitives. Preserve legacy documents and user geometry.
4. Run appropriate [tests and manual checks](docs/development/TESTING.md). Add a regression for a behavior or contract that could break, rather than a test that simply repeats the implementation.
5. Update user/developer docs where behavior changed. Generate a local catalog report when reviewing block changes; do not commit generated reports or session logs.
6. Review your diff for unrelated formatting, generated files, private models, and license notices. Fill in the PR template on GitHub with what changed and how it was checked. Keep the git commit and merge messages short; the template is not the commit.

The core checks are TypeScript typecheck/tests/build, Python tests without the integration marker, documentation links, and repository hygiene. Real-engine tests run separately when relevant. Whole-repository lint has an existing backlog and is currently advisory; keep new code clean and report pre-existing failures honestly.

## Design standards

- Read the [block design contract](docs/blocks/DESIGN.md) before changing a block or palette specimen. Reuse `BlockFace`; keep compact engineering notation and shared geometry.
- Read the [wiring contract](docs/architecture/WIRING.md) before changing gestures or route normalization. Generalize the rule and test different positions, zoom levels, port sides, branches, undo, and reload.
- Keep UI interactions local and responsive. Do not introduce backend or provider latency into direct manipulation.
- Keep equations, connector laws, and result validity separate from layout. Physical blocks require a real backend implementation; visual color is not a solver contract.
- Keep model edits immutable and undoable. Migrations preserve original user data and stable identity.

## AI-assisted contributions

AI-assisted work is welcome and reviewed to the same standard as other work. The contributor remains responsible for understanding the change, checking behavior, attribution, and the accuracy of the PR. Use [AGENTS.md](AGENTS.md) and the [playbooks](docs/agents/PLAYBOOKS.md) to give an agent a bounded task and clear acceptance criteria.

Summarize material agent involvement and any generated equations or export assumptions when that helps review. Do not attach private prompts, chain-of-thought transcripts, credentials, or unrelated provider output. A concise explanation, the patch, and evidence are sufficient. Do not submit an unreviewed agent transcript as a design document.

## Reviews and communication

Lead PR descriptions with the user-visible problem and resulting behavior. For UI changes include a screenshot or short recording made with a synthetic model; for simulation changes include numerical evidence and diagnostics. State which checks ran and which did not. Maintainers may ask for a smaller scope, a regression, or compatibility changes.

Keep `git log` readable. The GitHub PR can hold the template, checklists, and evidence. Commits and merge commits should be a short subject plus a few sentences, without HTML, agent footers, or a pasted PR body. Agents follow the same rule in [AGENTS.md](AGENTS.md).

Follow [community expectations](CODE_OF_CONDUCT.md). Report security-sensitive findings privately using [SECURITY.md](SECURITY.md), rather than posting exploitable details or private models in an issue.

## Licensing

Contributions intentionally submitted for inclusion in Gradara are provided under [Apache-2.0](LICENSE), unless explicitly stated otherwise, consistent with section 5 of the license. You retain ownership of your contributions and must have permission to contribute their contents. No copyright assignment, CLA, or sign-off is required.

Preserve [NOTICE](NOTICE), all [third-party notices](THIRD_PARTY_NOTICES.md), and existing file-level licenses. Identify copied or adapted upstream material and its terms in the PR; the project license does not override them. New original source files should carry an `SPDX-License-Identifier: Apache-2.0` comment where the file format permits comments.
