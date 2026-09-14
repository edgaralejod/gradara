# Wiring and routing — vision, plan, and what we tried

Written 12 September 2026 after a stretch of incremental wiring work that did not reach a usable drawing feel. This is the product spec for nets, plus an honest record of the attempts, so the next pass can implement the plan instead of inventing another heuristic.

**Quality bar:** Simulink’s *feel* (nets, T-branches, feedback loops) with Altium’s *drawing contract* (pin exit, orthogonal rubber-band, click pins a run). Not LabVIEW. Not a generic graph editor.

**Status:** core drawing, branching, reconnection, route editing, straightening, connected group movement/duplication, wire-region selection, net inspection, and automatic/custom naming are implemented. Sections 12–19 describe the current implementation; the earlier sections preserve the original design and investigation. The [Simulink-based audit](WIRING_AUDIT.md) records findings, implementation progress, and acceptance criteria. Edge-pan, obstacle avoidance, fine-grained segment/annotation selection, and large-diagram/device testing remain open. See the [current architecture](ARCHITECTURE.md) and [model format](docs/architecture/MODEL_FORMAT.md) for document ownership and persistence boundaries.

Related: [ARCHITECTURE.md](ARCHITECTURE.md) (canvas vs model ownership), [VALIDATION.md](VALIDATION.md) (FOC/DC demos).

---

## 1. The problem we were actually solving

A controls engineer should be able to:

1. Draw **straight, orthogonal, left-to-right** signal paths.
2. Close a **feedback loop** as a U under the chain, not a reverse line through the blocks.
3. **Tap a net** (drop on the ink, or pull a branch off a wire) and have a real T-node that moves with its branches.
4. **Draw** a wire like Altium: the pin dictates the first segment; a click freezes that run at the distance drawn; only the unfixed tail follows the mouse.
5. Use **existing net coordinates as snap suggestions** (anchors) for the free end — without joining nets unless they drop on the ink.

The demo that never quite worked: Step → Subtract, pull a branch off the wire (or from a node on it), draw up and around, land on the unused input. The live wire collapsed beside the existing trunk, and clicks spawned node graphics.

---

## 2. Vocabulary (use these words)

| Term | Meaning | Visible graphic? |
|---|---|---|
| **Port** | A pin on a block. Has a side: left / right / top / bottom. | Port handle |
| **Net** | One signal or physical identity. Made of segments. | No |
| **Segment** | One axis-aligned run (horizontal *or* vertical). Has a **coordinate**: `y` if horizontal, `x` if vertical. | The ink |
| **Vertex** | A corner where two segments of the *same* path meet. Created by a click while drawing, or by auto-route. | **No.** Never a node blob. |
| **Junction** | A topological T (or +) where **three or more** segments meet. | **Yes.** Small filled dot. Only then. |
| **Anchor** | A snap suggestion: any segment coordinate already on the sheet, plus port coordinates. | Optional faint guide while drawing |
| **Exit** | Forced first-segment direction of a port (right pin → always leave horizontally right). | No |

**Click = pin a vertex. It does not create a junction graphic.** A junction graphic appears only when a third segment joins that point.

---

## 3. Product spec

### 3.1 Drawing (Altium)

1. Press on a **port**. The first segment is locked to that port’s side. A right-side output cannot leave upward.
2. Move the mouse. Only the **unfixed tail** auto-places: exit in the pin direction (minimum stub ~20 px, never reverse into the block), then one orthogonal elbow to the cursor.
3. **Click empty canvas** = freeze that tail at the distance you drew. That corner is a **vertex**, not a junction. No dot. The next tail starts from there, leaving in the direction you just arrived.
4. Click again to pin another vertex.
5. Click a **compatible port**, an existing **junction**, or **drop onto a segment** to finish. Esc cancels. Backspace unpins the last vertex.

Live wire is always: `[port → pinned vertices → rubber-band to cursor]`.

Live drawing must **never** call the finished-path router (return rail, mid-X Manhattan). That is why the wire hugged the existing net: the live preview used the same function as committed edges.

### 3.2 Anchors (snap suggestions)

Every committed net contributes anchors:

- Horizontal segments → their **Y**
- Vertical segments → their **X**
- Ports → both X and Y

