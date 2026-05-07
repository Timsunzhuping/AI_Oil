# ERP Integration Module

`apps/backend/src/modules/erp` — business-domain integration for SAP /
LIMS / Carbon-footprint systems. Sits ALONGSIDE the generic
`modules/integration` framework but ships its own audit tables and adapter
contracts so it can be operated independently.

```
HTTP                                    Service                Adapters
─────                                   ───────                ────────
POST /erp/sap/sync/bom              ─┐                          ┌─ SapAdapter (mock | real)
POST /erp/sap/sync/cost             ─┼─▶ ErpService ──────────▶├─ LimsAdapter (mock | real)
POST /erp/sap/sync/inventory        ─┘     │                    └─ CarbonAdapter (mock | real)
POST /erp/lims/tasks                ─┐     │
POST /erp/lims/tasks/:id/pull       ─┤     │
GET  /erp/lims/tasks                ─┤     │
GET  /erp/lims/tasks/:id            ─┘     ▼
GET  /erp/carbon/material/:code  ──────▶ withRetry  ──────────▶ adapter call
POST /erp/carbon/formula                   │
                                            ▼
GET  /erp/jobs                       ErpRepository ──────────▶ erp_jobs
GET  /erp/jobs/:id                    (insertJob /              erp_job_logs
                                       finaliseJob /            lims_task_links
                                       insertLog /
                                       upsertLimsLink)
```

## Endpoints

### SAP

| Method | Path                             | Purpose                               |
| ------ | -------------------------------- | ------------------------------------- |
| `POST` | `/api/v1/erp/sap/sync/bom`       | Pull BOM lines (full or incremental). |
| `POST` | `/api/v1/erp/sap/sync/cost`      | Pull material unit costs.             |
| `POST` | `/api/v1/erp/sap/sync/inventory` | Pull inventory levels per plant.      |

Body (all three share the same shape):

```jsonc
{
  "mode": "incremental", // 'full' | 'incremental'  (default 'incremental')
  "cursor": { "since": "2026-04-01T00:00:00Z" }, // adapter-specific shape
  "limit": 100, // adapter hint
  "max_attempts": 3, // retry budget; default 3
  "metadata": { "source": "ui" },
}
```

Response envelope `data`:

```jsonc
{
  "job_id": "<uuid>",
  "status": "succeeded",
  "records_extracted": 5,
  "records_loaded": 5,
  "records_failed": 0,
  "cursor_from": null,
  "cursor_to": { "since": "2026-04-08T00:00:00Z" },
  "records": [
    /* SapBomLine[] | SapCostRecord[] | SapInventoryRecord[] */
  ],
  "trace_id": "…",
  "duration_ms": 12,
}
```

### LIMS

| Method | Path                                  | Purpose                                                            |
| ------ | ------------------------------------- | ------------------------------------------------------------------ |
| `POST` | `/api/v1/erp/lims/tasks`              | Push: create a LIMS test task and persist a `lims_task_links` row. |
| `POST` | `/api/v1/erp/lims/tasks/:linkId/pull` | Pull: fetch latest status + metrics; updates the link.             |
| `GET`  | `/api/v1/erp/lims/tasks`              | Paginated list of LIMS task links.                                 |
| `GET`  | `/api/v1/erp/lims/tasks/:linkId`      | Single link detail.                                                |

Create body:

```jsonc
{
  "test_method": "KV_100C",
  "internal_experiment_id": "<uuid>",
  "related_formula_version_id": "<uuid>",
  "sample_count": 2,
  "due_date": "2026-05-15",
  "notes": "为新配方做对照",
}
```

Pull body (optional):

```jsonc
{ "external_lims_task_id": "LIMS-XYZ", "max_attempts": 3 }
```

State machine for `lims_task_links.status`:

```
created (auto) ─▶ submitted ─▶ in_progress ─▶ completed
                                              └─▶ failed
                                              └─▶ cancelled
```

### Carbon

| Method | Path                                         | Purpose                        |
| ------ | -------------------------------------------- | ------------------------------ |
| `GET`  | `/api/v1/erp/carbon/material/:material_code` | Per-material kgCO₂e/kg lookup. |
| `POST` | `/api/v1/erp/carbon/formula`                 | Estimate kgCO₂e/kg of a BOM.   |

Formula body:

```jsonc
{
  "product_category": "engine_oil_pcmo",
  "bom": [
    { "material_code": "RM-PAO-6", "ratio": 0.5 },
    { "material_code": "RM-GIII-4", "ratio": 0.5 },
  ],
}
```

### Job introspection

| Method | Path                   | Purpose                                                                   |
| ------ | ---------------------- | ------------------------------------------------------------------------- |
| `GET`  | `/api/v1/erp/jobs`     | Paginated audit trail (filter by `source_system`, `operation`, `status`). |
| `GET`  | `/api/v1/erp/jobs/:id` | Single job detail + per-job log trail.                                    |

## Adapters

Three pluggable contracts live under `adapters/`:

```ts
SapAdapter: syncBom / syncCost / syncInventory + testConnection;
LimsAdapter: createTask / pullResult / listTasks + testConnection;
CarbonAdapter: lookupMaterial / estimateFormula + testConnection;
```

