# Wiring and interaction contract

Gradara uses orthogonal paths, explicit branch junctions, and stable logical nets. Prefer straight horizontal signal paths and predictable manual routing. This document describes the current implementation; planned capabilities belong in the [roadmap](../../ROADMAP.md).

## Ownership and vocabulary

React Flow owns block views, resizing, and the viewport. `NetLayer` owns wire pointer interaction; `NetSession` implements drawing transactions without React or DOM dependencies. Junctions are overlay targets, not React Flow nodes with artificial ports. A pointer gesture has one owner, so wire drawing must not also start canvas selection.

| Term | Meaning |
| --- | --- |
| Port | A block terminal with stable identity, direction, domain, and side. |
| Wire | A saved path between ports or junctions, optionally with manual waypoints. |
| Segment | One horizontal or vertical run of a rendered path. |
| Vertex | A geometric bend. It has no electrical or signal meaning and no junction dot. |
| Junction | An explicit branch connection shared by incident wires. |
| Net | A connected component with persistent identity and optional name/label metadata. |
| Anchor | An alignment suggestion derived from a port or segment coordinate. |

The [model format](MODEL_FORMAT.md) defines the serialized fields. Rendered polylines, hit tests, alignment anchors, and splice locations use the same geometry. Screen coordinates and React Flow view objects never determine numerical connectivity.

## Drawing and editing

| Action | Contract |
| --- | --- |
| Start a connection | Drag from a port, or click it to start a latched connection. The initial run respects the port's exit side. |
| Continue drawing | Release in empty space, then click to pin runs. Only the free tail follows the pointer; pinned corners are not junctions. |
| Complete a connection | Finish on a compatible port, junction, or wire segment. Connected ports take precedence over overlapping wire hit areas. |
| Branch | Drag unselected wire ink, Alt-drag a selected wire, or click/Alt-drag a junction. Splicing and the new branch commit together. |
| Unpin or cancel | Backspace removes the last pinned run and restores its exit direction. Escape cancels the entire provisional edit, including splices. |
| Move a junction | A normal junction drag moves its incident runs. |
| Reshape | Select a wire and drag a segment, midpoint grip, or bend handle. A segment moves perpendicular to itself; fixed block ports grow connecting elbows. |
| Reconnect | Drag a selected wire's round endpoint. Preserve the wire ID and the fixed part of its manual route where possible; prune obsolete junctions after commit. |
| Redraw | D locks the logical endpoints and shows the previous route as a ghost. Click to pin runs; Enter or the highlighted destination commits. Crossed wires are not spliced. |
| Auto route | R removes manual routing intent for the selected wire. |
| Delete | Remove the selected wire and clean up orphaned or degree-two junctions. This is not an automatic bypass of a deleted block. |

Target rings indicate an attachment; alignment guides only indicate coordinates. Snapping to an existing X or Y coordinate does not join a net. Invalid joins remain provisional with an inline explanation. Cancel restores the original document, and a completed edit creates one undo entry.

Pointer previews are derived from the gesture's original snapshot and painted locally once per animation frame. Do not put autosave, provider calls, source emission, or history updates in the pointer-move loop. Live drawing uses its free-tail geometry rather than repeatedly invoking the finished-path router.

## Routing and alignment

Unpinned signal feedback routes use a return rail around the loop's blocks. Explicitly drawn feedback preserves the selected path. Physical connections use acausal orthogonal routing and do not inherit signal-flow direction.

While reshaping, the path's stationary runs and endpoints are preferred alignment targets within eight screen pixels. Candidate alignment favors fewer segments, then shorter travel, then proximity. Free drawing excludes its own net from alignment candidates so a new branch does not collapse onto its parent trunk.

Coalesce nearby parallel runs and remove redundant collinear vertices or retraced hairpins. Preserve orthogonality, endpoint normals, real branches, and intentional bends. Block ports remain fixed during wire editing; different endpoint rows still need an elbow. Display, hit testing, and stored geometry must agree after normalization and reload.

Junctions attached to an edited endpoint run follow that run perpendicular to its direction. This propagates along straight junction-to-junction paths; every affected branch changes in the same transaction. Moving or resizing a block also carries junctions sharing a whole straight run with the affected port. Conflicting moves on an axis keep the junction in place and bend the incident routes.

Junction normalization can move an apparent branch point to the first actual divergence of overlapping incident paths, preserving the visible union and connectivity. An unrelated crossing, genuine four-way split, or collision with another terminal must not trigger that cleanup. Apply this rule generally across domain, orientation, stored endpoint order, and zoom.

The router is not obstacle-aware. Automatic collinear paths use deterministic lanes; a newly pinned route overlapping a different net is rejected. Imported geometry or later block/bend movement can still create overlaps that require manual correction. Never describe coordinate alignment as guaranteed obstacle avoidance.

