# Gradara wiring audit — 13 September 2026

The core single-wire interactions are strong enough to use. The next quality milestone is editing a connected selection as a complete piece of a model, followed by working comfortably beyond one screen. A passing geometry suite and a smooth small diagram do not establish Simulink parity across those workflows.

This is an audit of the current working tree, not a claim of a side-by-side timing comparison with a running Simulink installation. Evidence comes from MathWorks documentation, Gradara browser interaction, source inspection, and isolated in-memory reproductions. The user's diagram was not used for committed test edits. The production interaction code was not changed in this audit.

## The reference material exists

The closest thing to a feature catalog is MathWorks' [Keyboard Shortcuts and Mouse Actions for Simulink Modeling](https://www.mathworks.com/help/simulink/ug/summary-of-mouse-and-keyboard-actions.html). It covers navigation, selection, clipboard operations, connections, naming, and formatting, including contextual hints. Use it to identify tasks, rather than requiring identical key bindings.

The more specific references are:

- [Connect Blocks](https://www.mathworks.com/help/simulink/ug/connect-blocks.html): direct connection, branching, connection previews, and inserting a block onto an existing line.
- [Configure Model Layout](https://www.mathworks.com/help/simulink/ug/configure-model-layout.html): moving a selection with its internal geometry intact, moving selected line segments, rerouting, and block orientation. Its automatic alignment-preservation behavior explicitly excludes branched signals and Simscape connections. Gradara's junction-following behavior can remain an intentional design choice.
- [Simulink.connectBlocks](https://www.mathworks.com/help/simulink/slref/simulink.connectblocks.html): the documented smart orthogonal routing avoids overlapping blocks and signal lines. This is a routing-capability reference, not evidence of measured interactive latency.
- [Configure Model Element Names and Labels](https://www.mathworks.com/help/simulink/ug/configure-model-element-names-and-labels.html): naming wires and moving their labels independently.
- [Highlight Signal Sources and Destinations](https://www.mathworks.com/help/simulink/ug/displaying-signal-sources-and-destinations.html): tracing branches and their producers/consumers, including across hierarchy.

There is already a local design/history document, [WIRING.md](WIRING.md). Its later sections describe the shipped behavior and supersede some early statements. This audit adds explicit priorities and acceptance criteria.

## Verified baseline

- All **90 existing frontend tests pass**, including geometry, branching, normalization, reconnection, straightening, cancellation, and simulation-identity checks. These are primarily model/geometry tests, not 90 automated browser tests.
- Earlier browser validation in this task history covers drag/click connections, pinned routes, branch creation, reconnect/redraw, junction following, segment snapping, label movement, undo/redo, and reload.
- This audit reloaded the current model, exercised an uncommitted drawing session at the canvas edge, and cancelled it. The selection rectangle did not activate. No browser console errors were observed.
- Repeatable diagnostics are in [scripts/audit-wiring.ts](scripts/audit-wiring.ts). Run `node_modules/.bin/tsx scripts/audit-wiring.ts`. They construct independent projects in memory and do not read or write the workspace. The script reports failures as data; it is not included in the passing test suite.

## Implementation update

The first milestone is implemented: connected selection movement and duplication, in-workspace copy/cut/paste, wire/junction region selection, and Ctrl-drag copying. The first two diagnostics now pass; the obstacle-routing diagnostic remains open. See section 17 of [WIRING.md](WIRING.md) for the behavior and remaining boundaries. The findings below record the original audit evidence.

## Findings, in implementation order

### 1. Complete selections: duplication and movement — highest priority

**Reproduced with the actual model operations.** A three-block fixture has one source driving two sinks through one junction. Duplicating all three blocks creates three new blocks, zero new junctions, and **zero of the two intended logical connections**. `duplicateBlocks` in [lib/gradara/project.ts](lib/gradara/project.ts) copies a wire only when both endpoint IDs are selected block IDs. Junction IDs never satisfy that condition.

A second probe passes a whole-selection translation through the same layout, snapping, and junction-following operations used by the workbench. With a `(40, 60)` translation, the junction should move from `(140, 28)` to `(180, 88)`; it moves to `(140, 88)`. Connectivity survives, but the internal geometry is not translated rigidly. Per-block port-following is doing a different job from moving a complete selection.

Marquee selection also operates on React Flow blocks while wires and junctions live in a separate overlay. Individual wire selection exists, but selecting a region does not yet mean selecting the contained block, line, junction, and label geometry together. Clipboard commands for model fragments are absent; the advertised shortcut is Duplicate.

**Implement:** an explicit selection model containing blocks, wire segments, junctions, and annotations, with a graph operation for extracting and cloning a selected subgraph. Internal connections must be remapped to fresh block and junction IDs. Explicitly define the selection boundary: internal geometry translates unchanged; external connections stretch from that boundary. Reuse this operation for duplication, clipboard, later subsystem extraction, and agent-requested edits.

**Acceptance:** duplicate a branched controller with identical internal connectivity and parameters; preserve all internal bends during group movement; allow a wire-only region to move; avoid joining copies back to the original; preserve external connections on movement; undo each operation in one step. Include partial selections, feedback, physical nets, and several junctions. Do not silently reconnect a copied fragment to an external signal.

### 2. Navigation while wiring — next

**Observed in the browser and supported by source inspection.** During a drawing session, moving to x=731 in a 736-pixel-wide canvas leaves the viewport unchanged, including while the draft remains at that edge. `NetLayer` owns the pointer but has no edge-pan loop. Ordinary canvas pan/zoom is implemented; this finding concerns navigation during an active wire gesture.

**Implement:** an edge-pan zone with a short dwell and bounded acceleration. Keep the pointer's screen position and recompute the world-space free tail as the viewport moves. Add an explicit temporary pan action that suspends drawing without pinning a corner or losing the draft. Expose fit-selection and predictable keyboard zoom.

**Acceptance:** connect to an off-screen target without ending the gesture; pan with multiple pinned corners; preserve every corner through zoom/pan; no accidental connection while panning; Escape cancels the entire draft; stop panning on release/cancel or loss of focus. Test every edge and corner at 25%, 100%, and 200% zoom. Edge-pan timing is a proposed Gradara contract, not a timing value specified by MathWorks.

### 3. Read and identify a net — high value for dense diagrams

**Source-inspected gap.** Hover and selection highlight individual wire records. There is no whole-net trace, source/destination action, or saved signal name. Wire records have no signal-label field. Exact-distance ties in `hitSegment` resolve by iteration order; dense crossings need a clearer way to see and choose the intended path.

**Implement:** a clear distinction between highlighting a net and editing one of its segments. Add whole-net highlighting, source/destination navigation, and optional movable signal names. At crowded targets, show exactly which port or net would receive the connection before commit; provide target cycling or another explicit disambiguation action when needed. Give the dot the sole meaning of an actual connection.

**Acceptance:** identify all branches of one signal in the FOC sheet; trace its producer and consumers; retain net names when a path is split, merged, or redrawn; never join crossing nets merely because they overlap visually. Physical-net highlighting should not invent a signal direction.

### 4. Insert and remove a block in a connection — substantial workflow improvement

**Source-inspected gap.** Dropping a library component on wire ink currently uses the ordinary block insertion path. It does not split and reconnect the intercepted wire. Removing a block removes its incident wires; there is no explicit heal/bypass action.

**Implement:** show an insertion preview for a compatible block dropped onto a wire, then commit the block and two replacement connections atomically. Provide a separate remove-and-heal command for unambiguous one-input/one-output signal blocks. Ordinary Delete should retain clear, predictable semantics. Defer automatic bypass for multiport and physical components until their meaning is explicitly defined.

**Acceptance:** insert a gain or limiter in an existing branch while preserving the other sinks; preserve labels and routing where possible; cancel the preview without changes; undo once. This also gives the agent a useful typed command: insert a block into a chosen connection, with the same preview and transaction as the GUI.

### 5. Local routing around obstacles — real gap, larger implementation

**Reproduced with the router.** A direct wire from `(64, 28)` to `(300, 28)` passes through an unrelated block occupying x=140..232, y=0..64. Auto route returns that same obstructed path. The present router handles port approaches, feedback rails, simple lanes, and manual edits; it is not an obstacle-avoiding router.

**Implement:** deterministic orthogonal routing with block clearance, stable tie-breaking, and costs for bends and unnecessary path changes. Start with the edited connection and an explicit reroute action. Preserve intentional pinned regions. If no clear route exists, expose the conflict instead of silently moving unrelated geometry. Consider a worker and a spatial index after measuring the workload.

**Acceptance:** route around one block, a narrow passage, multiple obstacles, and nearby unrelated nets; retain endpoint normals and junction membership; cancel/undo exactly; avoid whole-sheet route churn when one block moves. Full automatic diagram arrangement is a separate feature and can wait.

### 6. Orientation, keyboard access, and scale — explicit follow-up gates

**Source-inspected gaps / unmeasured areas.** Block rotation and flipping are absent, although port sides are supported. There is no complete keyboard path for selecting and editing wires. Current shortcuts and hints are useful but incomplete. Large-sheet frame timing, long-session stability, Windows/Linux input differences, and touch/pen behavior have not been established by this audit.

Rotation/flipping should transform port geometry and readable labels, then use existing layout operations; a CSS-only transform would be incorrect. Keep model editing shortcuts distinct from text inputs, the equation editor, and the browser. Add discoverable actions before accumulating more special modifiers.

## Turn “feels good” into a repeatable bar

Use fixed task fixtures and record success, unintended changes, recovery, and latency. Compare the same task outcomes against documented Simulink behavior; a later hands-on comparison can assess timing and gesture count. Avoid a single percentage-of-Simulink score.

| Fixture | Acceptance task | Evidence today |
|---|---|---|
| Small source → sum → gain with feedback | Connect, branch, redraw, reconnect, straighten, undo, reload | Strong existing geometry tests and browser checks |
| Several dots on one trunk, rotated and mirrored | Move any run without leaving dots behind or changing connectivity | Existing tests and recent browser checks |
| Complete branched controller selection | Move, duplicate, copy/paste, preserve boundary connections | Duplication and rigid-movement failures reproduced |
| Two nearby or crossing nets | Choose target, inspect whole net, never create accidental join | Logical non-joining covered; dense target UX and trace incomplete |
| Controller sheet wider than the viewport | Finish one wire across the sheet while panning/zooming | Edge-pan gap observed |
| Block placed in a crowded corridor | Insert into a wire and reroute locally | Insertion missing; obstacle route failure reproduced |
| Existing FOC example | Repeat common edits using mouse and keyboard | Useful next realistic acceptance fixture; no parity timing claim |
| Synthetic 100-block/200-path and 500-block/1,000-path sheets | Drag, pan, splice, undo repeatedly | Proposed load targets; not measured here |

Proposed performance targets on a declared reference machine/browser: aim for p95 application work within a 16.7 ms frame budget on the normal fixture; zero repeated long tasks above 50 ms during drag; measure pointer-to-paint latency separately; keep ordinary edit completion below 100 ms. These are Gradara targets, not reported measurements or MathWorks guarantees. Record display refresh rate, zoom, visible/total element count, browser, and input device. A screenshot cannot verify smoothness.

Every completed edit should be one transaction shared by the GUI and agent commands. Combine geometry/property tests with a small real-browser gesture suite. Test cancellation, focus loss, selection ownership, autosave/reload, and typing shortcuts in text fields. Geometry-only edits must preserve the flattened logical net.

## Decision

Build **complete selection movement and cloning first**, using the two reproduced failures as acceptance cases. Then add navigation during wiring and whole-net inspection. Follow with insert-into-wire and local obstacle routing. Continue using the existing wire gesture engine rather than replacing it.

Keep the deliberate orthogonal drawing model, domain-colored ports, explicit branches, and movable labels. Diagonal wiring, bulk auto-connect heuristics, Goto/From-style indirection, elaborate bus tools, and global auto-layout can be deferred. Typed buses and hierarchy deserve their own architectural milestones; they are not small wiring-polish tasks.
