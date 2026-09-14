# Model and interaction core

The root [AGENTS.md](../../AGENTS.md) applies. Read the [document contract](../../docs/architecture/MODEL_FORMAT.md) and relevant wiring/design docs.

- Keep model operations immutable and independent of React Flow's view objects. Clone nested definitions when duplicating; preserve IDs when renaming or revising compatible interfaces.
- Reconcile net identities after connectivity changes. Test merge, split, branch deletion, duplication, undo, and label persistence. Do not treat every drawn wire as a separate net.
- Keep signal driver rules and physical connection rules distinct. Geometry never chooses numerical execution order.
- Use shared size and port positioning for hit testing, routes, and rendered pins. Preserve explicit manual routes and the difference between absent and empty waypoints where supported.
- Update the server contract when changing persisted fields. Presentation-only changes must not alter emitted Modelica or source-derived result identity.
- Add behavior-focused tests to the existing suites for meaningful graph/geometry changes. A coordinate patch that fixes only one saved example is not a general solution.