While drawing, the cursor magnetizes to nearby anchors (~8 px). Alignment guides are faint hairlines. Snapping to a coordinate does **not** join nets. Joining happens only by finishing on a port, a junction, or dropping onto a segment.

Ignore anchors of the path being drawn (no self-snap onto the trunk you just left).

### 3.3 Branching (Simulink)

- Drop a live wire onto an existing segment → insert a **junction** at the hit, splice, attach. *This* is the node graphic.
- Drag from a segment → same.
- Drag the junction → all incident segments follow.
- Second wire from the same output: **do not** auto-insert a blob in the middle of the first wire. Two segments may leave the pin, or a junction sits **8 px outside the pin** on the exit axis.
- A junction is **not** a driver. Pulling a branch off it **extends the same net**. It must not re-attach to segments it already belongs to.

### 3.4 Feedback U

A **back-edge** is topological (output into an upstream input / block to the left), not merely `sourceX > targetX`.

- No user vertices → auto U around the **bounding box of the blocks in the loop**, rail ~48 px below the lowest block — not 32 px below the ports.
- User pinned vertices → honor the drawing.

### 3.5 Overlap

- Shared trunk (same net, same segment) **must** share X/Y — one piece of ink.
- Distinct nets must not occupy the same pixels. Offset one lane (8 px) or let anchors keep them apart.
- Auto mid-wire trunk insertion is banned.

### 3.6 Signal vs physical (same canvas, two laws)

| | Signal / control | Physical / circuit |
|---|---|---|
| Driver | Exactly one output per net | Acausal; many pins on one net |
| Default flow | Left → right | Schematic; rotation later |
| Back-edge | U around blocks | No U; ortho only |
| Drop on segment | Junction + fan-out to a **sink**. Magnet to a pin only if the pointer is within ~16 px of that pin. | Junction; pin joins the net |

Do **not** magnet an output onto “some free input on this net” from a vague drop on the trunk. That mixed feedback with shorting.

### 3.7 Gesture table

| Gesture | Result |
|---|---|
| Click empty while drawing | Pin vertex. **No graphic.** |
| Click port | Finish wire. |
| Click existing junction | Finish onto that net. |
| Drop onto a segment | Create junction graphic + splice. |
| Esc | Cancel drawing. |
| Backspace while drawing | Unpin last vertex. |
| Double-click empty | Add block. Not a net node. |

No “Continue this path” / insert-block dialog while drawing a wire.

---

## 4. Data model (authoritative)

```
PortRef    = { blockId, portId }
End        = PortRef | { junctionId }

Junction   = { id, x, y, domain }     // T-points only
Vertex     = { x, y }                 // corners; not objects

Path       = {
  id,
  from: End,
  to: End,
  vertices: Vertex[],                 // empty ⇒ auto-route this path
}
```

Simulation identity still flattens to port–port `connect` pairs. Junction positions and vertices are layout. They do not change Modelica.

Keep React Flow for **blocks**, pan, and zoom. Do **not** implement junctions as React Flow nodes with fake handles. Junctions are overlay hit-targets. Pointer-rate drawing is a canvas overlay, not RF’s connection line.

---

## 5. Routing policies

**Live**

```
rubberBand(origin, cursor, exit):
  first segment MUST go in `exit`
  min stub ~20 px, never reverse into the block
  then one orthogonal elbow to the cursor
  magnet cursor and elbow to nearby anchors
```

**Click (pin)** — freeze that geometry; new origin = click; new exit = last segment direction. No Junction.

**Commit**

- Vertices present → port → vertices → end.
- No vertices + signal back-edge → U around loop bbox.
- Else → rubber-band from start port exit to end (straight if aligned).

---

## 6. Interaction state machine

```
Idle
  press port        → Connecting (origin=port, exit=port.side)
  press junction    → Connecting (origin=junction, exit=toward mouse)
  press segment     → Connecting (create Junction at hit, then as above)

Connecting
  move              → rubberBand + anchors
  release on port / junction / segment → Commit
  release empty     → Drawing
  release < 16 px from start → Cancel

Drawing
  move              → rubberBand + anchors
  click empty       → Pin vertex, continue
  click port/junction/segment → Commit
  Backspace         → unpin
  Esc               → Cancel
```

---

## 7. What we tried (chronology)

Incremental patches, in order. Each fixed a screenshot and created the next.

