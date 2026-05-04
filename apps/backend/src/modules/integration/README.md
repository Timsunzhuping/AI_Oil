# Data Integration & Sync Foundation

A pluggable, observable, retryable framework for pulling data into FluidMind from external systems — SAP / ERP, LIMS, and file/object storage today; Salesforce, MES, REST APIs, etc. tomorrow.

```
/api/v1/integration
├── /sources               source registry CRUD + test-connection
├── /adapters              registry introspection
├── /jobs                  list, fetch, retry, tail logs
├── /jobs/:id/logs         job event stream
├── /sync                  ad-hoc trigger
├── /snapshots             cursor / watermark state
└── /schedules             cron-like declarative schedules
```

## Why this layer

Without a unifying integration layer, every connector becomes its own snowflake — different retry semantics, different cursor handling, different log shapes, different failure modes. By centralizing all of those concerns in **one** framework, we get:

- **One adapter contract** — every new system implements the same interface.
- **One job lifecycle** — queued → running → succeeded/partial/failed/timeout.
- **One retry policy** — exponential backoff + jitter, applied uniformly.
- **One log format** — every event written to `integration_job_logs`, tagged with `trace_id` from the request that triggered it.
- **One snapshot table** — cursor / watermark state per `(source, entity_type)` pair.
- **One scheduler** — declarative `interval_minutes` or `cron_expr`; in-process today, replaceable with k8s CronJob / Temporal in prod.

## Architecture

```
                    ┌──────────────────────────────────────┐
                    │ HTTP / Scheduler trigger             │
                    └─────────────┬────────────────────────┘
                                  │
                    ┌─────────────▼────────────────────────┐
                    │ JobRunner                            │
                    │  • createJob()                       │
                    │  • markRunning()                     │
                    │  • adapter.extract*  ─┐              │
                    │  • loader(record)    ─┘ per record   │
                    │  • upsertSnapshot()                  │
                    │  • markFinished() / scheduleRetry()  │
                    └────────┬─────────────────────────┬───┘
                             │                         │
                ┌────────────▼─────────┐  ┌────────────▼──────────┐
                │ AdapterRegistry      │  │ IntegrationRepository │
                │  ├── MockSapAdapter  │  │  • sources            │
                │  ├── MockLimsAdapter │  │  • jobs               │
                │  └── MockFileAdapter │  │  • job_logs           │
                └──────────────────────┘  │  • sync_snapshots     │
                                          │  • schedules          │
                                          └────────────┬──────────┘
                                                       │
                                          ┌────────────▼──────────┐
                                          │ PostgreSQL            │
                                          └───────────────────────┘
```

## Adapter contract

Every connector implements `Adapter`:

```ts
export interface Adapter {
  readonly sourceType: SourceType;
  capabilities(): EntityCapability[];
  testConnection(source: SourceRow): Promise<ConnectionTestResult>;
  extractFull(ctx: ExtractContext): AsyncIterable<AdapterRecord>;
  extractIncremental(ctx: ExtractContext, cursor: Cursor | null): AsyncIterable<AdapterRecord>;
  nextCursor(currentCursor: Cursor | null, lastRecord: AdapterRecord | null): Cursor | null;
}
```

Key properties:

- **Streamed**: `extract*` is an `AsyncIterable`, not a giant array. The runner pumps records one-at-a-time into the loader so memory stays bounded.
- **Cursor-aware**: incremental sync receives the prior cursor; the adapter decides what shape to encode (`{ since: ISO8601 }` for SAP/LIMS, `{ since_mtime, last_etag }` for files).
- **Self-describing**: `capabilities()` lists which entity types the adapter knows how to extract and whether each supports incremental.
- **Observable**: `testConnection()` returns `{ ok, latency_ms, details, error }` — the UI can ping a source before scheduling it.

### Replacing a mock with real

The mocks under `adapters/{sap,lims,file}.ts` are deterministic generators. To swap in a real client:

1. Create a class extending `BaseAdapter`.
2. Implement `extractFull`/`extractIncremental` against the real API/SDK.
3. Use `source.config` and `source.secret_ref` (resolved via your secret store) for connection details.
4. Register it in `adapters/registry.ts` instead of the mock.

Nothing in the runner, scheduler, retry, or REST layer needs to change.

## Job lifecycle

Each sync invocation creates a row in `integration_jobs`. The runner moves it through:

| Status      | When set                                                |
|-------------|---------------------------------------------------------|
| `queued`    | Job row created (immediately on trigger)                |
| `running`   | Runner has picked it up and `started_at = NOW()`        |
| `succeeded` | All records loaded, no failures                         |
| `partial`   | Some records loaded, some failed (counters tell story)  |
| `failed`    | Top-level exception; iteration aborted                  |
| `timeout`   | `timeoutMs` exceeded mid-iteration                      |
| `cancelled` | Manual cancel (TODO)                                    |

Every transition is recorded with timestamps. `duration_ms` is populated on completion.

### Retry

When a job ends in `failed` and `attempt_number < max_attempts`:

1. The runner computes `next_retry_at = now + computeBackoffMs(attempt)`.
2. The scheduler's tick (or a manual `POST /jobs/:id/retry`) creates a NEW job row with `parent_job_id` pointing at the failed one and `attempt_number + 1`.
3. Backoff is **exponential with full jitter**, capped at 1 hour. With `default_retry_backoff_ms = 30_000`:
   - Attempt 1 → wait ~30 s
   - Attempt 2 → wait ~1 m
   - Attempt 3 → wait ~2 m
   - Attempt 4+ → wait ~4 m, 8 m, 16 m, ... (capped at 60 m)

The `parent_job_id` chain lets the UI show "this is retry 3 of job-abc; original failure was X."

### Records / counters

The runner aggregates per-record outcomes into the job row:

| Counter               | Meaning                                                |
|-----------------------|--------------------------------------------------------|
| `records_extracted`   | rows pulled from the adapter                           |
| `records_transformed` | rows that survived transform (currently == extracted)  |
| `records_loaded`      | rows the loader returned `inserted` or `updated`       |
| `records_failed`      | loader returned `failed` OR threw                      |
| `records_skipped`     | loader returned `unchanged` (etag/hash matched)        |

A **per-row failure does NOT abort the batch** — it logs an `error` event in `integration_job_logs` and the runner moves on. Only an exception thrown OUTSIDE the per-row try/catch (e.g., adapter died mid-stream) ends the job.

## Trace ID propagation

Every job is bound to a `trace_id`:

- If triggered by an HTTP request, the request's `x-trace-id` header is passed in.
- If triggered by the scheduler or a retry, a fresh UUID v4 is minted.

Inside the runner, `withContext({ traceId, ... })` wraps the entire iteration. The Pino logger's `mixin` automatically picks up the trace_id, so every log line — including ones emitted from the adapter itself — is correlated with the job. The trace_id is also stored on:

- `integration_jobs.trace_id`
- `integration_job_logs.trace_id` (for each log entry)
- The HTTP response (via the existing `requestId` middleware)

## REST API

### Sources

| Method | Path | Notes |
|--------|------|-------|
| GET    | `/sources`                       | filter by `source_type`, `is_active` |
| POST   | `/sources`                       | upsert by `code` |
| GET    | `/sources/:id`                   | |
| DELETE | `/sources/:id`                   | soft delete |
| POST   | `/sources/:id/test-connection`   | dispatches to adapter; no DB writes |
| GET    | `/adapters`                      | list registered adapters and their capabilities |

### Jobs

| Method | Path | Notes |
|--------|------|-------|
| GET    | `/jobs`                  | filter `source_id`, `entity_type`, `status` |
| GET    | `/jobs/:id`              | full row + 50 most recent log entries |
| GET    | `/jobs/:id/logs`         | paginated logs (`?limit=&offset=`) |
| POST   | `/jobs/:id/retry`        | clones with `attempt_number+1` and runs immediately |

### Sync trigger

```bash
curl -X POST http://localhost:3001/api/v1/integration/sync \
  -H 'Content-Type: application/json' \
  -d '{
        "source_code": "sap_prod",
        "entity_type": "raw_materials",
        "job_type": "incremental_sync"
      }'
```

Response (HTTP 202):

```json
{
  "code": 0,
  "message": "Sync triggered",
  "data": {
    "job_id": "uuid",
    "trace_id": "uuid",
    "status": "succeeded",
    "records_extracted": 4,
    "records_loaded": 4,
    "records_failed": 0,
    "records_skipped": 0,
    "duration_ms": 38
  },
  "traceId": "uuid",
  "timestamp": "..."
}
```

### Snapshots

```bash
curl 'http://localhost:3001/api/v1/integration/snapshots?source_id=...'
```

Returns the cursor state — useful for "where are we?" UI tiles.

### Schedules

| Method | Path | Notes |
|--------|------|-------|
| GET    | `/schedules`     | filter `is_active` |
| POST   | `/schedules`     | upsert by `(source_id, entity_type, job_type)` |
| DELETE | `/schedules/:id` | soft delete |