## Connected selections

`selection.ts` resolves, extracts, translates, and pastes model fragments. Selections include blocks, whole wire records, and junctions. Paths between selected ports retain intervening junctions; unselected block ports define the boundary. Group movement translates internal bends and dots rigidly while external connections stretch. Group snapping uses one translation, preserving relative spacing and off-grid alignment.

Duplication and the in-workspace clipboard share fragment extraction. Copies receive fresh block, wire, junction, and net IDs, with independent nested definitions and label offsets. External branches are omitted; degree-two junctions collapse into bends. Copying signal sinks does not invent a driver or connect them back to the original model.

Ctrl-drag previews a copy of a block or its selected connected group. IDs remain stable throughout the preview; release commits once. A plain Ctrl-click creates nothing. Escape, pointer cancellation, focus loss, or a stale source document discard the draft. Copy alone creates no model edit; Cut, Paste, and Duplicate each create at most one.

Clipboard scope is the current workbench session. Operating-system clipboard exchange, individual-segment selection, and annotation selection are not implemented.

## Names, identity, and labels

Block instance names are unique within a model and case-sensitive: `Step`, `Step1`, `Step2`. Existing distinct names are reserved before repairing collisions; an unchanged block keeps its name when a new or renamed block requests it. Deleting a block does not renumber others. Names are bounded to 100 characters; library definitions are not mutated by instance naming.

`normalizeProject` applies block naming, junction normalization, and `reconcileNets` at the transaction boundary. Net identity is determined from topology and stable endpoints/wire IDs, never from screen overlap. Signal nets anchor at their producer; physical nets retain a stable terminal anchor.

- A split retains the original ID/name on the component containing its anchor. Other components receive new identities. If the anchor disappears, surviving wires and endpoints determine continuity.
- A merge prefers the driver's identity; physical ties are deterministic. Other custom names are retained as aliases. Clearing a custom name also clears its aliases.
- Copies remap net anchors and label wire IDs. Display names can be retained without sharing identity with the original.

Automatic net names derive from the current anchor block and port, such as `Step.y` or `Resistor.p`. Junction-only fragments use numbered fallback names. Renaming a block updates automatic names; custom net names remain fixed. Custom names are optional, bounded to 120 characters, and need not be unique. Names do not create solver variables or propagate through blocks.

The model inspector searches blocks and nets by name, ID, domain, or terminal. Selecting a net highlights all its wires; properties expose its full ID, source/destinations or physical terminals, aliases, and label visibility. Locate fits its connected blocks into view.

Double-click a wire or use F2 to name its net. Enter or blur commits, Escape cancels, and an empty name restores the automatic name. Labels store a wire ID, a fraction of routed length, and a side. Dragging a label or using its arrow keys changes label placement without moving wiring; Home resets placement. If its wire disappears, placement falls back to a suitable surviving run. Block labels use a separate per-instance offset and follow block movement/resizing.

## Numerical boundary

Signal nets permit at most one output driver; required signal inputs must be connected for simulation. Physical nets join compatible terminals through Modelica potential/flow semantics. The frontend and backend flatten connected components consistently; physical emission uses a unique spanning tree. Ports on the same block remain separate graph vertices.

Waypoints, junction positions, names, and label placement are presentation metadata. Geometry-only changes must preserve emitted connections and simulation identity. Python validates unique net IDs, complete/disjoint wire ownership, connected membership, anchors, and label attachment. See [execution](EXECUTION.md) for compilation and result validity.

## Implementation and verification

| Responsibility | Source |
| --- | --- |
| Pointer ownership and rendering | [net-layer.tsx](../../components/gradara/net-layer.tsx) |
| Drawing/reconnect/redraw transaction | [net-session.ts](../../lib/gradara/net-session.ts) |
| Polylines, targets, and anchors | [net-draw.ts](../../lib/gradara/net-draw.ts), [routing.ts](../../lib/gradara/routing.ts) |
| Segment editing and junction motion | [net-edit.ts](../../lib/gradara/net-edit.ts), [net-layout.ts](../../lib/gradara/net-layout.ts) |
| Selection and copy gestures | [selection.ts](../../lib/gradara/selection.ts), [copy-drag.ts](../../lib/gradara/copy-drag.ts) |
| Topology, identity, and naming | [net.ts](../../lib/gradara/net.ts), [net-registry.ts](../../lib/gradara/net-registry.ts), [names.ts](../../lib/gradara/names.ts) |

Geometry and graph regressions live in `tests/wiring.test.ts`, `tests/selection.test.ts`, `tests/nets.test.ts`, and `tests/names.test.ts`. Combine them with the [browser acceptance checks](../development/TESTING.md); coordinate tests alone do not establish smooth interaction. Edge-pan, insertion into wires, rotate/flip, obstacle avoidance, and measured large-diagram performance remain roadmap work.
