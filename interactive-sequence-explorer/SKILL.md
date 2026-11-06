---
name: interactive-sequence-explorer
description: Build an interactive, animated sequence diagram ("sequence explorer") of a system flow as one self-contained HTML file. Use when someone asks for an interactive, animated or explorable sequence diagram, a walkthrough of how data moves through services, an end-to-end flow explainer for mixed technical and non-technical audiences, or a request/response and SQL-level trace of a feature. The skill reads the code and docs, works out the flow, splits it into sequences and phases, and generates a signal-box style explorer. It has play/pause animation, collapsible lanes, a Plain/Technical toggle, request and response round trips, the SQL for each table, failure branches and deep links.
---

# Interactive sequence explorer

The output is one HTML file (no network, no build tooling for the viewer) that shows a flow as a railway signal-box mimic panel:

- **Lanes:** each system or actor is a track.
- **Steps:** each one is a route, and an animated train carries the data along it.
- **Requests with a response:** a round trip. The amber request train goes out and the blue reply train comes back.
- **Two levels of detail:**
  - **Plain** (default): one or two sentences per step, in everyday words, for non-technical viewers.
  - **Technical:** the REST path, request and response bodies, the SDK call, and every table touched, each with its own expandable SQL statement.
- **Failure branches:** "What if it fails?" inserts them.
- **Controls:** collapsible lanes, a focus mode, lane cards (including a table index for data stores), keyboard shortcuts and `#stepId` deep links.

The worked example is in `examples/loan-funding-review/`. Open its `index.html` to see the target quality, and read `flow/flow.js` to see the data that produces it.

## Files in this skill

| Path | Purpose |
|---|---|
| `template/shell.html`, `template/style.css`, `template/app.js` | The engine. Generic; don't fork it per flow. |
| `template/starter/flow.js` | A minimal flow showing every field. Copy it to start. |
| `scripts/validate.js` | Schema and quality checks (errors block the build; warnings are advice). |
| `scripts/build.js` | Validates the flow, then inlines the engine and data into one HTML file. |
| `reference/data-schema.md` | The `window.FLOW` schema. Read it before writing data. |
| `reference/discovery.md` | How to understand a flow from code, split it into sequences, and extract the real SQL. |
| `reference/design.md` | The visual system: the lamp grammar and the rules for extending it. |
| `examples/loan-funding-review/` | The full reference: 2 sequences, 35 steps, 13 lanes, SQL for each table. |

## Workflow

Track these as todos. Don't skip verification.

1. **Pin down scope and audience.** Ask, only if it isn't already clear:
   - which flow;
   - where it starts (a trigger such as a webhook, a timer or a user action) and where it ends (a durable outcome);
   - who will watch it.
   Default to both audiences (Plain first, Technical on demand) and to a file shared by email or screen-share.

2. **Understand the flow from the source.** Follow `reference/discovery.md`. Read the entry points and trace every hop: HTTP calls, SDK calls, queues, schedulers, workflow states and database writes. Use the repo's design docs if they exist, but the code wins when they disagree. For every database touch, record the table, the operation and the actual SQL; get it from the ORM's generated SQL, the repository code, raw queries or migrations. Write down what you verified and what you're inferring.

3. **Section the flow** (see `reference/discovery.md` → Sectioning):
   - **Sequences:** split at trigger boundaries. Each sequence has one trigger and one outcome, 2–4 per explorer, with 8–20 main steps each.
   - **Phases:** name groups of steps inside a sequence (Webhook, Import, Queue, Copy and so on).
   - **Failure branches:** one `alt` step per important failure mode, placed after the step that can fail.

4. **Model the lanes.** One lane per system or actor that sends or receives something. Order the lanes so most routes are short (callers above callees, data stores near their writers). Mark databases with `store: true` so their lane card lists every table. Give every lane a `kindPlain`.

5. **Write the steps.** Use the schema in `reference/data-schema.md`. For each step:
   - `title` and `story` in plain words first. No class names, no HTTP verbs, no AWS service names.
   - `label` / `labelPlain` for the train (16 characters or fewer).
   - `route`: the lanes in order of travel.
   - `kind` only when it isn't a request (response, async, internal, failure).
   - If the call returns something the caller uses, add `res` with `resLabel` / `resLabelPlain`. The engine then animates a round trip automatically. Set `roundTrip: false` for fire-and-forget calls.
   - `call`, `req`, `res`: real paths and representative bodies. Mark synthetic IDs as such in `meta.footnote`.
   - `tables`: **every table the step reads or writes**, each with `op`, the key `cols`, and its own `sql`. Use the real statement shape (`FOR UPDATE SKIP LOCKED`, `ON CONFLICT`, guards in `WHERE`). Several statements on one table go in one `sql` string, in execution order.
   - `notes` for invariants and edge cases; `refs` for where the code lives.

6. **Build and validate.** Copy `template/starter/` to a new folder for the flow (for example `<repo>/docs/flows/<name>/flow/`). Put the data in one or more `.js` files there, which load in alphabetical order. Then run:
   ```
   node <skill>/scripts/build.js <flow-folder> <out.html>
   ```
   Fix every ERROR. Treat the warnings as a quality checklist, and clear them unless you have a reason.

7. **Verify in a browser.** Open the HTML in the browser canvas, or any browser.
   - **Errors:** play through both routes in both Plain and Technical mode with "What if" on; there should be no console errors.
   - **Round trips:** watch one; the request goes out and the reply comes back.
   - **SQL:** expand a table's SQL.
   - **Lanes:** open a data-store lane card.
   - **Deep links:** load `#<altStepId>`.
   - **Narrow window:** try about 400px.
   - **Content:** check that every step's plain story reads well without the Technical toggle.

8. **Deliver.**
   - Hand over the single HTML file.
   - List what's verified and what's synthetic.
   - Note any SQL that was reconstructed rather than taken from the code.
   - Keep the flow folder with the code, so the explorer can be rebuilt when the flow changes.

## Rules

- **Plain first.** Plain mode must make sense to someone who has never seen the code. Technical detail only adds to it; it never replaces the story.
- **Never invent facts.** Paths, table names, statuses and error codes come from the code. If a value has to be illustrative (IDs, counts, hashes), say so in `meta.footnote`.
- **SQL for every table touched.** It's part of the deliverable, not decoration. If the ORM hides the SQL, reconstruct it faithfully from the model and the query (see `reference/discovery.md`) and add a note saying so.
- **No secrets or PII** in bodies or SQL. Use placeholders such as `@tenant`, `<account>` and `…`.
- **Don't edit the engine for one flow.** If a flow needs a new capability, add it to `template/` generically, keep the example building, and update `reference/data-schema.md`.
- **Keep the visual system** in `reference/design.md`. Lamp colours carry state and nothing else.