1. **SmoothStep / orthogonal edges** — always jogged, even when ports already shared a line.
2. **Straight if aligned + snap blocks to port Y** — forward paths looked better; feedback became a reverse straight line through the chain.
3. **Return rail if `sourceX > targetX`** — live preview used the same router, so a branch pulled off a mid-wire node collapsed parallel to the trunk (rail was port-Y + a few pixels, not around the blocks).
4. **`shareTrunk`** — second wire from an output auto-inserted a junction in the middle of the first wire. That is the Step→Sum screenshot with a blob on a straight run.
5. **Junctions as React Flow nodes** — fake Top handle; branches left upward. Empty `junctions = []` as a new array every render caused a **maximum update depth** loop (fixed with a stable empty list).
6. **`attachAt` magnet to “free input on this net”** — dropping near the driving net attached the output to the unused sum input *or* shorted both sum inputs, and stole drawing clicks.
7. **Same-net exclusion** — helped tests; in the browser, RF `onConnectEnd` + pane click + overlay still fought.
8. **NetSession refactor** (this plan’s first implementation pass) — coordinate-driven session, rubber-band, pin-on-click, overlay junctions, bbox U, `shareTrunk` removed. Unit tests against **known block positions** pass. Pointer integration in `page.tsx` still mixes React Flow connection gestures with the session, so the live canvas did not match the spec.

**Lesson:** do not implement drawing inside React Flow’s connection line *and* a parallel session. One owner. Tests that call `pressPort` / `move` / `click` with numbers are the contract; the UI must be a thin adapter to that session.

---

## 8. What is in the tree today

| Piece | Role | Trust it? |
|---|---|---|
| `lib/gradara/net-session.ts` | Pointer-free state machine: press / move / click / release / splice | Yes, for tests |
| `lib/gradara/net-draw.ts` | Rubber-band, anchors, bbox U, hit tests | Yes, for tests |
| `lib/gradara/routing.ts` | `rubberBandPoints`, `pinRubberBand`, leftover return-rail | Rubber-band yes; do not use return-rail for live preview |
| `lib/gradara/net.ts` | Flatten to port–port; occupancy | Keep |
| `lib/gradara/wires.ts` | Older attach/branch helpers | Treat as legacy |
| `components/gradara/net-layer.tsx` | Overlay: live path, guides, draggable junctions | Intended view |
| `components/gradara/junction-node.tsx` | RF tap node | Do not use |
| `app/page.tsx` | Still wires RF `onConnect` / `onConnectEnd` into the session | The remaining gap |
| `tests/wiring.test.ts` | Spec cases 1–10 on a Step/Sum/Gain sheet at `y = 68` | Source of truth for geometry |

`page.tsx` must not own the drawing state machine. Drawing lives in the net layer. The session is how we validate without mouse computer-use: build a diagram from coordinates, assert first-segment direction, vertex count, junction count, U rail Y, flatten pairs.

---

## 9. Acceptance (not done until these work in the browser *and* in `tests/wiring.test.ts`)

1. **Pin exit.** Drag from Step’s right port, move up. First segment is horizontal.
2. **Click pins a run, no blob.** Click empty while drawing. Corner in the path. No filled node.
3. **Anchors.** Second wire’s elbow snaps to the first run’s Y when close. Does not join unless dropped on the ink.
4. **Drop on ink.** From a new input, drop on Step→Sum. Junction graphic. Drag the dot; branches follow.
5. **Feedback U.** Step → Sum → Gain, then Gain output to Sum’s unused input in one gesture. Wire goes **under the blocks**.
6. **Drawn feedback.** Same loop, click twice below to place your own U. Vertices honored. No extra dots.
7. **Branch from node.** Pull off a junction, click a corner, land on a free input. Tail does not collapse onto the parent wire.
8. **Cancel.** Esc leaves the sheet unchanged.
9. **No overlap of distinct nets** unless they are the same net.
10. **Modelica.** Flattened `connect` ignores vertices and junction positions. One driver per signal input.

---

## 10. Next implementation pass (do this, not more patches)

