# Document format and identity

The TypeScript contract is [model.ts](../../lib/gradara/model.ts); validation lives in [server/models.py](../../server/models.py). Both must evolve together. FastAPI exposes the server schema at `/openapi.json`. The current document version is `1`; there is no promise that new schema changes are automatically backward compatible.

## Project

| Field | Meaning |
| --- | --- |
| `version` | Format version; currently 1. |
| `modelId` | Stable saved-document identity. Missing only in legacy/unassigned documents. |
| `name`, `description` | Human-facing document information. |
| `blocks` | Instances with embedded definitions and presentation data. |
| `wires`, `junctions` | Connectivity and drawn route geometry. |
| `nets` | Optional legacy field; current documents reconcile stable logical nets. |
| `duration` | Simulation stop time, in seconds. Server accepts greater than 0 and at most 60. |
| `revision` | Edit/undo revision. Save concurrency instead uses a separate content-hash `saveVersion` token. |
| `exampleId` | Optional template origin, not document identity. |
| `annotations`, `plots` | Diagram explanations and named result-series groups. |

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

Saving assigns a document identity. For realistic fixtures, start with the checked-in [DC](../../models/examples/dc.json), [FOC](../../models/examples/foc.json), or [buck](../../models/examples/buck.json) template and create an independent model through the UI or API.

## Blocks and definitions

A block has an `id`, embedded `definition`, `position`, optional `size`, and optional `labelOffset`. Instances carry their own parameter values and definitions; changing the library does not silently rewrite saved instances. `definition.name` currently doubles as the human instance name. `definition.kind` chooses behavior/symbol conventions and must not change just to rename a block.

Definitions contain `kind`, name/description, primary domain, symbol, ports, parameters, declarations, equations, and optional generated/controller/category metadata. Scalar signal definitions are wrapped as Modelica components. Canonical physical kinds select backend wrappers, which are authoritative for their implementation.

Port IDs and parameter IDs use Modelica-compatible identifiers and must be unique within the definition. Block and junction IDs must be unique across the document. A rename should preserve IDs; duplication should allocate new instance/connection IDs and clone nested definitions so editing the copy cannot mutate the original.

Ports have `direction` (`input`, `output`, or `physical`), their own `domain`, optional side, and optional offset in percent along that side. Never derive connector semantics only from the block color. Offsets must agree between renderer and router. Omit unset optional geometry values in API responses: an explicit `null` can accidentally behave like zero in frontend arithmetic.

## Wires, junctions, and nets

A wire links endpoint IDs plus port handles. An endpoint can name a block or a junction. Waypoints shape the route; they do not define signal evaluation order. A visual crossing is not connectivity unless the graph includes the connection.

In frontend route operations, omitted `waypoints` permits automatic orthogonal routing from the endpoints; an explicit empty array preserves a straight route. The Python `Wire` schema currently defaults absent waypoints to an empty list, so serialized API round trips do not retain that distinction in all cases. Treat this as a known contract gap when editing persistence or routing; do not assume an absence-preserving round trip exists.

A junction has its own ID, position, and domain. The Modelica emitter resolves connected components through junctions into connector equations. Moving the junction changes geometry, not electrical or mechanical laws.

A net describes one connected component of wires:

- `id`: stable machine identity, independent of name and geometry.
- `anchor`: endpoint key (`blockId.portId` or `j:junctionId`) used to retain identity when a net splits.
- `wireIds`: every drawn wire belonging to that connected component.
- `name`: optional user name; otherwise a readable name is derived from the anchor connection.
- `aliases`: retained names when named physical nets merge.
- `label`: wire ID, fractional position, and side for a displayed label.
- `hidden`: display preference.

Each wire belongs to exactly one net in documents with a net registry. Each net must be connected and contain its anchor. Signal nets permit at most one output driver, including connections through junctions; physical nets join compatible physical ports without inventing a signal source. Incomplete signal nets can be saved but fail simulation preflight when required inputs lack a source.

Use [net-registry.ts](../../lib/gradara/net-registry.ts) reconciliation after graph edits rather than allocating a new ID on every render. Test merge, split, deletion, duplication, label placement, undo, and reload. The [wiring document](WIRING.md) records the detailed naming and identity policy.

## Normalization and persistence

[normalize-project.ts](../../lib/gradara/normalize-project.ts) assigns missing document identity, normalizes block names and junctions, and reconciles nets. It is used around document loading and editing. Backend [workspace.py](../../server/workspace.py) handles document creation, save/load, and legacy files.

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

`Net.logged?: boolean` records a signal/control net in the next simulation. Physical nets cannot be logged directly; select the physical quantity with a sensor and log its signal output. Reconciliation retains logging with the net identity on split and enables it on a merged net if any contributing net was logged. Logging is undoable and changes observation/result identity; geometry and label edits do not. Modelica emits an output observation per logged net, while the solver continues to determine execution order.