A schedule needs **either** `cron_expr` **or** `interval_minutes`. The scheduler skeleton implements `interval_minutes`; cron parsing can plug in via a 3rd-party lib (`cron-parser`) without touching the runner.

## Scheduler

The in-process scheduler ticks every 30 s by default. On each tick:

1. Pull every active schedule whose `next_run_at <= now`.
2. Run each via the JobRunner (sequentially — adapt to a worker pool when load grows).
3. Advance `next_run_at` based on `interval_minutes`.
4. Sweep `integration_jobs` for `status='failed' AND next_retry_at <= now AND attempts < max` and run those too.

In production, replace this with:

- **Kubernetes CronJob**: external trigger that posts to `POST /sync`. The scheduler skeleton becomes pure DB metadata; no in-process loop.
- **Temporal / Cadence / Airflow**: orchestrator owns scheduling and retries; the integration module becomes a thin worker.

The `IntegrationScheduler` exposes `start()` / `stop()` / `tick()`. The `tick()` is unit-testable in isolation.

## Database schema

Owned by this module:

- `integration_sources`
- `integration_jobs` *(append-mostly; rows updated only for status / counters / completion)*
- `integration_job_logs` *(append-only stream of phase events)*
- `sync_snapshots` *(one row per `(source, entity)` pair)*
- `integration_schedules`

See `infra/db/migrations/0012_integration.sql` and `infra/db/ERD.md`.

## Loaders

The runner is generic — it doesn't know what "raw_materials" means. Loaders bridge that gap. They live in `loaders.ts` and are dispatched by `entity_type`:

```ts
case 'raw_materials':  return makeRawMaterialsLoader(pool);
case 'suppliers':      return makeSuppliersLoader(pool);
case 'test_results':   return makeTestResultsLoader(pool);
case 'experiments':    return makeExperimentsLoader(pool);
case 'documents':      return makeDocumentsLoader(pool);
```

A loader receives one `AdapterRecord` and returns `{ outcome: 'inserted' | 'updated' | 'unchanged' | 'failed', destination_id?, error? }`.

The shipped loaders:

- **idempotent by `code`** — re-running a sync updates rather than duplicates.
- **stash `external_id` in `metadata`** so we can join back to the upstream system.
- **honor etag/hash for change detection** — files with unchanged etag return `unchanged` (counted as `skipped`, not `loaded`).

## Testing

```bash
pnpm -F @fluidmind/backend test
```

Module-specific suites:

- `tests/unit/integration/retry.test.ts` — backoff math, exponential growth, jitter, cap
- `tests/unit/integration/adapters.test.ts` — mock adapter capabilities, cursor-based filtering, registry resolution

End-to-end testing requires a real Postgres. The mocks plus the real DB give you a fully functional sync pipeline without any external system.

## Try it locally

```bash
# 1. Spin up the DB (auto-runs migrations + seeds → integration_sources rows are created)
docker-compose up -d postgres

# 2. Boot backend
pnpm -F @fluidmind/backend dev

# 3. List adapters
curl http://localhost:3001/api/v1/integration/adapters

# 4. Test a connection
SRC=$(curl -s http://localhost:3001/api/v1/integration/sources | jq -r '.data[0].id')
curl -X POST http://localhost:3001/api/v1/integration/sources/$SRC/test-connection

# 5. Trigger a sync
curl -X POST http://localhost:3001/api/v1/integration/sync \
  -H 'Content-Type: application/json' \
  -d '{"source_code":"sap_prod","entity_type":"raw_materials","job_type":"incremental_sync"}'

# 6. Inspect jobs
curl http://localhost:3001/api/v1/integration/jobs

# 7. Tail logs
JOB=$(curl -s http://localhost:3001/api/v1/integration/jobs | jq -r '.data.items[0].id')
curl "http://localhost:3001/api/v1/integration/jobs/$JOB/logs"

# 8. Cursor state
curl http://localhost:3001/api/v1/integration/snapshots
```

Run the same `/sync` again — the second invocation will find no new records (cursor advanced) and report `records_extracted: 0`.

## What to add next

- **Cron expression parsing** — wire `cron-parser` so `cron_expr` schedules tick on standard cron grammar.
- **Worker pool** — replace the sequential `for` in `scheduler.tick()` with a bounded concurrency pool so one slow source doesn't block fast ones.
- **CDC ingest** — for sources that emit Kafka/SNS events, add an `extractFromStream` flavor and bypass cursor polling.
- **Dead-letter queue** — when a job exhausts retries, fan-out the failed records to a `dead_letter_records` table for human triage.
- **Real adapters** — start with the SAP OData client, then add Salesforce, S3, and a generic webhook adapter.