1. Make `NetSession` the **only** owner of Connecting/Drawing. React Flow reports pointer coordinates; it does not route.
2. Delete RF tap nodes, `shareTrunk`, live `wirePath` for previews, `attachAt` magnet-to-free-input.
3. Keep `tests/wiring.test.ts` as the gate. Add cases whenever a screenshot fails — reconstruct the screenshot as numbers, then fix the session, then the adapter.
4. Only after the session matches the spec under tests, thin `page.tsx` to `press` / `move` / `click` / `release`.

Non-goals for that pass: buses, rotating passives, obstacle-avoiding autorouter, wire labels, segment-slide of a whole run, subsystems.

---

## 11. Why this belongs in the repo

The workbench can already simulate FOC. Wiring is the interaction that makes it feel like an engineering tool. We spent a session proving that **edge-local heuristics will not get there**. The model is a **net with segments, vertices, anchors, and rare junctions**. Implement that, and test it with coordinates, not with hope and a mouse.

## 12. Implemented — September 12, 2026

The canvas now uses a single `NetLayer` pointer adapter and `NetSession` transaction. React Flow owns blocks, resizing, selection, and the viewport; it no longer owns connections or renders junction nodes. Committed paths, segment hit tests, alignment anchors, and splice geometry use the same cached polylines. Pointer movement is painted locally once per animation frame; history and autosave receive completed edits only.

Interaction contract:

- Drag a port onto a compatible port or existing wire. Connected ports take precedence over overlapping wire hit areas.
- Drag wire ink to pull out a branch. Release in empty space to continue drawing; click empty space to pin geometry, then click a port or wire to finish.
- Click a junction to start a branch, or Alt-drag it. A regular drag moves the junction and its incident runs.
- Backspace removes the entire last pinned run and restores its exit direction. Escape cancels the whole gesture, including provisional splices. Each completed gesture is one undo step.
- Select a wire to reveal bend handles; drag a handle to reshape it. Delete removes the selected wire and cleans up orphaned/degree-two junctions. R restores automatic routing.
- Port and wire target rings indicate attachment. Thin alignment guides only align. Invalid joins stay in the drawing session with an inline explanation; they do not issue global error notifications.

Important fixes discovered through browser use: React Flow's coordinate conversion inherited the block grid and rounded wire drops away from visible ink; wiring now explicitly disables that rounding. Collapsing side panels also displaced the canvas into a zero-width grid column; the three layout columns are now explicit. A stretched, transparent Create block container was intercepting clicks across the right side of the sheet; its hit area is now limited to the button, which hides during drawing.

The execution boundary remains serialized ports, wires, and junctions. Frontend and Python backend flatten each connected component consistently. Signal drivers are validated across junctions; physical nets emit a unique spanning tree. Geometry, lane placement, and junction motion do not affect the resulting Modelica connections.

Validation: coordinate regression tests plus hands-on browser checks of direct connections, feedback U routing, port-to-wire snapping, junction dragging, pinned branches, unpin/cancel, connected-port priority, driven-net rejection, bend editing, delete/cleanup, undo/redo, and pulling a branch from wire ink at a different zoom. The saved Wiring playground runs in OpenModelica; the scope follows the gain output and the display follows the reference. Existing DC and FOC engine integration checks remain in the suite.

Remaining limits: this is not an obstacle-avoiding router. Automatic collinear runs receive deterministic lanes; an explicitly pinned route overlapping another net is rejected rather than silently changing the user's bends. Existing imported geometry or moving a block/bend can still produce an overlap and may need rerouting with R. Buses, hierarchy, and rotation remain outside this pass. Touch/pen and large-diagram performance need dedicated device/scale testing before claiming Simulink-level parity.


## 13. Connection editing — September 12, 2026

The wire selection toolbar exposes Redraw (D), Auto route (R), and Delete. Selecting a wire shows round reconnect handles, small midpoint segment grips, and square bend handles. Dragging a selected wire slides that run perpendicular to itself; endpoint runs grow doglegs without moving ports. An unselected wire still branches on drag, and Alt-drag explicitly branches even when selected. Clicking a port starts a latched connection, so both click-to-click and drag-to-connect work.

`NetSession.reconnect()` detaches one path in a provisional document, retains its fixed hand-routed portion, and commits a replacement with the original wire ID. Dropping on wire ink performs the same route-preserving splice used by new connections. Obsolete junctions are pruned after commit; the edited wire ID is preferred when merging degree-two paths. Illegal joins remain provisional, and cancel restores the original document identity.

