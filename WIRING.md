# Wiring and routing — vision, plan, and what we tried

Written 12 September 2026 after a stretch of incremental wiring work that did not reach a usable drawing feel. This is the product spec for nets, plus an honest record of the attempts, so the next pass can implement the plan instead of inventing another heuristic.

**Quality bar:** Simulink’s *feel* (nets, T-branches, feedback loops) with Altium’s *drawing contract* (pin exit, orthogonal rubber-band, click pins a run). Not LabVIEW. Not a generic graph editor.

**Status:** specified; partially implemented in code; **not** solved in the browser. Coordinate-driven tests in `tests/wiring.test.ts` pass. Live pointer interaction on the canvas still fights the user.

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
