# R&D Task Center

The business main entry point for FluidMind. Every AI workflow — forward prediction, batch prediction, cost optimization, material replacement, new-product generation, knowledge Q&A — flows through this module.

```
/api/v1/tasks
├── /                      create + list
├── /:id                   full view (task + inputs + outputs + recent events)
├── /:id/submit            draft → submitted (kicks off the handler)
├── /:id/cancel            draft|submitted → cancelled
├── /:id/archive           terminal → archived
├── /:id/restore           archived → prior terminal status
├── /:id/manual-override   ops escape hatch (writes manual_override event)
├── /:id/inputs            attach / list inputs
├── /:id/outputs           attach / list outputs
├── /:id/events            paginated state-transition log
├── /templates             template registry per task_type
└── /handlers              what handlers are registered
```

## Why this layer

Without a task center, every AI workflow becomes a one-off endpoint with bespoke validation, ad-hoc retry, and no shared audit trail. Centralizing them gives us:

- **One state machine** — every task transitions through `draft → submitted → processing → completed/failed → archived`. The same UI shows pipeline progress for every type.
- **One event log** — `r_and_d_task_events` is append-only and records every transition with `from_status`, `to_status`, `actor_id`, `trace_id`, and a free-form `message`. Forensics and audit are uniform.
- **One handler contract** — each task type implements `TaskHandler`. New AI capabilities plug in without touching state, persistence, or REST.
- **Three input modes** — structured form, natural-language prompt, template-filled — all stored in `r_and_d_task_inputs` with the same shape.
- **Drafts are first-class** — users can save partial work, refine inputs, attach references, then submit when ready.
- **Idempotent retry** — a failed task can be picked up again (`pickup` from `failed`); retry is logged as a separate event.

## Database

This module extends the existing `r_and_d_tasks` (introduced in migration 0008) and adds 4 new tables.

### r_and_d_tasks (extended)

A new column `task_kind` discriminates the two co-existing semantics:
- `task_kind = 'project_task'` — the legacy Jira-style work item (todo / in_progress / done)
- `task_kind = 'ai_workflow'` — this module's surface

`status` and `task_type` `CHECK` constraints were relaxed to accept both value sets. New columns added for AI workflow:
- `input_mode` (`structured` / `natural_language` / `template`)
- `template_id` FK
- `submitted_at`, `processing_started_at`, `archived_at`
- `error_class`, `error_message`, `summary`
- `handler_version`, `trace_id`

### r_and_d_task_inputs (new)
Append-only. Each row carries one of: structured `payload` JSONB, `raw_text` for natural language, an `attachment_url`, or a `reference` to another resource. `is_primary = true` marks the input the handler runs against.

### r_and_d_task_outputs (new)
Append-only. Handlers attach result payloads here. Each output has a `output_type` (`prediction`, `recommendation`, `report`, `citation`, ...), structured `payload`, optional `summary`, `confidence`, and ML provenance (`model_version_id`, `feature_set_version`).

### r_and_d_task_events (new)
APPEND-ONLY state-transition + activity log. Every state machine transition writes one row. Indexed by `(task_id, occurred_at)` for fast log tailing and by `trace_id` for cross-system correlation.

### r_and_d_task_templates (new)
Per-task-type templates with a JSON-Schema-shaped `input_schema`, a `default_payload`, and an `example_payload`. Six templates seeded — one for each task type.

## State machine

Codified in `state-machine.ts` as a pure module:

```
draft ──submit──▶ submitted ──pickup──▶ processing ──complete──▶ completed
                       │                    │              │
                       │                    └─fail──▶ failed
                       │                                    │
                       └─cancel──▶ cancelled                │

{completed | failed | cancelled} ──archive──▶ archived
archived ──restore──▶ (prior terminal status, recovered from event log)

failed ──pickup (retry)──▶ processing
```

`canTransition(action, currentStatus)` and `nextTransition(action, currentStatus)` answer "is this legal?" without touching the DB. `guardAction(action, subject)` adds business prerequisites:

- `submit` requires `has_primary_input = true`
- `archive` only from a terminal status
- `cancel` only from `draft` or `submitted`

The repository writes the new status + emits the matching event in **one transaction** (`UPDATE … WHERE status = $expected` for optimistic concurrency).

Every state transition writes an `r_and_d_task_events` row with:

| Column         | Meaning |
|----------------|---------|
| `event_type`   | `submitted` / `processing_started` / `completed` / `failed` / `cancelled` / `archived` / `restored` / `manual_override` / `retry` |
| `from_status`  | the status before the transition |
| `to_status`    | the status after the transition |
| `actor_id`     | user who triggered it (null for system) |
| `trace_id`     | the same trace_id flowing from the HTTP request through the handler |
| `message`      | optional human note |
| `payload`      | structured event-specific data |

## Task types & handlers

Six AI workflow types ship out of the box. Each has a handler in `handlers/index.ts`:

| `task_type`               | What it does (mock today, real later) | Required input fields |
|---------------------------|----------------------------------------|------------------------|
| `forward_prediction`      | Predict a metric for a single formula version | `formula_version_id`, `target_metric` |
| `batch_prediction`        | Predict metrics across every approved formula in a category | `product_category_code`, `target_metrics[]` |
| `cost_optimization`       | Suggest formulation tweaks to hit a cost target while preserving metric envelopes | `base_formula_version_id`, `cost_target` |
| `material_replacement`    | Find candidate replacements for a specific raw material with projected impact | `base_formula_version_id`, `replace_raw_material_id` |
| `new_product_generation`  | Synthesize candidate formulations matching target metrics + constraints | `product_category_code`, `target_metrics` |
| `knowledge_qa`            | Answer a free-form question with knowledge-document citations | `question` (or `raw_text`) |

The shipped handlers are **deterministic mocks** — they validate input shape and produce realistically-shaped outputs (`prediction` / `recommendation` / `report` / `citation`). Wire real models by registering a new `TaskHandler` instance for the same `task_type`; the framework, state machine, persistence, event logging, REST API, and UI flows stay identical.

## Three input modes

```bash
# 1. Structured form (the default UI flow)
curl -X POST /api/v1/tasks \
  -d '{"task_type":"forward_prediction","title":"Predict KV100",
       "input":{"input_type":"structured","payload":{"formula_version_id":"fv-1","target_metric":"KV_100C"},"is_primary":true}}'

# 2. Natural language (chat-style)
curl -X POST /api/v1/tasks \
  -d '{"task_type":"knowledge_qa","title":"What is the recommended P limit?",
       "input":{"input_type":"natural_language","raw_text":"What is the recommended phosphorus limit for API SP engine oils?","is_primary":true}}'

# 3. Template-filled
curl -X POST /api/v1/tasks \
  -d '{"task_type":"new_product_generation","title":"5W-30 candidate generation",
       "input_mode":"template","template_id":"<uuid-of-tpl.new_product.engine_oil_5W30>",
       "input":{"input_type":"template_filled","payload":{...},"is_primary":true}}'
```

The service validates the structured payload against the handler's required fields. Add JSON Schema validation against `template.input_schema` in a follow-up if you want strict enforcement.

## REST API

| Method | Path | Notes |
|--------|------|-------|
| POST   | `/tasks`                       | create (optional inline `input`) |
| GET    | `/tasks`                       | filter by `task_type`, `status`, `tag`, `related_*` |
| GET    | `/tasks/:id`                   | full view: task + inputs + outputs + recent events + allowed_actions |
| PATCH  | `/tasks/:id`                   | edit a draft (requires `expected_version` for OCC) |
| DELETE | `/tasks/:id`                   | soft delete |
| POST   | `/tasks/:id/submit`            | draft → submitted (kicks off handler) |
| POST   | `/tasks/:id/cancel`            | draft\|submitted → cancelled |
| POST   | `/tasks/:id/archive`           | terminal → archived |
| POST   | `/tasks/:id/restore`           | archived → prior terminal status |
| POST   | `/tasks/:id/manual-override`   | ops-only force-status (writes `manual_override` event) |
| GET    | `/tasks/:id/inputs`            | list inputs |
| POST   | `/tasks/:id/inputs`            | attach an input |
| GET    | `/tasks/:id/outputs`           | list outputs |
| POST   | `/tasks/:id/outputs`           | attach an output (mostly handler-internal; exposed for tooling) |
| GET    | `/tasks/:id/events`            | paginated transition log |
| GET    | `/tasks/templates`             | filter by `task_type` |
| GET    | `/tasks/templates/:code`       | one template |
| GET    | `/tasks/handlers`              | what handlers are wired in |

