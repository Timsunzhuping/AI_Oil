# Data Cleaning & Standardization Pipeline

Turns messy, multi-system raw data into ML-ready, audit-friendly clean records.

```
/api/v1/cleaning
├── /runs                     trigger + list pipeline runs
├── /runs/:id                 one run
├── /runs/:id/report          quality report (aggregations + samples)
├── /issues                   browse data_quality_issues with filters
├── /issues/:id/resolve       acknowledge / fix / wont-fix an issue
├── /normalized/test-results  query the clean fact table
└── /rules                    cleaning_rules CRUD
```

## Why this layer

The integration layer pulls raw rows from upstream systems (SAP / LIMS / files). The master-data layer has the standard reference codes. The cleaning layer is the bridge: every raw row is transformed into a `normalized_*` row that:

- references the canonical master-data record (or is flagged unresolved)
- carries BOTH `raw_value` and `normalized_value` so a human can audit the transform
- has its measurement converted into the metric's standard unit
- is checked for missing values, outliers, and spec violations
- is linked to the formula version / batch / experiment it belongs to
- never gets dropped — bad data is FLAGGED, not deleted

Downstream consumers (ML training, dashboards, optimization engine) only read `normalized_test_results` — they never touch raw `test_results`.

## Architecture

```
                     test_results (raw)
                           │
                           ▼
         ┌─────────────────────────────────┐
         │ CleaningPipeline                │
         │                                 │
         │ ResolveStage                    │
         │   • test_code → metric (m-data) │
         │   • unit_of_measure → unit      │
         │                                 │
         │ ConvertStage                    │
         │   • value × factor + offset     │
         │     into metric.default_unit    │
         │                                 │
         │ LinkStage                       │
         │   • formula_version → formula   │
         │   • batch_code → exp/version    │
         │                                 │
         │ ValidateStage                   │
         │   • missing-value detection     │
         │   • spec violation              │
         │   • declarative rules (DSL)     │
         │   • IQR fence over history      │
         │                                 │
         │ Persist                         │
         │   • upsert normalized_test_…    │
         │   • insert data_quality_issues  │
         └────────────┬────────────────────┘
                      ▼
               normalized_test_results
                      +
               data_quality_issues
                      ▼
            Quality Report (REST)
```

Every stage receives a mutable `WorkingRow` and either fills in normalized fields or appends `Issue`s. Stages NEVER drop rows; bad data lands in the normalized table with `is_outlier`/`is_missing`/`is_unresolved` flags so downstream consumers can decide how to treat it.

## Rule DSL

Rules live in `cleaning_rules` and are evaluated by `rules/engine.ts`. Each rule has a JSON `condition_expr` and a JSON `action_expr`.

### Operators

| Op         | Meaning                                  |
|------------|------------------------------------------|
| `eq` / `neq` | equality |
| `lt`/`lte`/`gt`/`gte` | numeric compare |
| `in`/`not_in` | array membership |
| `between`/`outside` | numeric in/out of `[min, max]` |
| `present`/`absent` | null/undefined/empty |
| `matches` | RegExp on string |
| `contains` | string or array containment |

### Boolean composition

```json
{ "all": [<cond>, <cond>] }     // AND
{ "any": [<cond>, <cond>] }     // OR
{ "not": <cond> }
```

### Comparing two facts

A leaf can compare its `fact` against another fact via `value_fact`:

```json
{ "fact": "value", "op": "lt", "value_fact": "metric.expected_min" }
```

### Action shapes

The action object is consumed by the validator stage. Recognized shapes:

```json
{ "flag": "outlier",       "outlier_method": "rule", "issue_code": "...", "message": "..." }
{ "flag": "missing_field", "field": "raw_unit",       "issue_code": "...", "message": "..." }
{ "flag": "unresolved",                                "issue_code": "...", "message": "..." }
```

Anything else is recorded as a generic `rule_violation` issue.

### Example rules (seeded)

