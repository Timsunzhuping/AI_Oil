# Forward Prediction Service

`apps/backend/src/modules/prediction` — REST endpoints that turn a formula's
**Bill of Materials (BOM)** into predicted physico-chemical performance
metrics, with spec-window checks, risk warnings, and source traceability.

```
HTTP                                Service                           Adapter
─────                               ───────                           ───────
POST /predict/single   ─┐
POST /predict/batch    ─┼─▶ PredictionService ──┬──▶ PredictorAdapter (mock | real)
POST /predict/explain  ─┘                       │       ├─ MockPredictor (deterministic)
GET  /predict/model-version ──▶ adapter.info()  │       └─ RealPredictorScaffold (placeholder)
                                                ▼
                                      PredictionLogsRepository
                                      (prediction_logs table)
```

## Endpoints

| Method | Path                            | Purpose                                                   |
| ------ | ------------------------------- | --------------------------------------------------------- |
| `POST` | `/api/v1/predict/single`        | Predict performance metrics for ONE formula BOM.          |
| `POST` | `/api/v1/predict/batch`         | Predict for N formulas in parallel (bounded concurrency). |
| `GET`  | `/api/v1/predict/model-version` | Current model identity + supported metrics.               |
| `POST` | `/api/v1/predict/explain`       | Per-feature attribution for one metric on one BOM.        |

All responses use the unified envelope `{ code, message, data, traceId, timestamp }`
defined in `src/lib/response.ts`.

## Request shape

```jsonc
{
  "product_category": "engine_oil_pcmo",
  "formula_version_id": "00000000-0000-0000-0000-000000000abc", // optional
  "bom_items": [
    { "material_code": "PAO-6", "material_name": "PAO-6", "ratio": 0.42, "role": "base_oil" },
    {
      "material_code": "GIII",
      "material_name": "Group III 4 cSt",
      "ratio": 0.58,
      "role": "base_oil",
    },
  ],
  "target_metrics": ["KV_100C", "VI"], // optional, defaults to all
}
```

The `bom_items[].ratio` field is a mass fraction in `(0, 1]` — totals must be
`> 0` and `≤ 1.001` (to allow for rounding).

### Batch request

```jsonc
{
  "product_category": "engine_oil_pcmo",
  "formulas": [
    { "label": "A", "bom_items": [...] },
    { "label": "B", "bom_items": [...] }
  ],
  "target_metrics": ["KV_100C"],
  "concurrency": 4   // optional, 1..16, default 4
}
```

### Explain request

Same as `/predict/single` plus `metric` and an optional `top_k` (1..50):

```jsonc
{
  "product_category": "engine_oil_pcmo",
  "bom_items": [...],
  "metric": "KV_100C",
  "top_k": 5
}
```

## Response shape

```jsonc
{
  "code": 0,
  "message": "Prediction completed",
  "data": {
    "metrics": [
      {
        "name": "KV_100C",
        "display_name": "100℃ 运动黏度",
        "unit": "mm²/s",
        "predicted_value": 11.42,
        "spec_low": 9.3,
        "spec_high": 12.5,
        "in_spec": true,
        "confidence": 0.86,
      },
    ],
    "risk_warnings": [
      {
        "level": "warning",
        "code": "CLOSE_TO_SPEC",
        "metric": "KV_100C",
        "message": "Predicted 100℃ 运动黏度 is within 5 % of the high spec bound.",
      },
    ],
    "model_version": "mock-v1",
    "model_code": "forward-predictor",
    "predictor_mode": "mock",
    "trace_id": "…",
    "duration_ms": 14,
  },
  "traceId": "…",
  "timestamp": "…",
}
```

Batch responses additionally carry `batch_id`, per-formula `error` for failed
slots, and aggregate `counts: { total, success, failed }`. HTTP status:

- `200` — all succeeded
- `207 Multi-Status` — at least one succeeded and one failed
- `500` — every entry failed

`/predict/explain` includes an `explanations: FeatureContribution[]` field.

## Risk derivation rules

| Code             | Level    | Trigger                            |
| ---------------- | -------- | ---------------------------------- |
| `SPEC_FAIL`      | critical | `in_spec === false`                |
| `CLOSE_TO_SPEC`  | warning  | within 5 % of the closer spec edge |
| `LOW_CONFIDENCE` | warning  | `confidence < 0.6`                 |
| `NO_METRICS`     | info     | empty metrics list                 |

## Adapter layer

```
adapters/
  types.ts       PredictorAdapter interface (info / predict / explain)
  mock.ts        MockPredictor — deterministic, FNV-hash-based
  real.ts        RealPredictorScaffold — throws UpstreamError until wired
  index.ts       buildPredictor() factory
```

Switching mode:

| What you set                                     | Result                    |
| ------------------------------------------------ | ------------------------- |
| nothing                                          | mock predictor            |
| `PREDICTOR_MODE=real` and a `real:` config block | RealPredictorScaffold     |
| `opts.adapter` injected                          | uses your adapter exactly |

The mock predictor catalogues 8 supported metrics (KV100, KV40, VI, POUR,
FLASH, NOACK, CCS@-30, P_PCT). Adding a new metric is a 1-line edit.

To swap in a real model:

1. Implement `PredictorAdapter` (e.g. wrap onnxruntime / sklearn / a remote RPC).
2. Pass it to `buildPredictionModule(pool, logger, { adapter: yourAdapter })`.

## Persistence — `prediction_logs`

Every API call writes an audit row. Batch calls write `N` rows sharing a
`batch_id` and ordered by `batch_index`. See migration
[`infra/db/migrations/0016_prediction_logs.sql`](../../../../infra/db/migrations/0016_prediction_logs.sql).

Audit-log failures NEVER break business endpoints — the service catches the
DB error, emits a warning log, and returns the prediction normally. This is
intentional: prediction is a synchronous business call; logging is best-effort.

## Wiring

Mounted under `/api/v1/predict` from `src/routes/v1/index.ts` whenever
`pool` and `logger` are both provided (same convention as `cleaning`,
`features`, `tasks` modules).

## Tests

```
tests/unit/prediction/
  adapter.test.ts    MockPredictor + buildPredictor selection
  schemas.test.ts    Zod parsing & ratio refinements
  service.test.ts    single / batch / explain happy + failure paths
                     + deriveRiskWarnings rules
```

Run only the prediction tests:

```bash
pnpm --filter @fluidmind/backend test -- tests/unit/prediction
```

## Environment variables

| Var              | Default | Purpose                                                                                                 |
| ---------------- | ------- | ------------------------------------------------------------------------------------------------------- |
| `PREDICTOR_MODE` | `mock`  | Set to `real` to attempt the RealPredictorScaffold. Falls back to mock when no real config is provided. |