Each ships with a deterministic mock — every call seeded by inputs / counters
so tests are reproducible. To plug a real adapter:

```ts
class RealSapAdapter implements SapAdapter {
  /* node-rfc / OData */
}
class RealLimsAdapter implements LimsAdapter {
  /* vendor REST */
}
class RealCarbonAdapter implements CarbonAdapter {
  /* ecoinvent / GaBi */
}

buildErpModule(pool, logger, {
  sap: { adapter: new RealSapAdapter() },
  lims: { adapter: new RealLimsAdapter() },
  carbon: { adapter: new RealCarbonAdapter() },
});
```

Env hooks:

| Var               | Default | Purpose                                                                                        |
| ----------------- | ------- | ---------------------------------------------------------------------------------------------- |
| `ERP_SAP_MODE`    | `mock`  | Set to `real` to attempt a real SAP adapter (still returns mock unless `adapter` is supplied). |
| `ERP_LIMS_MODE`   | `mock`  | Same flag for LIMS.                                                                            |
| `ERP_CARBON_MODE` | `mock`  | Same flag for Carbon.                                                                          |

## Retry & audit

Every business call is wrapped in `withRetry()`:

```
attempt 1  →  fail  →  sleep ~200ms (jittered)
attempt 2  →  fail  →  sleep ~400ms
attempt 3  →  fail  →  throw UpstreamError
```

Each attempt:

- bumps `erp_jobs.attempt_number` (when > 1)
- writes a `warn`/`error` log to `erp_job_logs` with the failure context

Final state is `succeeded`, `partial`, or `failed`; the response payload is
captured under `erp_jobs.response_payload` for replay.

`max_attempts` is per-call (request body) and capped at 8.

## Database

| Table             | Purpose                                                                                                                                                                                   |
| ----------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `erp_jobs`        | One row per business call. Code `ERP-YYYY-NNNNNN`. Captures source/operation/mode/status/cursor/counters/payload/error/trace_id.                                                          |
| `erp_job_logs`    | Append-only event log per job (`level`, `phase`, `message`, `context`).                                                                                                                   |
| `lims_task_links` | Internal experiment ↔ external LIMS task. Tracks lifecycle (created/submitted/in_progress/completed/failed/cancelled), result payload, and lineage to the most recent create / pull jobs. |

See migration
[`infra/db/migrations/0020_erp_integration.sql`](../../../../infra/db/migrations/0020_erp_integration.sql).

### Why we don't reuse `integration_jobs`

The `modules/integration` framework's `integration_sources` table CHECKs
`source_type IN ('sap','lims','file')` — not extensible to `'carbon'`
without altering. The ERP module also has different semantics (push for
LIMS create_task, lookup for Carbon) than the cursor-iterator framework.
Keeping a dedicated audit set avoids coupling and keeps each module
debuggable in isolation. The two layers DO share the request-scoped
`trace_id` so cross-module correlation still works.

## Background scheduler

Optional cron-like scheduler runs SAP syncs on a timer. Disabled by default
— pass a `schedule` array to `buildErpModule({ schedule: [...] })`:

```ts
buildErpModule(pool, logger, {
  schedule: [
    { name: 'sap_bom', operation: 'sap_bom_sync', intervalMs: 30 * 60 * 1000 },
    { name: 'sap_cost', operation: 'sap_cost_sync', intervalMs: 60 * 60 * 1000 },
    { name: 'sap_inventory', operation: 'sap_inventory_sync', intervalMs: 15 * 60 * 1000 },
  ],
});
// Then:
erp.scheduler.start(); // background drain
erp.scheduler.runAllOnce(); // admin trigger / tests
```

For production deployments, swap the in-process timer for a k8s CronJob,
Temporal worker, or BullMQ scheduler — they all just need to call the
`/api/v1/erp/sap/sync/*` endpoints (or hold a `service` reference directly).

## Tests

```
tests/unit/erp/
  adapters.test.ts   MockSap / MockLims / MockCarbon — happy + failure paths
  retry.test.ts      computeBackoffMs + withRetry hooks + max-attempts
  schemas.test.ts    Zod parsing for /sap/sync, /lims/tasks, /carbon/formula
  service.test.ts    end-to-end service over a fake repository: sync / push /
                     pull / carbon, retries, audit log writing, NotFound /
                     UpstreamError surfaces
  _fakes.ts          FakeErpRepository
```

Run only the ERP tests:

```bash
pnpm --filter @fluidmind/backend test -- tests/unit/erp
```

## Wiring

Mounted at `/api/v1/erp` from `src/routes/v1/index.ts` whenever pool +
logger are both available. Sits AFTER the QA / knowledge / prediction
modules — it has no compile-time dependency on them, but the ordering keeps
related routes together in the introspection JSON.

## Trace propagation

Every endpoint reads `req.traceId` (provided by the global `requestId`
middleware) and threads it through:

- `erp_jobs.trace_id`
- `erp_job_logs.trace_id`
- `lims_task_links.trace_id`
- adapter `ctx.trace_id`

so a single trace ID stitches together the HTTP request, the audit row,
the per-attempt log entries, the LIMS link, and any downstream adapter
call. `triggered_by` captures the authenticated user when present.