`NetSession.redraw()` locks the logical endpoints. The original route appears as a ghost; clicks pin the new route and Enter or clicking the highlighted destination commits it. Crossed wires are never spliced in this mode. Redrawing changes geometry only. `net-edit.ts` provides pure segment sliding and vertex movement, with cached anchor sets per gesture. Geometry caches are never mutated by handle edits.

Browser checks cover dragging straight runs, both endpoint reconnects, click-to-click creation, free drawing, Enter completion, cancel via Escape and the toolbar, invalid reconnection, reconnecting onto wire ink, branch cleanup, and single-step undo. A captured drag can omit the browser's click event, so stale click suppression is cleared at the next pointer-down. Closely stacked opposing ports get a two-leg route instead of doubling back through a port, and a manually drawn tail turns at its last pinned corner.

The remaining limits in section 12 still apply to obstacle avoidance, imported geometry, and large-diagram/device testing. Whole-segment sliding and endpoint/redraw editing are now implemented.


## 14. Prefer straight runs; movable names — September 13, 2026

Editing now treats the path's own stationary runs and endpoints as the highest-priority alignment targets within 8 **screen** pixels. This is intentionally different from free drawing, where self-snapping remains excluded. If several alignments are possible, fewer segments wins, then shorter travel, then the nearest coordinate. Nearby parallel runs coalesce onto the chosen coordinate; redundant collinear vertices and hairpins disappear from the stored route. Corner handles use the same capture radius and guides. Coordinates stay exactly orthogonal: endpoint ports and real junctions never move to hide an offset. Different endpoint rows therefore still need an elbow, and endpoint escape directions remain respected. The conventional left-to-right signal layout is retained.

Pure geometry lives in `net-edit.ts`; the pointer adapter continues deriving each preview from the gesture's original document. A run can collapse during dragging without losing pointer capture or accumulating new vertices. Completion is one undo transaction, and cancel restores the original. Regression cases include multiple nearly aligned runs, subpixel jogs taken from the actual workspace, backtracking, 20 repeated bend/straighten cycles, corner editing, feedback escapes, junction preservation, vertical physical wires, and tolerance at four zoom levels.

Block names have an optional per-instance `labelOffset`, relative to their normal centered position below the symbol. `BlockLabel` previews its own drag and commits once on release. Names render in a separate viewport layer above the wire hit areas, so even a name sitting on a wire can be grabbed. They follow block motion and resizing, support arrow-key nudges, and reset on double-click or Home. Pointer ownership transfers back to the wire layer when a wire is clicked. Both Python and TypeScript retain the serialized offset while excluding it from simulation identity.

## 15. Gesture ownership and retraced bends — September 13, 2026

React Flow's delegated capture handler runs before native listeners attached to `.react-flow`. Previously, clicking the empty canvas to pin a wire bend could start its selection rectangle before `NetLayer` stopped the press. Wiring now claims presses at window capture, scoped to this canvas, and consumes movement for its active gesture. Ordinary canvas presses pass through to React Flow. This also prevents Shift-selection from stealing a port, branch, or redraw gesture; selection remains available after cancellation.

Moving a block could make a completed route double back from an old pinned corner, leaving a vertical spur with no junction. `simplifyRoute` now removes those collinear retraced sections in the shared committed-path calculation, with guards for both port normals. Rendering and hit testing therefore use the same cleaned path during movement and after reload. Useful bends, real junctions, and the saved routing intent remain intact. Wire editing uses the same simplifier.

Regression tests cover either endpoint moving, partial and complete retracing, repeated moves, resize, physical ports, immutable cached geometry, and preservation of real branches. Browser checks reproduce the original marquee conflict and vertical spur, then verify drawing, Shift-started drawing, redraw, cancel, ordinary marquee selection, and undo with the fixes.

## 16. Junctions follow their run — September 13, 2026

Block ports remain fixed during wire editing, but junctions are part of the edited run. Moving an endpoint run now carries its junction perpendicular to the run and stretches every incident wire in the same transaction. This propagates across straight junction-to-junction paths, so a trunk with several branch dots moves as a unit. Horizontal and vertical runs, either stored wire direction, and physical and signal domains use the same rule. Corner editing carries junctions on its adjacent endpoint runs too. Moving or resizing a block carries junctions when the affected port shares a whole straight run with them; conflicting moves on the same axis leave the junction in place and bend the routes.