```json
{
  "code": "PH_OUT_OF_PHYSICAL_RANGE",
  "rule_type": "outlier",
  "scope": "test_result",
  "severity": "error",
  "condition_expr": {
    "all": [
      { "fact": "metric.code", "op": "eq", "value": "PH" },
      { "any": [
        { "fact": "value", "op": "lt", "value": 0 },
        { "fact": "value", "op": "gt", "value": 14 }
      ]}
    ]
  },
  "action_expr": {
    "flag": "outlier",
    "outlier_method": "rule",
    "issue_code": "PH_OUT_OF_PHYSICAL_RANGE",
    "message": "pH must be in [0, 14]"
  }
}
```

```json
{
  "code": "SPEC_VIOLATION",
  "condition_expr": {
    "any": [
      { "fact": "value", "op": "lt", "value_fact": "metric.expected_min" },
      { "fact": "value", "op": "gt", "value_fact": "metric.expected_max" }
    ]
  },
  "action_expr": {
    "flag": "outlier",
    "outlier_method": "spec",
    "issue_code": "SPEC_VIOLATION",
    "message": "Value outside metric.expected_min/max"
  }
}
```

Add new rules via `POST /cleaning/rules` (idempotent on `code`). Existing rules can be deactivated with `is_active = false`.

## Outlier detection

Three independent methods, combined with **OR** — a value is an outlier if any of them fires:

| Method | Source | Notes |
|--------|--------|-------|
| `spec` | `metric.expected_min/max` (or per-row override) | Fast envelope check |
| `rule` | declarative rules from `cleaning_rules` | DSL-based (see above) |
| `iqr`  | Tukey fence over the last 200 measurements of the same metric | Skipped when fewer than 10 history points (statistically unreliable) |

`outlier_methods` is a `text[]` on the normalized row showing which methods fired. `outlier_score` is `|value - median| / IQR` — useful for ranking severity.

The pure detector functions live in `rules/outlier.ts` and are unit-tested (`tests/unit/cleaning/outlier.test.ts`).

## Quality report

`GET /api/v1/cleaning/runs/:id/report` returns:

```json
{
  "code": 0,
  "message": "success",
  "data": {
    "run_id": "uuid",
    "generated_at": "2026-05-04T12:00:00Z",
    "totals": {
      "records_processed": 8,
      "records_normalized": 8,
      "records_with_issues": 5,
      "issues_total": 7
    },
    "by_severity": { "info": 1, "warning": 5, "error": 1, "critical": 0 },
    "by_type": {
      "outlier": 3,
      "missing_value": 1,
      "spec_violation": 1,
      "unresolved_metric": 1,
      "missing_required_field": 1
    },
    "outliers": {
      "count": 3,
      "by_method": { "rule": 2, "spec": 1 },
      "top_metrics": [ { "metric_code": "PH", "count": 1 }, ... ]
    },
    "unresolved": {
      "count": 1,
      "by_field": { "test_code": 1 },
      "samples": [ { "source_test_result_id": "uuid", "raw_value": { "test_code": "..." } } ]
    },
    "missing": { "count": 1, "by_field": { "measured_value": 1 } },
    "spec_violations": { "count": 1, "top_metrics": [ { "metric_code": "KV_100C", "count": 1 } ] },
    "recent_issues": [ { "id": "uuid", "issue_type": "outlier", "severity": "error", "field": "measured_value", "message": "pH must be in [0, 14]", "created_at": "..." } ]
  },
  "traceId": "uuid",
  "timestamp": "..."
}
```

## Database

Owned by this module:

- `cleaning_runs` — every pipeline execution with summary counters
- `cleaning_rules` — declarative rule registry (JSON DSL)
- `normalized_materials` — clean material refs (raw + normalized)
- `normalized_metrics` — clean metric refs
- `normalized_test_results` — the central clean fact table; one row per source `test_results.id`
- `data_quality_issues` — granular per-issue records (one per problem)

Indexes optimized for the dashboards we anticipate:

- `is_outlier`, `is_unresolved`, `is_missing` — partial indexes for "show me bad rows"
- `metric_code` — analytics group-by
- `formula_version_id`, `batch_code` — BOM × batch joins
- `cleaning_run_id` — per-run aggregation for the report generator

## REST API

