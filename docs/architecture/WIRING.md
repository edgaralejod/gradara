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
| Nudge selection | Arrow keys translate selected blocks, wires, and junctions by one grid step (8 units); Shift uses five steps. Key repeats form one undo transaction. Fixed boundary ports retain their positions and normals. |
| Move a junction | A normal junction drag moves its incident runs. |
| Reshape | Select a wire and drag a segment, midpoint grip, or bend handle. A segment moves perpendicular to itself; fixed block ports grow connecting elbows. |
| Reconnect | Drag a selected wire's round endpoint. Preserve the wire ID and the fixed part of its manual route where possible; prune obsolete junctions after commit. |
| Redraw | D locks the logical endpoints and shows the previous route as a ghost. Click to pin runs; Enter or the highlighted destination commits. Crossed wires are not spliced. |
| Auto route | R removes manual routing intent for the selected wire; the sheet router draws it. |
| Delete | Remove the selected wire and clean up orphaned or degree-two junctions. This is not an automatic bypass of a deleted block. |

Target rings indicate an attachment; alignment guides only indicate coordinates. Snapping to an existing X or Y coordinate does not join a net. Invalid joins remain provisional with an inline explanation. Cancel restores the original document, and a completed edit creates one undo entry.

Pointer previews are derived from the gesture's original snapshot and painted locally once per animation frame. Do not put autosave, provider calls, source emission, or history updates in the pointer-move loop. Live drawing uses its free-tail geometry rather than repeatedly invoking the finished-path router.

## Routing and alignment

