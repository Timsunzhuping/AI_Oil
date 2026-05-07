# Testing & Acceptance Support Module

`apps/backend/src/modules/evaluation` — automates model acceptance for the
FluidMind platform. Three orthogonal flavours run against versioned, on-disk
test datasets and produce frontend-ready JSON reports plus an exportable
Markdown sign-off:

| Flavour       | What it answers                                                                   | Inputs                               | Outputs                                                                                                   |
| ------------- | --------------------------------------------------------------------------------- | ------------------------------------ | --------------------------------------------------------------------------------------------------------- |
| **forward**   | "Given this BOM, does the predictor land within tolerance of the lab metrics?"    | `{ bom, expected_metrics }` per case | MAPE / MAE / RMSE / hit-rate by case, by category, by metric, and category × metric matrix                |
| **inverse**   | "Given a target spec, do recommended candidates pass the configured constraints?" | `{ request, expectations }` per case | feasibility-rate, top-1 feasibility, must-have material checks, cost / confidence / risk gates            |
| **stability** | "Same input × N runs — is the output stable enough to trust?"                     | `{ mode, payload, runs }` per case   | pairwise cosine, per-metric coefficient of variation (predict mode) or Jaccard + cost CV (recommend mode) |

```
HTTP                                Service                    Persistence
─────                               ───────                     ───────────
POST   /evaluation/test-sets    ─┐                             ┌─ acceptance_test_sets
GET    /evaluation/test-sets    ─┼─▶ EvaluationService ────────┤   (versioned test datasets)
GET    /evaluation/test-sets/:id─┘        │                    │
                                          ├─▶ runForward       ├─ acceptance_runs
POST   /evaluation/runs           ────────┼─▶ runInverse  ─────┤   (one row per acceptance run + summary JSONB)
GET    /evaluation/runs                   └─▶ runStability     │
GET    /evaluation/runs/:id                       │            └─ acceptance_results
GET    /evaluation/runs/:id/export                │               (per-case drill-down)
                                                  ▼
                                         Predictor + Pipeline
                                            (injected adapters)
```

## Endpoints

| Verb   | Path                          | Body / Query                                  | Notes                                                                                                                        |
| ------ | ----------------------------- | --------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------- |
| `POST` | `/evaluation/test-sets`       | `CreateTestSetSchema`                         | `code` auto-generated as `TS-YYYY-NNNN` if omitted.                                                                          |
| `GET`  | `/evaluation/test-sets`       | `?test_type&status&q&page&pageSize`           | Lists test sets; pageSize ≤ 200.                                                                                             |
| `GET`  | `/evaluation/test-sets/:id`   | —                                             | 404 on unknown id.                                                                                                           |
| `POST` | `/evaluation/runs`            | `RunRequestSchema`                            | Runs synchronously (the runners are bounded — milliseconds for default cases). Returns `{ run, results }`.                   |
| `GET`  | `/evaluation/runs`            | `?test_set_id&test_type&status&page&pageSize` |                                                                                                                              |
| `GET`  | `/evaluation/runs/:id`        | —                                             | Returns `{ run, results }`.                                                                                                  |
| `GET`  | `/evaluation/runs/:id/export` | `?format=json\|markdown`                      | Streams as `Content-Disposition: attachment` — JSON round-trips `runs.summary`, Markdown is human-readable for UAT sign-off. |

All endpoints respond with the unified envelope
`{ code, message, data, traceId, timestamp }` (or paginated envelope on list endpoints).

## Test types in detail

### Forward — `ForwardCase`

```jsonc
{
  "id": "fwd-0001",
  "category": "engine_oil_pcmo",
  "bom": [
    {
      "material_code": "PAO-6",
      "material_name": "PAO-6",
      "role": "base_oil",
      "ratio": 0.42,
    } /* ... */,
  ],
  "expected_metrics": { "KV_100C": 11.4, "VI": 165 },
  "tolerance": { "max_relative_error": 0.05 }, // optional per-case override
}
```

- Per-metric **MAPE / MAE / RMSE / hit-rate** are computed against `expected_metrics`.
- A case **passes** when its hit-rate ≥ `min_metric_pass_rate` (default 0.8).
- Hit predicate: `|predicted − expected| / max(|expected|, ε) ≤ max_relative_error`,
  with `max_absolute_error` as fallback when `|expected| ≈ 0`.
- The report includes per-category, per-metric, and category × metric matrix
  aggregates so the workbench can render heat-maps directly.

### Inverse — `InverseCase`