Every response uses the platform's unified envelope (`code`, `message`, `data`, `traceId`, `timestamp`).

## End-to-end example

```bash
# 1. List the templates
curl http://localhost:3001/api/v1/tasks/templates?task_type=forward_prediction | jq

# 2. Create a draft with an inline structured input
curl -X POST http://localhost:3001/api/v1/tasks \
  -H 'Content-Type: application/json' \
  -d '{
    "task_type": "forward_prediction",
    "title": "Predict KV@100°C for 5W-30 v1.1.0",
    "input": {
      "input_type": "structured",
      "payload": { "formula_version_id":"99999999-9999-9999-9999-999999999902", "target_metric":"KV_100C" },
      "is_primary": true
    }
  }' | jq
# → returns task with status=draft

TASK=$(curl -s http://localhost:3001/api/v1/tasks | jq -r '.data.items[0].id')

# 3. Submit it
curl -X POST http://localhost:3001/api/v1/tasks/$TASK/submit | jq
# → 202 Accepted, status=submitted; handler runs out-of-band → completed

# 4. Inspect after a moment
curl http://localhost:3001/api/v1/tasks/$TASK | jq

# 5. Tail the event log
curl http://localhost:3001/api/v1/tasks/$TASK/events | jq

# 6. Archive it
curl -X POST http://localhost:3001/api/v1/tasks/$TASK/archive -d '{"reason":"superseded"}' \
  -H 'Content-Type: application/json' | jq
```

A typical event log for a successful task:

```
created           null     → draft
input_attached    null     → null
submitted         draft    → submitted
processing_started submitted → processing
output_attached   null     → null     (×N — one per output the handler emitted)
completed         processing → completed
```

## Trace ID propagation

Every task carries a `trace_id` from creation onward. The submit endpoint reuses the request's `x-trace-id`; subsequent state transitions (including the async handler run) continue under that same id via `withContext({ traceId })`. Result:

- Every event row has the same `trace_id` as the originating HTTP request.
- Pino log lines from the handler carry the same trace_id automatically.
- Joining `r_and_d_task_events.trace_id` against backend logs gives the full timeline of a task.

## Adding a new task type

1. Add the value to the `task_type` `CHECK` constraint in `r_and_d_tasks` and `r_and_d_task_templates` (new migration).
2. Implement `TaskHandler` for the new type:
   ```ts
   class MyHandler extends MockHandler {
     readonly task_type = 'my_new_type' as const;
     protected requiredFields() { return ['x','y']; }
     async execute(ctx) { /* ... */ }
   }
   ```
3. Register it in `HandlerRegistry`'s default list (or via `registry.register()` from outside).
4. Seed a default template under `r_and_d_task_templates`.
5. Add the literal to the `AiTaskType` union in `types.ts` and the zod enum in `routes.ts`.

The state machine, REST routes, persistence, and event log require no changes.

## Testing

```bash
pnpm -F @fluidmind/backend test
```

Module-specific suites:

- `tests/unit/tasks/state-machine.test.ts` — every legal/illegal transition, `allowedActions`, `guardAction`, `restoreTargetFromEvents`
- `tests/unit/tasks/handlers.test.ts` — registry lookup, per-handler `validateInput`, mock `execute()` shapes (forward / batch / replacement / Q&A), determinism property

## Operational notes

- **OCC on draft updates**: `PATCH /tasks/:id` requires `expected_version` and the SQL `UPDATE … WHERE version = $expected` enforces it. A version mismatch returns `ConflictError`.
- **Status drift on transitions**: every state transition is `UPDATE … WHERE status = $expected_from`. If two clients race, only one wins; the loser gets a `ConflictError` and re-loads.
- **Async handler**: `submit` returns `202 Accepted` immediately; the handler runs out-of-band. UI should poll `/tasks/:id` (or open a websocket — out of scope here) for status changes.
- **Idempotent retry**: a `failed` task can be picked up again via `manual-override` to `submitted` or by re-submitting after edits. The retry creates a `retry` event so prior failures are auditable.
- **Soft delete**: tasks are never hard-deleted from the API. The `deleted_at` column hides them from listings; events and outputs remain intact for historic queries.
- **Stuck `processing` tasks**: an ops user can `manual-override` to `failed` or `cancelled` with a reason. The override is recorded as a distinct event so it never silently pretends the run finished normally.
