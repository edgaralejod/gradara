# Model and interaction core

The root [AGENTS.md](../../AGENTS.md) applies, including [keeping documentation current](../../AGENTS.md#keep-documentation-current). Read the [document contract](../../docs/architecture/MODEL_FORMAT.md) and relevant wiring/design docs.

- Keep model operations immutable and independent of React Flow's view objects. Clone nested definitions when duplicating; preserve IDs when renaming or revising compatible interfaces.
- Reconcile net identities after connectivity changes. Test merge, split, branch deletion, duplication, undo, and label persistence. Do not treat every drawn wire as a separate net.
- Keep signal driver rules and physical connection rules distinct. Geometry never chooses numerical execution order.
- Use shared size and port positioning for hit testing, routes, and rendered pins. Drawn geometry comes only from the sheet router (`router.ts`); pinned bends are the user's hints, kept while valid. Do not add per-gesture route repairs: fix the router or the hint rule instead.
- Update the server contract when changing persisted fields. Presentation-only changes must not alter emitted Modelica or source-derived result identity.
- Add behavior-focused tests to the existing suites for meaningful graph/geometry changes. A coordinate patch that fixes only one saved example is not a general solution.
