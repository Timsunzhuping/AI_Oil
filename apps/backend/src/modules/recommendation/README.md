# Reverse Recommendation Service

`apps/backend/src/modules/recommendation` — REST endpoints that turn target
performance + cost / inventory / regulatory constraints into a ranked list
of candidate formulas.

```
HTTP                                   Pipeline                     Underlying
─────                                  ────────                      ──────────
POST /recommend/generate         ─┐                                  ┌─ DefaultCandidateGenerator
POST /recommend/recalculate      ─┼─▶ RecommendationService ─▶ Pipeline ─┤── DefaultConstraintFilter
POST /recommend/replace-material ─┘                              │   ├─ PredictorBackedEvaluator
                                                                 │   │      └─ PredictorAdapter (mock|real)
GET  /recommend/history/:taskId  ─────▶ RecommendationRepository └──▶ WeightedSumRanker
                                                ↓
                                  recommendation_tasks (one row per /generate call)
                                  candidate_results    (one row per produced or edited candidate)
```

## Endpoints

| Method | Path                                 | Purpose                                                                    |
| ------ | ------------------------------------ | -------------------------------------------------------------------------- |
| `POST` | `/api/v1/recommend/generate`         | Run the pipeline and produce 3-5 ranked candidates.                        |
| `POST` | `/api/v1/recommend/recalculate`      | Re-evaluate a user-edited BOM and (optionally) persist as a new candidate. |
| `POST` | `/api/v1/recommend/replace-material` | Swap one material in a candidate, then recalculate.                        |
| `GET`  | `/api/v1/recommend/history/:taskId`  | List the task and all its candidates ordered by rank.                      |

All responses use the unified envelope
`{ code, message, data, traceId, timestamp }` from `src/lib/response.ts`.

## Strategies

```
strategy = 'cost_priority'        → vary base oils + VII, weight cheap pool entries
strategy = 'material_replacement' → take base BOM, swap targeted materials
strategy = 'new_product'          → sample balanced BOMs from scratch
```

If `strategy` is omitted in the request, the service auto-detects:

- `base_bom` + `replacement_pool` present → `material_replacement`
- `cost_limit` present → `cost_priority`
- otherwise → `new_product`

## Reproducibility

Every task persists a `random_seed`. Re-issuing the same request with the
same seed yields:

1. The same generator output (BOMs and order).
2. The same evaluator output (the `MockPredictor` is deterministic in BOM hash).
3. The same ranker scores → the same top-K candidates.

Deterministic RNG: `mulberry32` in `random.ts`. `fallbackSeed()` is used when
the request omits `random_seed`.

## Pipeline pluggability

Each stage is its own class with a stable interface so a future stronger
optimizer can plug in without touching the rest:

```ts
new RecommendationPipeline({
  generator: new MyBayesianOptimizer(), // CandidateGenerator
  filter: new MyDomainSpecificFilter(), // ConstraintFilter
  evaluator: new MyRealModelEvaluator(), // SurrogateEvaluator
  ranker: new ParetoRanker(), // RankingEngine
});
```

## Request examples

### Generate (cost-priority)

```jsonc
POST /api/v1/recommend/generate
{
  "product_category": "engine_oil_pcmo",
  "application_scene": "高速涡轮增压乘用车，长寿命换油周期",
  "strategy": "cost_priority",
  "target_metrics": [
    { "name": "KV_100C", "target": 11, "lower_bound": 9.3, "upper_bound": 12.5, "weight": 2 },
    { "name": "VI",      "lower_bound": 160, "weight": 1 },
    { "name": "P_PCT",   "upper_bound": 0.08, "weight": 1.5 }
  ],
  "cost_limit": 22,
  "carbon_limit": null,
  "inventory_constraints": [
    { "material_code": "PAO-6", "available_kg": 2000, "batch_size_kg": 1000 }
  ],
  "material_pool": [
    { "material_code": "PAO-6",     "material_name": "PAO-6",            "role": "base_oil", "unit_cost": 22, "min_ratio": 0.30, "max_ratio": 0.55 },
    { "material_code": "GIII-4cSt", "material_name": "Group III 4 cSt",  "role": "base_oil", "unit_cost": 14, "min_ratio": 0.30, "max_ratio": 0.55 },
    { "material_code": "OCP",       "material_name": "OCP VII",          "role": "vii",      "unit_cost":  9, "min_ratio": 0.05, "max_ratio": 0.10 },
    { "material_code": "PKG-A",     "material_name": "Detergent pkg",    "role": "detergent","unit_cost": 30, "min_ratio": 0.08, "max_ratio": 0.15 }
  ],
  "locked_materials": [{ "material_code": "PKG-A", "ratio": 0.10 }],
  "n_candidates": 5,
  "random_seed": 42
}
```