Wiring geometry lives on the sheet grid ([block design contract](../blocks/DESIGN.md#the-sheet-grid)): every block corner and port is on an 8-unit grid point, so two ports can always be lined up exactly. Exit stubs and detour clearance are two grid steps, the lane past a block's name is five, midlines between lanes are rounded to the grid, and a bend placed by clicking, a dragged run, or a dragged corner that no alignment guide holds lands on the grid.

One sheet router (`lib/gradara/router.ts`) owns every drawn route. `routeSheet(project)` is a pure, cached function of the sheet: block bodies and names, terminals, connections, and pinned bends. Preview, commit, hit testing, and reload therefore always agree; nothing else computes or repairs geometry.

- **Automatic wires** (no pinned bends; `[]` counts as none) leave along the port's exit direction and enter along the destination's normal. The ordinary orthogonal route is used when it is clean. Otherwise the router searches the orthogonal visibility grid of nearby bodies (lines along each body edge with clearance, below each block past its name, and midlines between them) with A*: each step pays its length, a bend, and the sheet's penalties. Block bodies are walls. Running on another net's line is heavily penalized, running along a block's name (or horizontally through its own name) costs more than a short detour, and a crossing costs a little. Running along the wire's own net is cheaper than open space, so branches share a trunk.
- **Order.** Pinned wires are placed first. Automatic wires follow, shortest connection first, then by ID, so the same sheet always draws the same way. A route found from a small neighbourhood is memoized by what lies near it, so a move re-routes only the wires around the moved block.
- **Pinned wires** are the user's drawing: the route through their bends, leaving and entering along the port normals, with any loop cut out. It is used while it is valid (orthogonal, no loop or hairpin, not through any block body). An invalid pinned route is drawn automatically, and the saved-document boundary (`settleRoutes`, in `normalizeProject`) clears its bends, so what is stored is what is drawn.
- No route loops, crosses itself, or doubles back into a terminal. A dot dropped onto a block, or two terminals on top of each other, are the only cases that cannot be kept out of a body.

Physical and signal connections share this geometry; they differ only in connection laws.

While reshaping, the path's stationary runs and endpoints are preferred alignment targets within eight screen pixels. Candidate alignment favors fewer segments, then shorter travel, then proximity. Free drawing excludes its own net from alignment candidates so a new branch does not collapse onto its parent trunk.

Coalesce nearby parallel runs and remove redundant collinear vertices or retraced hairpins. Preserve orthogonality, endpoint normals, real branches, and intentional bends. Block ports remain fixed during wire editing; different endpoint rows still need an elbow. Display, hit testing, and stored geometry must agree after normalization and reload.

## Moving blocks

A dragged block snaps each axis on its own: a connected terminal within 16 units of a horizontal line snaps vertically onto it, and one near a vertical line snaps horizontally, so one drag can straighten a signal wire and a shaft together. The line is the adjacent saved bend when the wire has pinned corners, otherwise the far terminal or junction dot; a far block terminal must face along the same axis. Otherwise the block's corner snaps to the 8-unit grid, which puts its ports on the grid too. A resized block is not pulled onto nearby lines; it keeps the edge you did not drag, and its size changes in 16-unit steps. The drag preview and the saved move use the same rule, so a block lands where the preview showed it (`lib/gradara/placement.ts`).

A moved block carries the first run of each pinned wire (`carryLeads`, `lib/gradara/selection.ts`): the bend at the end of that run shifts with the block across the run, so a vertical lead stays vertical, and the rest of the drawing is kept. If the pinned route still reads badly, the router's rule above applies and the wire becomes automatic. A block moved along its own lead onto or past a junction dot carries the dot ahead of the terminal. Moving blocks with a region selection carries only wires whose both ends move; a wire the region merely touched, with an end on a block that stays, stretches instead of being pushed along. Undo restores the previous geometry.

Junctions attached to an edited endpoint run follow that run perpendicular to its direction. This propagates along straight junction-to-junction paths; every affected branch changes in the same transaction. Moving or resizing a block also carries junctions sharing a whole straight run with the affected port. Conflicting moves on an axis keep the junction in place and bend the incident routes. Incident routes are stretched against the blocks' new positions, and an unpinned wire whose ends line up stays unpinned, so dragging a block away and back restores its junction and wires.

Junction normalization can move an apparent branch point to the first actual divergence of overlapping incident paths, preserving the visible union and connectivity. An unrelated crossing, genuine four-way split, or collision with another terminal must not trigger that cleanup. Apply this rule generally across domain, orientation, stored endpoint order, and zoom.

A newly pinned route overlapping a different net is rejected. Automatic routes go around every block; parallel runs of different nets are kept apart where a lane exists, but two nets may still share a line in a crowded area, and crossings are only discouraged.

## Auto arrange

⌘/Ctrl + Shift + A, or the arrange button in the canvas controls, redraws the selection (two or more blocks) or the whole sheet as one undo step (`arrangeBlocks`, `lib/gradara/arrange.ts`). Placement comes from the terminals, net by net: a net is a rail, a terminal facing right starts it, one facing left ends it, and terminals facing up or down hang under or over it. That gives, per net, an order along x (right-facing, then up/down-facing, then left-facing) and along y (down-facing, then right/left-facing, then up-facing). For signals, only an output feeding a left-side input orders along x: a signal into a top or bottom input is feedback or a measurement, so it only says over or under, and a control loop is never cut through its forward path. Sibling terminals on one net spread along the rail (parallel branches) or stack (fan-out), in flow order.

1. **Columns**: the x orders give each block a column by longest path, after breaking cycles (feedback) greedily in flow order; the current drawing breaks ties. A block nothing orders along x (a ground) takes the column of what it hangs from. Then, within the room its orders leave, each block moves to the weighted middle of what it connects to (a vertical connection counts three times), so a sensor sits between what it measures and what reads it.
2. **Stacks**: in each column, blocks are ordered by the y orders and by the average height of what they connect to, then packed as close to their connections' lines as the spacing allows (least squares, block and name heights respected). Two starts (from the sources and from the sinks) are compared and the one with fewer crossings and straighter connections wins.
3. **Straightening**: connected terminals facing each other are pulled onto one line where that keeps every block and name clear.
4. **Wiring**: every wire touching an arranged block loses its pinned bends. A net with three or more terminals, all arranged, is drawn again: a signal from its source to each input, a physical net as the shortest tree over its terminals. The router draws the rest, and the saved-document boundary turns the runs a net shares into trunks and dots.

Block names return under their blocks. A whole-sheet arrangement starts at the sheet margin and puts section notes in a band above the drawing, in the order of the blocks they were next to; a selection keeps its top-left corner, steps clear of the blocks that stay, and moves its notes with their blocks. Arrange only changes a drawing that it makes read better (`arrangeIfBetter`). `layoutCost` scores a sheet as drawn: overlapping blocks and wires through blocks dominate, then crossings, wires over other blocks' names, bends, and length. Arrange repeats from its own result while that keeps helping, and keeps the new drawing only if it is clearly cheaper (at least 3 percent). Otherwise nothing changes and the workbench says the layout is already as clean as Arrange can make it; that is also what a second press reports. A hand-drawn sheet that is already cleaner, such as the FOC example, is left alone.

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

Net labels are off by default. A net shows its label once it has a custom name, or when **Show name on diagram** is turned on in its properties; turning that off hides even a custom name. Double-click a wire or use F2 to name its net. Enter or blur commits, Escape cancels, and an empty name restores the automatic name. Labels store a wire ID, a fraction of routed length, and a side. Dragging a label or using its arrow keys changes label placement without moving wiring; Home resets placement. If its wire disappears, placement falls back to a suitable surviving run. Block labels use a separate per-instance offset and follow block movement/resizing.

## Subsystem sheets

Each subsystem definition is its own sheet with its own wires, junctions, and nets (see the [model format](MODEL_FORMAT.md#subsystems-and-variants)). Wires never cross sheets; connectivity crosses only through a subsystem port. Every drawing, selection, naming, and net rule above applies unchanged inside a subsystem, because the workbench edits the open sheet as an ordinary document and writes it back as one undo step.

Inside, a port pill is a block with one terminal. An input pill's terminal is an output, so it is the driver of its signal net and counts toward the one-driver rule; an output pill's terminal is an input that the inside must drive; a terminal pill joins a physical net like any physical port. Outside, the subsystem block's ports are ordinary ports with the pill's direction and domain. A pill with no wires takes the domain of the first port you wire it to, if it can carry it (a physical domain for a terminal, signal or Boolean for an input or output). Changing a pill's type or domain later removes its wires inside and the outside wires to its port on every instance; removing a pill removes those outside wires too.

Releasing a wire on the body of a subsystem block (not on a port) adds a port there, as in Simulink: a wire from an output becomes a new input, one from an input a new output, and one from a physical terminal a new terminal of that domain on the side you dropped it. The new pill appears inside in its column, and the wire connects to the new port in the same undo step.

Grouping (⌘/Ctrl+G) cuts every wire that crosses the selection boundary. The outside part keeps the wire ID, so the outside net keeps its identity, name, label, and logging; the inside part is a new wire in a net with the same name. Each cut net becomes one port, named after the net's custom name or the inside terminal, with pills placed level with what they connect to. Junctions whose connected blocks are all selected move inside. Ungrouping reverses this: the inside blocks return with new IDs only where an ID is already taken, and outside wires reconnect to the terminals the ports led to. Copy and paste carry the subsystem definitions a fragment needs; pasting a definition into its own inside is refused.

## Numerical boundary

Signal nets permit at most one output driver; required signal inputs must be connected for simulation. Physical nets join compatible terminals through Modelica potential/flow semantics. The frontend and backend flatten connected components consistently; physical emission uses a unique spanning tree. Ports on the same block remain separate graph vertices.

Waypoints, junction positions, names, and label placement are presentation metadata. Geometry-only changes must preserve emitted connections and simulation identity. Python validates unique net IDs, complete/disjoint wire ownership, connected membership, anchors, and label attachment. See [execution](EXECUTION.md) for compilation and result validity.

## Implementation and verification

| Responsibility | Source |
| --- | --- |
| Pointer ownership and rendering | [net-layer.tsx](../../components/gradara/net-layer.tsx) |
| Drawing/reconnect/redraw transaction | [net-session.ts](../../lib/gradara/net-session.ts) |
| Sheet routing (all drawn geometry) | [router.ts](../../lib/gradara/router.ts), [routing.ts](../../lib/gradara/routing.ts) |
| Auto arrange | [arrange.ts](../../lib/gradara/arrange.ts) |
| Polylines, targets, and anchors | [net-draw.ts](../../lib/gradara/net-draw.ts) |
| Segment editing and junction motion | [net-edit.ts](../../lib/gradara/net-edit.ts), [net-layout.ts](../../lib/gradara/net-layout.ts) |
| Selection and copy gestures | [selection.ts](../../lib/gradara/selection.ts), [copy-drag.ts](../../lib/gradara/copy-drag.ts) |
| Topology, identity, and naming | [net.ts](../../lib/gradara/net.ts), [net-registry.ts](../../lib/gradara/net-registry.ts), [names.ts](../../lib/gradara/names.ts) |

Geometry and graph regressions live in `tests/wiring.test.ts`, `tests/selection.test.ts`, `tests/nets.test.ts`, `tests/drag.test.ts`, `tests/arrange.test.ts`, and `tests/names.test.ts`. Combine them with the [browser acceptance checks](../development/TESTING.md); coordinate tests alone do not establish smooth interaction. Block rotation is implemented; a rotated block's wires are routed afresh. Edge-pan, insertion into wires, flip, lane assignment for parallel wires of different nets, and measured large-diagram performance remain roadmap work.

### Shared terminal runs

At the project normalization boundary, wires that share an actual block terminal and a continuous overlapping route are factored into a shared trunk and explicit junctions. This applies equally to control signals and physical domains, including imported and agent-generated circuits. Junctions use the domain color and support the usual move/branch gestures. Additional leaves attach to existing trunk junctions. Independent crossings never imply connectivity. Normalization preserves terminal connectivity and existing net identities and names; it is idempotent and does not change the generated Modelica connections.
