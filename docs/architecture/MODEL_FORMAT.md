# Document format and identity

The TypeScript contract is [model.ts](../../lib/gradara/model.ts); validation lives in [server/models.py](../../server/models.py). Both must evolve together. FastAPI exposes the server schema at `/api/openapi.json`. Documents use version `1` (flat) or `2` (with subsystems); see [versioning and migration](#versioning-and-migration).

## Project

| Field | Meaning |
| --- | --- |
| `version` | Format version: `1` for a flat document, `2` when it has subsystems. The workbench sets it; the server rejects `subsystems` in a version 1 document. |
| `modelId` | Stable saved-document identity. Missing only in legacy/unassigned documents. |
| `name`, `description` | Human-facing document information. |
| `blocks` | Instances with embedded definitions and presentation data. |
| `wires`, `junctions` | Connectivity and drawn route geometry. |
| `nets` | Optional legacy field; current documents reconcile stable logical nets. |
| `duration` | Simulation stop time, in seconds. Server accepts greater than 0 and at most 86,400. Full-model agent planning retains its separate 60-second bound. |
| `revision` | Edit/undo revision. Save concurrency instead uses a separate content-hash `saveVersion` token. |
| `exampleId` | Optional template origin, not document identity. |
| `annotations`, `plots` | Diagram notes (`x`, `y`, a heading `text`, and an optional `detail`) and named result-series groups. Notes live on the top-level sheet; users add, edit, and move them on the canvas. |
| `subsystems` | Version 2 only. Subsystem definitions, each stored once. See [subsystems and variants](#subsystems-and-variants). |
| `configurations` | Optional named choices of variant for every subsystem instance with variants. |

An empty document is valid to save, but cannot be simulated:

```json
{
  "version": 1,
  "name": "My model",
  "blocks": [],
  "wires": [],
  "junctions": [],
  "nets": [],
  "duration": 1,
  "revision": 0
}
```

Saving assigns a document identity. For realistic fixtures, start with a checked-in template under [models/examples](../../models/examples/) (`dc`, `servo`, `foc`, `buck`, `flyback`, `datacenter`, or `ev`, or `block-<id>` for a block example in `models/examples/blocks/`; the template IDs `POST /api/models` accepts) and create an independent model through the UI or API.

## Blocks and definitions

A block has an `id`, embedded `definition`, `position`, optional `size`, optional `labelOffset`, and optional `terminated` (output port IDs left open on purpose and drawn with a terminator mark; presentation only, dropped when a wire reaches the port). `position` is the top-left corner of the body and `size` its displayed width and height, in diagram units; the workbench keeps positions, pinned bends, and junctions on the 8-unit sheet grid and sizes in 16-unit steps (see the [block design contract](../blocks/DESIGN.md#the-sheet-grid)). A port's optional `offset` is a percent along its side, placed at the nearest grid step. A signal port may carry a bus: `width` (2 to 1000) is how many signals it carries and `elements` (optional, one per signal) names them, with dots for a bus inside a bus (`motor.speed`). Widths are derived, not authored: the editor recomputes them from the wiring after every edit (`propagateBuses` in `lib/gradara/buses.ts`), and only bus blocks (`mux`, `demux`, `busCreator`, `busSelector`), subsystem instance ports, and boundary blocks take one. A bus block's signal count is its ports: a Mux's inputs, a Demux's outputs, a Bus Creator's input names, and a Bus Selector's output names, which are the elements it selects. Its stored `equations` are a preview; the service regenerates them from the ports (`server/buses.py`). Instances carry their own parameter values and definitions; changing the library does not silently rewrite saved instances. `definition.name` currently doubles as the human instance name. `definition.kind` chooses behavior/symbol conventions and must not change just to rename a block.

Definitions contain `kind`, name/description, primary domain, symbol, ports, parameters, declarations, equations, and optional generated/controller/category/keywords metadata. Scalar signal definitions are wrapped as Modelica components. Canonical physical kinds select backend wrappers, which are authoritative for their implementation.

A definition can instead name a Modelica Standard Library 4.1.0 class in `modelica`:

```json
"modelica": {
  "class": "Modelica.Mechanics.Translational.Components.Spring",
  "modifiers": {"c": "c", "s_rel0": "s_rel0"},
  "ports": {"ib": "i[2]"}
}
```

`modifiers` maps MSL parameter names to plain numeric expressions over the block's parameter IDs; a dotted key such as `cellData.Qnom` sets a field of a record parameter, and `T.start` sets the initial value of a variable the class declares with a start value (the heat capacitor's temperature, for example; the index lists these as `starts`). `ports` maps block port IDs to MSL connector names when they differ, including one element of a vector connector such as `i[2]`. The emitter instantiates the class directly. `server/msl.py` checks every wrapper against `server/msl_index.json` before emitting: the class must be in the index, each modifier must name a parameter of the class (or `<variable>.start` for a variable listed in its `starts`) and use only the block's parameters, literals, and a few math functions, each port must map to a connector with the same domain and direction, vector connectors need an index, and a conditional connector needs a `use…` modifier that enables it. Generated definitions cannot carry `modelica`. The `equations` text of a wrapper block is a comment for display.

Two more optional fields belong to hierarchy: `subsystem` marks an instance of a subsystem, and `boundary` marks a subsystem port block. See [subsystems and variants](#subsystems-and-variants).

`ctemplate` is an optional C template for a custom signal block, used only by C code generation: `{signature, state: [{name, type: real|bool|int, init}], output: [...], update: [...], feedthrough, notes}`. `signature` is 16 hex characters derived from the block's kind, equations, declarations, ports, and parameter IDs; a template whose signature no longer matches is ignored. The statement rules are in [controller C code](EXECUTION.md#controller-c-code). It never affects simulation.

Port IDs and parameter IDs use Modelica-compatible identifiers and must be unique within the definition. Block and junction IDs must be unique across the document. A rename should preserve IDs; duplication should allocate new instance/connection IDs and clone nested definitions so editing the copy cannot mutate the original.

Ports have `direction` (`input`, `output`, or `physical`), their own `domain`, optional side, and optional offset in percent along that side. Domains are:

| Domain | Direction | Modelica connector |
| --- | --- | --- |
| `signal` | input/output | `RealInput` / `RealOutput` |
| `boolean` | input/output | `BooleanInput` / `BooleanOutput` |
| `electrical` | physical | Analog `Pin` |
| `mechanical` (rotational) | physical | Rotational `Flange_a` |
| `translational` | physical | Translational `Flange_a` |
| `thermal` | physical | `HeatPort_a` |
| `magnetic` | physical | FluxTubes `MagneticPort` |
| `threePhase` | physical | Polyphase `Plug` |

`signal` and `boolean` are the causal domains; every other domain is a physical terminal. Validation rejects an input or output port with a physical domain and a physical port with a causal domain. Never derive connector semantics only from the block color. Offsets must agree between renderer and router. Omit unset optional geometry values in API responses: an explicit `null` can accidentally behave like zero in frontend arithmetic.

## Wires, junctions, and nets

A wire links endpoint IDs plus port handles. An endpoint can name a block or a junction. Waypoints shape the route; they do not define signal evaluation order. A visual crossing is not connectivity unless the graph includes the connection.

`waypoints` are the bends a user pinned. Omitted or empty, the wire is automatic: the sheet router (`lib/gradara/router.ts`) draws it around blocks from the endpoints. Pinned bends are used while the route through them is valid; the saved-document boundary clears bends the router could not use, so stored and drawn geometry agree. Because absent and empty mean the same thing, the Python `Wire` default of an empty list round-trips without changing any drawing.

A junction has its own ID, position, and domain. The Modelica emitter resolves connected components through junctions into connector equations. Moving the junction changes geometry, not electrical or mechanical laws.

A net describes one connected component of wires:

- `id`: stable machine identity, independent of name and geometry.
- `anchor`: endpoint key (`blockId.portId` or `j:junctionId`) used to retain identity when a net splits.
- `wireIds`: every drawn wire belonging to that connected component.
- `name`: optional user name; otherwise a readable name is derived from the anchor connection.
- `aliases`: retained names when named physical nets merge.
- `label`: wire ID, fractional position, and side for a displayed label.
- `hidden`: hides the label even when the net has a custom name.
- `showName`: shows the label of a net that only has its automatic name. Labels are off by default: a net shows its label when it has a custom name or `showName`, and not when `hidden` is true.

Each wire belongs to exactly one net in documents with a net registry. Each net must be connected and contain its anchor. Signal nets permit at most one output driver, including connections through junctions; physical nets join compatible physical ports without inventing a signal source. Incomplete signal nets can be saved but fail simulation preflight when required inputs lack a source.

Use [net-registry.ts](../../lib/gradara/net-registry.ts) reconciliation after graph edits rather than allocating a new ID on every render. Test merge, split, deletion, duplication, label placement, undo, and reload. The [wiring document](WIRING.md) records the detailed naming and identity policy.

## Subsystems and variants

A subsystem is a block whose inside is another diagram of the same document. [hierarchy.ts](../../lib/gradara/hierarchy.ts) holds the editing rules and [server/hierarchy.py](../../server/hierarchy.py) the server checks.

**Definitions.** Each entry in `Project.subsystems` has an `id`, a `name`, its own `blocks`, `wires`, `junctions`, and `nets`, and optional promoted `parameters`. A definition is stored once however many instances use it. Definitions that no instance reaches from the top level are dropped when the document is edited; a document without subsystems returns to version 1.

**Boundary blocks.** Inside a definition, blocks of kind `inport`, `outport`, and `connport` (library names **Subsystem input**, **Subsystem output**, and **Subsystem terminal**) carry `definition.boundary = {order, side?}`. `order` is canonical: inputs first, then outputs, then terminals, each group in its port-number order, and `definition.symbol` holds the 1-based number within its group (Simulink-style: In 1, In 2, Out 1, …). The workbench renumbers whenever ports are added, removed, retyped, or reordered. Each has one port: an inport has an output `y` that drives the inside, an outport an input `u` that the inside drives, and a connport a physical `p`. Inports and outports take `signal` or `boolean`; connports take a physical domain. Boundary blocks are refused on the top level.

**Instances.** An instance block has `definition.kind = "subsystem"` and `definition.subsystem.ref` set to a definition ID. Its ports are derived from the boundary blocks in `order`: the port ID is the boundary block's ID, the name is the boundary block's name, the direction is `input`, `output`, or `physical`, and the domain is the inner port's domain. `boundary.side` places the port on a side of the outside block (left, right, top, or bottom; inputs default left, outputs right, terminals left). The server rejects an instance whose ports or parameter IDs do not match its definition, a reference to a missing definition, and any definition that contains itself directly or through others.

**Promoted parameters.** A definition's `parameters` are ordinary parameters plus `targets: [{blockId, parameterId}]`, the inner block parameters they set. Instances list the same parameter IDs and hold their own values. The inner block keeps a value of its own, which is used when the parameter is demoted.

**Variants.** An instance can have alternative insides behind one set of ports:

```json
"subsystem": {
  "ref": "sub_b",
  "active": "v_b",
  "variants": [
    {"id": "v_a", "name": "A", "ref": "sub_a", "values": {"Gain_k": 5}},
    {"id": "v_b", "name": "B", "ref": "sub_b", "values": {"Gain_k": 2}, "unused": ["p_z"]}
  ]
}
```

`variants` has 2–12 entries with unique IDs, and `active` must name one whose `ref` equals the instance's `ref`. So the instance's `ref` is always the active variant's inside, and emission, results, and other hierarchy code see an ordinary instance. A diagram variant has its own definition; a parameter variant shares another variant's `ref` and differs only in `values`, the promoted parameter values it restores when chosen. The instance's ports are the union of every variant's ports: the active inside's ports first, then ports only other variants have. `unused` lists ports that variant leaves idle on purpose. A port the active inside lacks and does not list in `unused` fails simulation.

**Configurations.** `Project.configurations` holds up to 30 entries `{id, name, choices}`. `choices` maps `<sheet>/<instance ID>` to a variant ID, where the sheet is a subsystem definition ID, or empty for the top level (`/drive`). Keys for instances that no longer exist are ignored. Configurations do not change emitted source; only the active variants do.

## Versioning and migration

| Version | Content | Opened by |
| --- | --- | --- |
| `1` | Flat document: one sheet, no `subsystems`. | Every release. |
| `2` | Adds `subsystems` and optional `configurations`. | 0.4.0 and later. Releases before 0.4 cannot open it. |

The workbench writes version 1 when a document has no subsystems and version 2 when it has any, so a flat model stays readable by older releases.

Older documents are brought up to date when they are loaded, not by a separate migration step:

- [normalize-project.ts](../../lib/gradara/normalize-project.ts) runs on every load and edit. It assigns a missing `modelId`, normalizes names and junctions, and reconciles nets. Through `realizePlaceholders` (`lib/gradara/hierarchy.ts`) it turns a subsystem placeholder from an older document into a real subsystem.
- `document()` in [workspace.py](../../server/workspace.py) runs on every server load. It assigns an identity to legacy documents without one, renames the retired `wiring` example, and validates the result against `Project`.

Policy:

- A newer release always opens files saved by an older release.
- The version number changes only when an older release could misread a file written by a newer one. Additive optional fields that older releases ignore safely do not bump it.
- Every version bump adds a fixture of the new format under `tests/fixtures/` and a test that loads it. Keep the old-format fixtures too.

## Normalization and persistence

[normalize-project.ts](../../lib/gradara/normalize-project.ts) assigns missing document identity, puts every sheet on the sheet grid (an older document's blocks move by at most a few units, and wires that move leaves one step out of line are straightened by moving a block that holds no other straight wire), normalizes block names and junctions, and reconciles nets. It also turns a library **Subsystem** block, or a subsystem placeholder in an older document, into a real subsystem whose inside passes each input to the output in the same position, so its ports and wires stay. It is used around document loading and editing. Backend [workspace.py](../../server/workspace.py) handles document creation, save/load, and legacy files.

| Path under `projects/` | Ownership |
| --- | --- |
| `models/{modelId}.json` | Saved documents. |
| `workspace.json` | Last activated document snapshot/identity. Loading resolves its ID to the canonical file in `models/`, so old snapshot contents cannot override later edits. |
| `workspace.mo` | Generated executable source projection. |
| `examples/` | Legacy saved work, preserved by migration. Not the checked-in templates in repository `models/examples/`. |
| `trash/{modelId}.json` | Recoverable removed documents. Presence hides any legacy copy of the same identity. |
| `runs/{jobId}/` | Immutable input snapshots, source, diagnostics, CSV, and result preview. |
| `agent/` | Generation prompts, responses, schema, and logs. |
| `exports/` | Generated controller packages. |

The server uses per-file atomic replacement, not a transactional multi-file database. `PUT /models/{id}` writes one document without activating it. It requires the `expectedVersion` from the last load/save response for an existing document; a content hash checks all persisted fields, including geometry and names. A stale save fails with 409. Retrying a body already stored is idempotent, even when its acknowledgment was lost. The single-process service performs the check/write without an intervening await; multiple workers are not supported by this protocol.

`POST /models/{id}/activate` explicitly selects a document. Legacy workspace-only data is materialized into a canonical model file before switching. Reading/opening an unchanged canonical document preserves its last-save timestamp. Creation, import, and Save a copy allocate independent identities; example provenance never selects a save destination.

`DocumentStore` serializes browser writes and keeps save versions per model. Transitions flush the latest snapshot, cancel pending debounce timers, and temporarily lock edits. A failed write remains unsaved. Drafts and each tab's active ID live in session storage; a recovered draft retains its original base version so it cannot silently overwrite newer disk data. Copy recovery gives the draft a new identity.

Moving an inactive model to Trash preserves a recoverable JSON copy and hides legacy copies with the same ID. Saves to a trashed ID fail rather than resurrecting it. Restore retains the original identity without switching the active model. Examples in the repository remain untouched. Custom folders, collaborative merges, and crash-consistent multi-file transactions remain future work.

## Numerical identity

`semantic_hash(project)` hashes emitted Modelica source. Presentation geometry and human names do not change that source. Latest results additionally require the same `modelId`, preventing another document with identical equations from donating its result accidentally.

`project_key(project)` removes geometry and some metadata but is not identical to the source hash. Do not use these interchangeably. Current hashes do not include a separately versioned solver configuration or library manifest; a future compiled cache must include those inputs and define invalidation explicitly.

When adding fields, decide whether they affect physics, presentation, provenance, or identity. Update both contracts, serializer behavior, migrations, and a round-trip or behavioral test. Keep a small old-format fixture when changing compatibility rules.

## Signal logging

`Net.logged?: boolean` records a signal/control net in the next simulation. Physical nets cannot be logged directly; select the physical quantity with a sensor and log its signal output. Reconciliation retains logging with the net identity on split and enables it on a merged net if any contributing net was logged. Logging is undoable and changes observation/result identity; geometry and label edits do not. Modelica emits an output observation per logged net, while the solver continues to determine execution order. Nets inside a subsystem definition can be logged too; each instance of that definition records its own copy, keyed by the instance path (see [results](EXECUTION.md#results)).

### Block rotation

`Block.rotation` is an optional clockwise angle: 0, 90, 180, or 270 degrees (absent means 0). `size` stores the displayed bounding box; quarter turns swap width and height around the same center. Port IDs and definitions remain unchanged. Shared port geometry transforms sides and asymmetric offsets, and the face rotates within those bounds. Instance labels remain outside the transformed body. Rotation is presentation-only and excluded from simulation identity.