### Generate (material replacement)

Same as cost-priority, plus:

```jsonc
{
  "strategy": "material_replacement",
  "base_bom": [
    { "material_code": "PAO-6", "material_name": "PAO-6", "role": "base_oil", "ratio": 0.5 },
    { "material_code": "OCP", "material_name": "OCP VII", "role": "vii", "ratio": 0.1 },
    {
      "material_code": "PKG-A",
      "material_name": "Detergent pkg",
      "role": "detergent",
      "ratio": 0.4,
    },
  ],
  "replacement_pool": [{ "replace_material_code": "PAO-6", "with_material_code": "GIII-4cSt" }],
}
```

### Recalculate

```jsonc
POST /api/v1/recommend/recalculate
{
  "task_id": "…",
  "candidate_id": "…",
  "modifications": [
    { "material_code": "PAO-6", "new_ratio": 0.45 },
    { "material_code": "OCP",   "new_ratio": 0.08 }
  ],
  "persist": true
}
```

Or pass `full_bom` to replace the entire composition.

### Replace material

```jsonc
POST /api/v1/recommend/replace-material
{
  "task_id": "…",
  "candidate_id": "…",
  "swap": { "from_material_code": "PAO-6", "to_material_code": "GIII-4cSt", "new_ratio": 0.45 },
  "persist": true
}
```

### History

```jsonc
GET /api/v1/recommend/history/<taskId>
```

## Response shape

```jsonc
{
  "code": 0,
  "message": "Recommendation generated",
  "data": {
    "task": {
      "id": "…", "code": "REC-2026-0001",
      "product_category": "engine_oil_pcmo", "strategy": "cost_priority",
      "random_seed": 42, "model_version": "mock-v1", "predictor_mode": "mock",
      "status": "succeeded", "duration_ms": 18,
      "summary": { "generated": 30, "passed_filters": 18, "evaluated": 18, "ranked": 5 }
      // …all input fields echoed back for replay
    },
    "candidates": [
      {
        "id": "…", "task_id": "…", "rank": 1,
        "name": "候选 #1 · 成本优先",
        "headline": "成本 18.42 · 综合分 86",
        "origin": "generated",
        "bom": [ { "material_code": "PAO-6", "ratio": 0.42, "role": "base_oil", … } ],
        "predicted_metrics": [ … ],
        "estimated_cost": 18.42,
        "cost_unit": "CNY/kg",
        "carbon_estimate": 1.65,
        "risk_warnings": [ … ],
        "constraint_match": { "passed": [ … ], "failed": [], "score": 1.0 },
        "composite_score": 0.86,
        "score_breakdown": {
          "target_score": 0.91, "cost_score": 0.83,
          "confidence_score": 0.86, "constraint_score": 1.0, "risk_penalty": 0.05
        },
        "confidence": 0.86
      }
    ],
    "random_seed": 42,
    "model_version": "mock-v1", "model_code": "forward-predictor",
    "predictor_mode": "mock",
    "trace_id": "…",
    "duration_ms": 18
  },
  "traceId": "…",
  "timestamp": "…"
}
```

`/recalculate` and `/replace-material` return the same `candidate` shape
plus a `base_candidate_id` so the UI can render lineage.

## Database design

### `recommendation_tasks`