`net-layout.ts` owns these net-wide operations. It also canonicalizes old shared detours: if all but one paths incident to a junction initially overlap, the dot slides to their first divergence and the incident paths are trimmed or extended along existing ink. This preserves the visible union and connectivity while moving the dot onto the actual T. A genuine four-way split, an unrelated crossing, or a move that would merge the dot with another junction or port cannot trigger this cleanup. The canonical geometry is used on load, import, document commit, and in transient block-drag previews; it is saved as normal junction positions and waypoints, with no solver changes.

This supersedes the fixed-junction rule in section 14 for junctions attached to the run being edited. Undo/cancel still restore the whole transaction, including the incident paths. Tests cover rotated and mirrored layouts, reversed storage, multiple dots, multi-bend shared detours, conflicting block moves, port/junction preservation, repeated movement, and reload without the geometry cache. Browser validation includes repairing the supplied example, horizontal and vertical run dragging, snapping a branch straight, moving its block, and undo/redo.

## 17. Connected selections and Ctrl-drag — September 13, 2026

`selection.ts` is the shared model boundary for resolving, extracting, translating, and pasting a selection. Blocks, whole wire records, and junctions participate. Paths between selected ports retain the intervening junctions; unselected block ports form the boundary. Group movement translates internal bends and dots rigidly while external connections stretch. Preview and release both call `layoutSelection`, and React Flow group snapping uses one delta so off-grid port alignment survives. Single-block moves retain the existing alignment and junction-following behavior.

Duplication and the in-workspace clipboard use the same fragment extraction. Internal block/junction/wire IDs are regenerated, nested definitions and label offsets are copied, external branches are omitted, and degree-two junctions collapse into bends. A fragment containing only signal sinks leaves their inputs open; physical nets require no invented driver. Explicitly saved empty waypoints preserve straight routes instead of requesting automatic lane allocation.

The marquee now includes wires and dots. Drag a selected wire in a region/group selection to move that selection; ordinary single-wire selection retains segment editing. Select All includes every block, wire, and dot. Copy, Cut, Paste, and Duplicate each create at most one document edit; Copy alone creates none. Copy/Paste buttons are available beside Undo, and shortcuts are listed in Help. Clipboard scope is the current workbench session; operating-system clipboard exchange and annotation/individual-segment selection remain separate follow-ups.

Hold **Ctrl and drag a block** to place a copy. If that block belongs to the selected group, the entire selected block fragment is copied with internal wiring. Originals remain in place during the preview. Fresh IDs remain stable throughout the drag. Release commits once; Escape, pointer cancellation, or focus loss discards the draft. A plain Ctrl-click creates nothing. The pointer owner is isolated in `copy-drag.ts`, with React rendering in `CopyDragLayer` and `SelectionPreviewContext`; pointer previews stay below workbench autosave/history/results.

Regression coverage includes branched and partial duplication, undirected physical nets, feedback and multiple junctions, boundary stretching, off-grid group movement, repeated translation, wire-only regions, independent clipboard snapshots, and the actual Ctrl-drag pointer owner with zoom, release, cancellation, and stale-document protection. Browser checks cover connected duplication, group movement, region selection, clipboard buttons, and undo/redo. Edge-pan, net tracing/names, insertion into wires, and obstacle-aware routing remain subsequent audit milestones.

## 18. Logical nets, model inspector, and signal labels

The model inspector browses and searches blocks and nets by name, ID, domain,
or connected block/port. Selecting a net highlights every drawn wire in that
connection. Properties show its full copyable ID, source and destinations (or
physical terminals), name, and label visibility. Locate fits the connected
blocks into view. Unconnected ports do not become nets until they are wired.

Double-click any wire section to name its net; F2 or the wire toolbar's Name
action also opens inline editing. Enter or blur commits, Escape cancels, and
an empty name restores the automatic name. Double-click an existing label to rename it.
Drag a label along any branch and onto either side of the wire. Arrow keys move
it along the wire or flip sides; Shift increases the step; Home resets placement.
A label drag makes one undo entry and never moves the wiring. Custom names are optional,
up to 120 characters, and may be shared by distinct nets; identity is always the ID.
Without an override, the name follows the anchor block and port, such as `Step.y`.
These direct naming/movement gestures follow MathWorks' documented interaction:
https://www.mathworks.com/help/simulink/ug/configure-model-element-names-and-labels.html