```jsonc
{
  "id": "inv-0001",
  "request": {
    "product_category": "engine_oil_pcmo",
    "target_metrics": [{ "name": "KV_100C", "target": 11 }],
    "cost_limit": 30,
    "n_candidates": 3,
    "random_seed": 1,
  },
  "expectations": {
    "min_passed_candidates": 1,
    "top1_must_have_materials": ["PAO-6"],
    "top1_max_cost": 25,
    "top1_min_confidence": 0.7,
    "no_critical_risks_top": 1,
  },
}
```

- Calls the recommendation pipeline in-process (decoupled via the narrow
  `LimitedRecommendationPipeline` shape).
- A case passes when **every** populated expectation is satisfied. Failure
  reason is captured per case (e.g. `top1 cost 28 exceeds 25`).
- Aggregates: `feasibility_rate`, `top1_feasibility_rate`,
  `avg_passed_candidates`, `avg_top1_cost`, `avg_top1_confidence`.

### Stability — `StabilityCase`

```jsonc
{
  "id": "stab-0001",
  "mode": "predict", // or "recommend"
  "runs": 5,
  "payload": {
    "product_category": "p",
    "bom_items": [
      /* ... */
    ],
    "target_metrics": ["KV_100C", "VI"],
  },
  "tolerance": { "min_pairwise_cosine": 0.95, "max_cv": 0.05 },
}
```

- **predict mode**: builds a vector per run from the predictor's metrics,
  computes pairwise cosine similarity + per-metric coefficient of variation.
- **recommend mode**: runs the pipeline N times, computes Jaccard similarity
  over candidate code-sets and CV of top-1 cost.
- A case passes when `pairwise_cosine_avg ≥ min_pairwise_cosine` AND
  `max_cv ≤ max_cv`.

## Metric catalogue

| Helper                              | Where                 | Notes                                      |
| ----------------------------------- | --------------------- | ------------------------------------------ | ----- | --- | ----- | --- |
| `mae(actual, predicted)`            | forward               | mean absolute error, null-safe.            |
| `rmse(actual, predicted)`           | forward               | √(mean((actual − predicted)²)).            |
| `mape(actual, predicted)`           | forward               | mean absolute percentage error, ε-guarded. |
| `hitRate / isHit`                   | forward               | relative + absolute tolerance fallback.    |
| `cosineSimilarity / pairwiseCosine` | stability (predict)   | returns `{ avg, min }`.                    |
| `coefficientOfVariation(values)`    | stability (predict)   | returns 0 when `mean ≈ 0`.                 |
| `jaccard<T>(a, b)`                  | stability (recommend) | `                                          | a ∩ b | /   | a ∪ b | `.  |
| `passRate / round4`                 | aggregates            | utility helpers.                           |

All helpers live in [`metrics.ts`](./metrics.ts) and have no DB / pipeline
dependencies — pure functions, easy to unit-test.

## Report structure

Persisted on `acceptance_runs.summary` (JSONB) and round-tripped by the JSON
exporter. Common envelope on every report:

```ts
{
  run_id, code, test_set_id, test_type,
  model: { code, version, mode },
  status, started_at, completed_at, duration_ms,
  totals: { cases_total, cases_passed, cases_failed, pass_rate },
  trace_id, generated_at,

  // test-type specific:
  overall_metrics: { … },
  by_category:    [ { category, n, passed, …aggregates } ],
  by_metric:      [ { metric,   n,         …aggregates } ],   // forward / stability
  matrix:         [ { category, metric, n, …aggregates } ],   // forward
  case_results:   [ { case_id, category, passed, metrics, failure_reason, … } ],
}
```

The frontend reads this object directly — there is no transformation layer.

## Database

Migration **0023**:

| Table                  | Purpose                                                                                                                                                                                               |
| ---------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `acceptance_test_sets` | Versioned test datasets. Code = `TS-YYYY-NNNN`. `cases` JSONB carries the per-test-type case shape.                                                                                                   |
| `acceptance_runs`      | One row per run. Code = `AR-YYYY-NNNNNN`. Carries `summary` (full JSON report) plus indexed counters (`cases_total/passed/failed`, `duration_ms`, model identity, trigger type, error class/message). |
| `acceptance_results`   | Per-case drill-down for forensics — the same data also lives nested inside `summary.case_results`, but a flat table is friendlier to ad-hoc SQL.                                                      |

## Wiring