| Column                                            | Type         | Notes                                                        |
| ------------------------------------------------- | ------------ | ------------------------------------------------------------ |
| `id`                                              | UUID PK      |                                                              |
| `code`                                            | TEXT UNIQUE  | `REC-YYYY-NNNN`                                              |
| `product_category`                                | TEXT         |                                                              |
| `application_scene`                               | TEXT NULL    |                                                              |
| `strategy`                                        | TEXT         | `'cost_priority' \| 'material_replacement' \| 'new_product'` |
| `target_metrics`                                  | JSONB        | TargetMetric[]                                               |
| `cost_limit`                                      | NUMERIC NULL |                                                              |
| `carbon_limit`                                    | NUMERIC NULL | reserved                                                     |
| `inventory_constraints`                           | JSONB        |                                                              |
| `material_pool`                                   | JSONB        |                                                              |
| `replacement_pool`                                | JSONB        |                                                              |
| `locked_materials`                                | JSONB        |                                                              |
| `process_constraints`                             | JSONB        |                                                              |
| `n_candidates`                                    | INT          | 1..10                                                        |
| `random_seed`                                     | BIGINT       |                                                              |
| `model_code` / `model_version` / `predictor_mode` | TEXT         |                                                              |
| `status` / `error_class` / `error_message`        | TEXT         |                                                              |
| `duration_ms`                                     | INT          |                                                              |
| `summary`                                         | JSONB        | `{ generated, passed_filters, evaluated, ranked }`           |
| `trace_id`                                        | TEXT         |                                                              |
| `created_*` / `updated_at` / `version`            | …            | standard auditing fields                                     |

### `candidate_results`

| Column                                             | Type                                                   | Notes                                         |
| -------------------------------------------------- | ------------------------------------------------------ | --------------------------------------------- |
| `id`                                               | UUID PK                                                |                                               |
| `task_id`                                          | UUID FK → `recommendation_tasks(id) ON DELETE CASCADE` |                                               |
| `rank`                                             | INT                                                    | 1-based, ascending = best                     |
| `name` / `headline`                                | TEXT                                                   | UI-friendly labels                            |
| `origin`                                           | TEXT                                                   | `'generated' \| 'recalculated' \| 'replaced'` |
| `parent_candidate_id`                              | UUID NULL                                              | lineage from recalc / replace                 |
| `bom`                                              | JSONB                                                  | BomItem[]                                     |
| `predicted_metrics`                                | JSONB                                                  | PredictedMetric[]                             |
| `estimated_cost` / `cost_unit` / `carbon_estimate` | numeric/text                                           |                                               |
| `risk_warnings`                                    | JSONB                                                  | RiskWarning[]                                 |
| `constraint_match`                                 | JSONB                                                  | `{ passed[], failed[], score }`               |
| `composite_score` / `score_breakdown`              | numeric / JSONB                                        |                                               |
| `confidence`                                       | NUMERIC                                                | average over predicted metrics                |
| `metadata`                                         | JSONB                                                  | source, label, swap descriptor, …             |

See migration
[`infra/db/migrations/0017_recommendation_engine.sql`](../../../../infra/db/migrations/0017_recommendation_engine.sql).

## Tests

```
tests/unit/recommendation/
  random.test.ts     mulberry32 determinism + bounds
  schemas.test.ts    Zod parsing of generate / recalc / replace requests
  pipeline.test.ts   generator + filter + ranker + end-to-end pipeline
  service.test.ts    generate / recalculate / replace-material / history
                     against an in-memory repository fake
```

Run only the recommendation tests:

```bash
pnpm --filter @fluidmind/backend test -- tests/unit/recommendation
```

## Wiring

Mounted at `/api/v1/recommend` from `src/routes/v1/index.ts`. The
recommendation module **shares the predictor adapter** with the prediction
module so the surrogate evaluator hits the SAME model the `/api/v1/predict`
endpoints serve.

## Environment variables

| Var              | Default | Purpose                                                      |
| ---------------- | ------- | ------------------------------------------------------------ |
| `PREDICTOR_MODE` | `mock`  | `real` to switch to a real adapter (shared with prediction). |
