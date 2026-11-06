# Understanding and sectioning a flow

The explorer is only as good as its facts. Spend most of the effort here, not on the HTML.

## 1. Find the edges

- **Start (trigger):** an inbound HTTP endpoint or webhook, a scheduled job, a queue or topic consumer, a user action in a UI, or a workflow start.
- **End (outcome):** a durable state change that someone cares about: rows committed, a file stored, a status a person acts on, a message delivered.
- If there are several triggers (for example, a webhook that queues work, and a timer that later picks it up), each trigger starts its own sequence.

## 2. Trace every hop

Start at the trigger and follow the code, not the names:

| Look for | Becomes |
|---|---|
| Route and endpoint mappings (`MapPost`, controllers, `@app.post`, router files) | The REST path in `call`, and an HTTP request in `req`. |
| Typed or SDK clients, `HttpClient`, generated API clients | A route to an external lane, with `call.verb = "SDK"` or the HTTP verb. |
| Queue or outbox inserts, message publishes, `StartExecution`, scheduler targets | `async` steps, or a hand-off to a worker lane. |
| Workflow definitions (Step Functions ASL, Temporal, Durable Functions) | One step per state that does visible work, plus failure branches from `Catch` and `Retry`. |
| ORM calls (`SaveChanges`, `Add`, `ExecuteUpdate`, repositories), raw SQL, stored procedures | `tables` entries with the SQL. |
| Feature flags or config reads that gate the flow | A short request step to a flags lane. Its failure path is often "flag off, stop". |
| Locks, idempotency keys, leases, retries, backoff | `notes`. These are what engineers want to see. |

Record a code reference (`refs`) for every step. Note anything that's inferred instead of read.

## 3. Get the real SQL for every table

For each step, list every table it reads or writes, then capture the statement:

1. **Raw SQL or Dapper or stored procedures:** copy it from the code.
2. **EF Core:**
   - Run the relevant test with `LogTo(Console.WriteLine, LogLevel.Information)` or `EnableSensitiveDataLogging(false)` logging, or use `ToQueryString()` for queries.
   - For `SaveChanges`, reconstruct the INSERT or UPDATE from the entity's mapped columns and the properties that changed.
   - `ExecuteUpdate` and `ExecuteDelete` map almost one-to-one.
3. **Other ORMs:** turn on statement logging (Hibernate `show_sql`, SQLAlchemy `echo=True`, Prisma `log: ['query']`, Sequelize `logging`).
4. **Migrations and the schema:** confirm table and column names, unique indexes, check constraints and triggers. Constraints that guard the step (for example, "at most one InProgress per application") belong in `cols` or `notes`.

Write SQL the way it actually runs:
- keep `WHERE` guards (`AND "Status" = 'Running'`);
- keep the locking (`FOR UPDATE SKIP LOCKED`, advisory locks);
- keep the conflict handling (`ON CONFLICT … DO UPDATE`) and `RETURNING`.

Parameterize values (`@tenant`, `@runId`). Never paste real customer data or secrets. If a statement is reconstructed rather than captured, add a note.

## 4. Section it

**Sequences** (route plates A, B, C, …):
- Split at triggers, and at points where work waits for a timer, queue or human.
- Aim for 8–20 main steps per sequence. More than about 24 should be split.
- Name each one by its outcome in plain words ("Documents arrive", "Review runs", "Funder decides").

**Phases** (labels within a sequence):
- Group consecutive steps that serve one purpose (Webhook, Import, Queue, Copy, Store).
- Phases name the chapters a presenter would talk through.

**Steps** (one train each):
- One step is one hop, or one meaningful piece of internal work.
- Merge trivial hops that tell the viewer nothing (a DTO mapping, a log line).
- Split steps that change different tables for different reasons.
- If a call returns something the caller uses, it's one round-trip step (add `res`), not two steps.
- A separate `response` step is for replies that come back much later, or to a different caller.

**Failure branches:**
- Choose the 1–3 failures per sequence that a reviewer will ask about: an external system down, required data missing, a duplicate or replayed request, losing a race.
- Each one is an `alt` step `after` the step where it happens, routed to the place where the failure is recorded.

## 5. Write for two audiences

| Field | Rule |
|---|---|
| `title` | Subject plus what happens, in plain words: "The card is charged". |
| `story` | What happens and to what, in one or two sentences. No class names, verbs, AWS service names or acronyms the viewer wouldn't know. |
| `why` | Optional, only when the reason isn't obvious ("Saving first means a payment can never exist without an order"). |
| `labelPlain` | A two-word verb phrase ("save app", "AI reads"). |
| `label` | The technical name ("PutObject", "POST /orders"). |
| Technical fields | Exact paths, statuses, column names and SQL. This is where precision lives. |

Test it: switch to Plain and read only the titles and stories from start to end. A non-technical colleague should be able to retell the flow from that alone.
