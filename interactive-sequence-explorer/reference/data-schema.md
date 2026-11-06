# Flow data schema (`window.FLOW`)

A flow is one or more `.js` files in a folder. They load in alphabetical order, and together they assign `window.FLOW`. Split large flows by sequence, for example `00-meta-lanes.js`, `10-seq-a.js`, `20-seq-b.js`, where later files add to `window.FLOW.seqs`.

```js
window.FLOW = {
  meta:  { ... },
  lanes: { <laneId>: Lane, ... },
  seqs:  { <seqKey>: Sequence, ... }
};
```

## `meta`

| Field | Req | Meaning |
|---|---|---|
| `title` | yes | Header title and the page `<title>`. |
| `subtitle` | | One line under the title (hidden on narrow screens). |
| `footnote` | | The strip at the bottom of the page. Say what's illustrative here. |
| `phasesPlain` | | A map from a technical phase name to a plain one, e.g. `{ "Webhook": "LOS alert" }`. |
| `defaultLevel` | | `"plain"` (default) or `"tech"`. |

## Lane

| Field | Req | Meaning |
|---|---|---|
| `name` | yes | Nameplate text, short ("Lending API"). |
| `kind` | yes | Technical subtitle ("api-host Lambda"). |
| `kindPlain` | | Plain subtitle ("Our API"). The validator warns when `kind` looks technical and this is missing. |
| `plain` | yes | One or two sentences for the lane card. |
| `tech` | | `[label, value]` pairs for the lane card's Technical section. |
| `refs` | | Where it lives (repo, folder, PR). |
| `store` | | `true` for databases. The lane card then lists every table used by the sequence, with links to the steps that touch it. |

Lane IDs are lowercase (`api`, `db`, `worker`).

## Sequence

| Field | Req | Meaning |
|---|---|---|
| `code` | yes | One character. It's shown on the route plate and is the keyboard shortcut. `T` is reserved. |
| `title` | yes | Route plate name ("Documents arrive"). |
| `desc` | | Route plate subtitle ("Webhook → stored files"). |
| `lanes` | yes | Lane IDs, top to bottom. |
| `steps` | yes | Steps in order, with failure branches anywhere in the array (see `alt`). |

## Step

**Identity and placement**

| Field | Req | Meaning |
|---|---|---|
| `id` | yes | Unique across **all** sequences. Used for `#id` deep links. Convention: `a1`, `a2`, …; branches `a9x`. |
| `route` | yes | Lane IDs in order of travel. One lane makes a self-loop (internal work); three or more make a multi-hop route. |
| `kind` | | `request` (default for two or more lanes), `response`, `async` (timer, queue, event), `internal` (default for one lane), `failure`. |
| `phase` | | Phase name, shown in the plate header. |
| `phasePlain` | | A plain phase name for this step (overrides `meta.phasesPlain`). |
| `alt` + `after` | | `alt: true, after: "<mainStepId>"` makes the step a failure branch that appears only when "What if it fails?" is on. |

**Train labels** (keep them to 16 characters or fewer)

| Field | Req | Meaning |
|---|---|---|
| `label` | yes | Technical label on the outbound train ("POST /orders", "PutObject"). |
| `labelPlain` | | Plain label ("place order"). |
| `resLabel` | | Technical label on the reply train ("201 Created"). |
| `resLabelPlain` | | Plain label on the reply train ("order id"). |
| `roundTrip` | | Forces the round-trip animation on (`true`) or off (`false`). |

**Words**

| Field | Req | Meaning |
|---|---|---|
| `title` | yes | Plain, one line. Shown on the step stud and as the plate headline. |
| `story` | yes | One or two plain sentences. `<code>` is allowed; no other HTML. |
| `why` | | A "Why it matters" callout. |
| `notes` | | Edge cases and invariants (allows `<code>`). |
| `refs` | | Code locations. |

**Technical detail**

| Field | Req | Meaning |
|---|---|---|
| `call` | | `{ verb, text }`, where `verb` is one of `GET`, `POST`, `SQL`, `AWS`, `SDK`, `IN` or free text, and `text` is the path or method. |
| `kv` | | `[label, value]` pairs. |
| `req`, `res` | | `{ cap, lang, body }`, where `lang` is `json`, `sql`, `http` or `text`. Each shows as an expandable block with a Copy button. |
| `tables` | | A list of `Table` entries (below). |

### Round trips

A step animates as a round trip when it has `res`, two or more lanes, and a kind that isn't `response` or `failure`. Set `roundTrip` to override this.
- **Out:** the amber train runs `route` forwards with `labelPlain`/`label`.
- **Back:** the blue train runs it backwards with `resLabelPlain`/`resLabel`.
- **Plate:** shows an OUT/BACK strip, and the `req` and `res` sections are titled "Request (out)" and "Response (back)".

Use `kind: "response"` for a separate reply step (for example, the final HTTP response to an external caller after several internal steps). Use a round trip when the reply comes straight back.

### Table

```js
{ name: "Orders", op: "UPDATE",
  cols: [["Status", "PendingPayment → Paid"], ["ChargeId", "ch_31x"]],
  sql: "UPDATE \"Orders\" SET \"Status\" = 'Paid' ...;" }
```

| Field | Req | Meaning |
|---|---|---|
| `name` | yes | The table name as it is in the database. |
| `op` | | `READ`, `INSERT`, `UPDATE`, `UPSERT`, `DELETE`, or a combination ("UPDATE then INSERT"). |
| `cols` | | `[column, meaning or value]` pairs for the columns that matter in this step. |
| `sql` | expected | The statement or statements this step runs on this table, in execution order. Comments are allowed (`-- …`). Use parameter placeholders (`@tenant`), never real data. The validator warns when it's missing. |

Each table renders as a card with its columns and a collapsible "SQL on <table>" block, open in Technical mode and closed in Plain.

## Minimal example

See `template/starter/flow.js` for a complete four-lane checkout flow that shows every field.