`Project.nets` is persistent metadata for connected components. Each record has
an immutable UUID-based `id`, an `anchor` endpoint, and the complete `wireIds`
partition. `name`, merged-name `aliases`, `hidden`, and a route-relative `label`
are optional. Signal identity is anchored at its producing port; physical nets
retain a stable terminal anchor. Ports on one block remain separate graph vertices,
including different domains. Crossing wires do not imply connectivity.

`reconcileNets(next, previous)` runs once at the document transaction boundary,
after junction normalization. It uses indexed endpoint and wire overlap, never
screen geometry. Legacy documents are migrated on opening; save/import/export
and undo/redo carry the records. Rerouting, moving blocks, branching, and pruning
junctions retain identity. On a split, the component containing the anchor keeps
the ID/custom name; the other components get fresh IDs and automatic names. If the anchor disappears,
surviving wire IDs and then endpoints recover the best continuation. On a merge,
the driver's identity wins; physical ties are deterministic. Other names are
retained as aliases in the inspector. Explicitly clearing the name clears aliases.
Copy/paste and duplication remap net IDs, endpoint anchors, and label wire IDs;
the copies keep display names without sharing identity with originals.

A label stores a wire ID, a fraction of its routed length, and a side. It follows
route and block motion without fixed world-coordinate offsets. If its wire is
removed by a topology edit, placement falls back to the longest horizontal stretch
of the surviving net. Naming a net does not create a solver variable or propagate
through blocks. Signal objects, bus schemas, data types, sample-time inference,
and hierarchical label propagation remain separate future capabilities.

The Python contract validates unique IDs, complete/disjoint ownership of wires,
connected membership, valid anchors, and label attachment. Net metadata is excluded
from Modelica emission and both simulation validity/cache signatures. Numerical
execution continues to derive connectivity solely from the graph.

Validation covers migration, physical and signal topology, branches, splits,
merges, anchor deletion, large splits, duplication and partial clipboard copies,
label movement, schema rejection, and simulation independence. Browser checks
cover double-click naming (including whole-net selection), label dragging between
branches, Escape, undo/redo, inspector search/renaming/visibility, and reload.


## 19. Unique block names and automatic net names

`normalizeProject` is the editing boundary for loading, importing, adding,
agent-created blocks, and document commits. It first normalizes block instance
names, then junction geometry and logical net identity. Copy/paste (including
Ctrl-drag previews) uses the same name allocator before returning its new model.

Blocks receive `Step`, `Step1`, `Step2`, etc. Existing distinct names are reserved
before resolving collisions, so importing `Step, Step, Step1` repairs only the
duplicate to `Step2`. An unchanged existing block owns its name when a newly added
or renamed block requests it. Copies of numbered names increment their suffix
(`Step1` becomes `Step2`, skipping occupied names). Deleting a block does not
renumber others; a subsequent insertion may reuse a free name. Names are unique
within the model, case-sensitive, and bounded to 100 characters. The allocator
clones only changed instance definitions and never changes library definitions.

Automatic net names use the source block and port, e.g. `Step.y` or `Gain.y`.
Physical connections use their stable anchor terminal, e.g. `Resistor.p`, without
inventing a driver. Junction-only fragments fall back to `Net1`, `Net2`, etc.
The inspector shows destination summaries (`→ Sum.a`, `→ Display.u + 1`, or
`↔ Capacitor.p`) and an Auto indicator. The full UUID remains available in the
properties and tooltip, rather than being the primary list label.

`Net.name` remains a custom override. `automaticNetName` and `netDisplayName`
derive the visible default from the current document; a cached display name is
never serialized. Renaming a block updates its automatic net names immediately.
Branches share one name and adding a destination does not rename the signal.
Manual net names remain fixed across block renames. Clearing a name, or choosing
Use automatic name, restores the derived name. Automatic and custom names both
support dragging and the Show name on diagram option. Duplicated automatic nets
follow their newly allocated block names; duplicated custom names stay custom.
Names and IDs have separate roles, so naming has no effect on equation emission,
net connectivity, simulation signatures, or result-cache identity.