```ts
import { buildEvaluationModule } from '@/modules/evaluation';

const evaluation = buildEvaluationModule(deps.pool, deps.logger, {
  predictor: prediction.adapter, // any PredictorAdapter
  pipeline: recommendation.pipeline, // full RecommendationPipeline OR a LimitedRecommendationPipeline
});
v1.use('/evaluation', evaluation.router);
```

`buildEvaluationModule` accepts both the production `RecommendationPipeline`
(via an internal adapter) and the narrower `LimitedRecommendationPipeline`
shape — handy for tests and isolated rollouts.

## UAT / acceptance script entry points

This module is the substrate for both **automated CI gates** and
**human-driven UAT**. Three pre-baked entry points:

### 1. Programmatic seed (recommended for fresh deploys + CI)

```ts
import { buildEvaluationModule, BASELINE_TEST_SETS } from '@/modules/evaluation';

const evaluation = buildEvaluationModule(pool, logger, { predictor, pipeline });
for (const set of BASELINE_TEST_SETS) {
  await evaluation.service.createTestSet(set, { trace_id: 'seed', user_id: null });
}
```

`BASELINE_TEST_SETS` ships three curated sets — one forward (4 PCMO / HDEO /
gear-oil cases), one inverse (2 PCMO target cases), one stability
(predict + recommend). Use them as the smoke-test floor before promoting a
model release.

### 2. HTTP UAT trigger

```bash
# 1. Persist baseline sets
curl -X POST /v1/evaluation/test-sets -d @forward-baseline.json

# 2. Trigger a run (synchronous)
curl -X POST /v1/evaluation/runs \
  -d '{ "test_set_id": "<uuid>", "trigger_type": "uat" }'

# 3. Download Markdown for sign-off
curl /v1/evaluation/runs/<run_id>/export?format=markdown -o report.md
```

`trigger_type: 'uat'` is recognised throughout the audit log and is the
expected value when a human launches the run from the workbench.

### 3. Direct runner invocation (CLI / background jobs)

When you don't need persistence — e.g. an ad-hoc CI gate — call the runners
directly:

```ts
import { runForward, BASELINE_TEST_SETS } from '@/modules/evaluation';

const set = BASELINE_TEST_SETS.find((s) => s.test_type === 'forward')!;
const { report } = await runForward({
  cases: set.cases,
  tolerance: set.default_tolerance,
  envelope: {
    run_id: 'ci',
    code: 'ci',
    test_set_id: 'ci',
    test_type: 'forward',
    model: predictor.info(),
    started_at: new Date().toISOString(),
    trace_id: 'ci',
  },
  predictor,
  trace_id: 'ci',
});
process.exit(report.status === 'succeeded' ? 0 : 1);
```

This is also the path taken by the in-process `EvaluationService` —
exposing it as a public export keeps formal acceptance scripts independent
of the HTTP layer.

## Tests

```
tests/unit/evaluation/
  metrics.test.ts    pure helpers (MAPE / MAE / RMSE / cosine / Jaccard / CV)
  runners.test.ts    forward / inverse / stability happy + failure paths
  service.test.ts    create → run → export lifecycle, case_ids filtering, NotFound paths
  schemas.test.ts    Zod parsing for every endpoint body / query / params
  _fakes.ts          FakeEvaluationRepository + staticPredictor + staticPipeline
```

```bash
pnpm --filter @fluidmind/backend test -- tests/unit/evaluation
```

59 / 59 pass.

## Extension cookbook

| Need                                         | Where to plug                                                                                                                                                                                                     |
| -------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| New aggregate (e.g. R²)                      | add to `metrics.ts` + extend `ForwardAggregate` + emit from `forward-runner.ts`.                                                                                                                                  |
| New tolerance dimension                      | extend `Tolerance` / `StabilityTolerance` + Zod `RunRequestSchema`; runners read from the merged config.                                                                                                          |
| Async / queued runs                          | replace the synchronous `runAcceptance` body with an enqueue + worker; the existing `RunStatus = 'queued' \| 'running' \| 'succeeded' \| 'partial' \| 'failed' \| 'cancelled'` enum already covers the lifecycle. |
| New report format (HTML / PDF)               | add a reporter in `reporters/` + extend `exportRun(format)` and `ExportFormatQuerySchema`.                                                                                                                        |
| Custom predictor / pipeline for a deployment | inject via `buildEvaluationModule({ predictor, pipeline })`. The narrow `LimitedRecommendationPipeline` shape decouples the runner from recommendation refactors.                                                 |
| Tighter retention                            | drop old `acceptance_runs` rows by month; `summary` JSONB is self-contained so individual rows are safely deletable.                                                                                              |