| Method | Path | Purpose |
|--------|------|---------|
| POST   | `/cleaning/runs` | Trigger a pipeline run (200 / 207 / 422 mirror status) |
| GET    | `/cleaning/runs` | List recent runs |
| GET    | `/cleaning/runs/:id` | One run |
| GET    | `/cleaning/runs/:id/report` | Aggregate quality report |
| GET    | `/cleaning/issues` | Filter by `run_id`, `issue_type`, `severity`, `status`, `entity_type` |
| PATCH  | `/cleaning/issues/:id/resolve` | Mark `acknowledged` / `fixed` / `wont_fix` |
| GET    | `/cleaning/normalized/test-results` | Filter by `metric_code`, `is_outlier`, `formula_version_id`, `batch_code`, ... |
| GET    | `/cleaning/rules` | List active rules |
| POST   | `/cleaning/rules` | Upsert a rule (idempotent on `code`) |
| DELETE | `/cleaning/rules/:id` | Soft-delete a rule |

All responses use the platform's unified envelope (`code`, `message`, `data`, `traceId`, `timestamp`).

## Try it locally

```bash
docker-compose up -d postgres        # auto-applies migration 0013 + seed 10
pnpm -F @fluidmind/backend dev

# Trigger a run over all the seeded "dirty" rows
curl -X POST http://localhost:3001/api/v1/cleaning/runs \
  -H 'Content-Type: application/json' -d '{}'

# → returns the summary; copy run_id and:

curl http://localhost:3001/api/v1/cleaning/runs/$RUN_ID/report

# Browse outliers
curl 'http://localhost:3001/api/v1/cleaning/normalized/test-results?is_outlier=true'

# Browse open issues
curl 'http://localhost:3001/api/v1/cleaning/issues?status=open&severity=error'

# Resolve one
curl -X PATCH http://localhost:3001/api/v1/cleaning/issues/$ISSUE_ID/resolve \
  -H 'Content-Type: application/json' \
  -d '{"status":"acknowledged","notes":"reviewed by chemist; expected"}'
```

## Testing

```bash
pnpm -F @fluidmind/backend test
```

Module-specific suites:

- `tests/unit/cleaning/rule-engine.test.ts` — DSL operators, boolean composition, value_fact comparison, error tolerance
- `tests/unit/cleaning/outlier.test.ts` — `checkSpec`, `quartiles`, `iqrFence`, `checkIqr` (history-aware)

End-to-end behaviour — pipeline executing real DB writes — requires a running Postgres. The shipped seeds (`10_cleaning.sql`) include 8 deliberately-dirty rows that exercise every cleaning path; running the pipeline against them produces a representative quality report on a fresh DB.

## Adding a new entity type

1. Add a `streamRaw*` method to `CleaningRepository`.
2. Define a new `WorkingRow` shape (or extend the existing one) in `types.ts`.
3. Add stages under `pipeline/stages/<resource>` reusing `MasterDataLookup`.
4. Compose them in `CleaningPipeline.run()` for the new `entity_type`.
5. Add normalized table writes in the persist step.
6. Extend the `entity_type` enums in `cleaning_runs` and `data_quality_issues`.

The `test_results` flow is the canonical example — clone its layout for materials, formula_items, etc.

## Operational notes

- **Idempotent runs**: `normalized_test_results` has `UNIQUE (source_test_result_id) WHERE deleted_at IS NULL`. Re-running the pipeline UPDATES rather than duplicates, so it's safe to re-run.
- **Rule firings counted**: `cleaning_rules.fired_count` is bumped for every match — useful to spot rules that never fire (dead) or fire constantly (too broad).
- **Trace propagation**: every run is wrapped in `withContext({ traceId })` so logs from any stage carry the same trace id, and the same id is stamped on every `data_quality_issues` row.
- **Issue resolution workflow**: `data_quality_issues.status` flows `open → acknowledged|fixed|wont_fix`. The history is retained for audit; resolution sets `resolved_at`/`resolved_by`/`resolution_notes`.
- **Performance**: pipeline streams rows through stages in memory (1000-row default batch). For very large backfills, run with `?since=...` to scope. Outlier history is cached per metric within a run, so even a 10K-row run only loads 12 history queries (one per metric).
