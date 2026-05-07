# Model Factory / MLOps Platform

`apps/backend/src/modules/ml` — the canonical control-plane for all ML
artifacts at FluidMind: datasets, feature templates, training jobs, model
registry, version lifecycle, release / rollback, compare reports, and
auto-fine-tune triggers.

```
HTTP                                Service                    Adapters
─────                               ───────                    ────────
POST /ml/datasets               ─┐                              ┌─ TrainerAdapter
GET  /ml/datasets               ─┤                              │   ├─ MockTrainer (deterministic)
POST /ml/feature-templates      ─┤                              │   ├─ LocalTrainer (least-squares)
POST /ml/models                 ─┼─▶ MlService ───▶ Trainer    │   └─ (real: SageMaker / Vertex / k8s)
POST /ml/models/:id/release     ─┤      │                       │
POST /ml/models/:id/rollback    ─┤      │
GET  /ml/models/compare         ─┤      ▼
POST /ml/jobs                   ─┤   MlRepository ──────────▶  ml_datasets
GET  /ml/jobs/:id               ─┘  + state machine guards     ml_feature_templates
                                                                ml_model_registry
POST /ml/auto-finetune-triggers ─┐                              ml_model_versions
POST /ml/manual-retrain         ─┘                              ml_training_jobs
                                                                ml_model_releases
                                                                ml_auto_finetune_triggers
```

## Endpoints

### Datasets

| Method | Path                      | Purpose                                   |
| ------ | ------------------------- | ----------------------------------------- |
| `POST` | `/api/v1/ml/datasets`     | Register a dataset (URL, schema, splits). |
| `GET`  | `/api/v1/ml/datasets`     | Paginated list.                           |
| `GET`  | `/api/v1/ml/datasets/:id` | Detail.                                   |

### Feature templates

| Method | Path                               | Purpose                                 |
| ------ | ---------------------------------- | --------------------------------------- |
| `POST` | `/api/v1/ml/feature-templates`     | Create a reusable feature spec.         |
| `GET`  | `/api/v1/ml/feature-templates`     | List, filter by `task_type` / `status`. |
| `GET`  | `/api/v1/ml/feature-templates/:id` | Detail.                                 |

### Models

| Method | Path                                       | Purpose                           |
| ------ | ------------------------------------------ | --------------------------------- |
| `POST` | `/api/v1/ml/models`                        | Register a model identity.        |
| `GET`  | `/api/v1/ml/models`                        | List, filter by `task_type`.      |
| `GET`  | `/api/v1/ml/models/:id`                    | Detail (includes versions).       |
| `POST` | `/api/v1/ml/models/:id/release`            | Promote a version to active.      |
| `POST` | `/api/v1/ml/models/:id/rollback`           | Restore the previous active.      |
| `GET`  | `/api/v1/ml/models/:id/releases`           | Release / rollback audit history. |
| `GET`  | `/api/v1/ml/models/compare?versions=A,B,C` | Compare report.                   |

### Training jobs

| Method | Path                         | Purpose                                                             |
| ------ | ---------------------------- | ------------------------------------------------------------------- |
| `POST` | `/api/v1/ml/jobs`            | Create + run a training job (sync; trainer returns terminal state). |
| `GET`  | `/api/v1/ml/jobs`            | List, filter by `model_id` / `status`.                              |
| `GET`  | `/api/v1/ml/jobs/:id`        | Detail.                                                             |
| `POST` | `/api/v1/ml/jobs/:id/cancel` | Cancel a queued / running job.                                      |

### Auto-finetune + manual retrain

| Method | Path                                         | Purpose                                  |
| ------ | -------------------------------------------- | ---------------------------------------- |
| `POST` | `/api/v1/ml/auto-finetune-triggers`          | Define a drift / metric / schedule rule. |
| `GET`  | `/api/v1/ml/auto-finetune-triggers`          | List rules (filter by `model_id`).       |
| `POST` | `/api/v1/ml/auto-finetune-triggers/:id/fire` | Manually fire a rule.                    |
| `POST` | `/api/v1/ml/manual-retrain`                  | One-click retrain entry.                 |

All responses use the unified envelope `{ code, message, data, traceId, timestamp }`.

## State machines

### Training job

```
queued ─▶ provisioning ─▶ running ─▶ succeeded
   │           │            │
   │           ├─▶ failed   ├─▶ failed
   │           └─▶ timeout  ├─▶ timeout
   │                        └─▶ cancelled
   └─▶ cancelled
```

### Model version deployment

```
staged ─▶ active ─▶ retired
   │       │       └─▶ rolled_back
   │       └─▶ shadow ─▶ retired
   └─▶ retired
```

`rolled_back` can be re-activated for emergencies. Illegal transitions
throw via `assertVersionTransition` / `assertTrainingJobTransition`.

## Compare report

`GET /api/v1/ml/models/compare?versions=v1,v2,v3` returns a structured
comparison ready to drop into a Recharts radar / bar / table:

```jsonc
{
  "baseline_version_id": "v1",
  "versions": [
    { "version_id": "v1", "version_number": 7, "metrics": { "rmse": 0.12, "r2": 0.91 }, "is_baseline": true,  ... },
    { "version_id": "v2", "version_number": 8, "metrics": { "rmse": 0.11, "r2": 0.93 }, "is_baseline": false, ... }
  ],
  "metric_rows": [
    {
      "name": "rmse",
      "values":     { "v1": 0.12,  "v2": 0.11 },
      "deltas":     { "v1": 0,     "v2": -0.01 },
      "delta_pct":  { "v1": 0,     "v2": -0.0833 },
      "better": "lower"
    }
  ],
  "hyperparameter_diffs": [
    { "key": "lr", "values": { "v1": 0.01, "v2": 0.05 }, "is_uniform": false }
  ],
  "summary": {
    "winners":     [{ "metric": "rmse", "version_id": "v2", "value": 0.11 }],
    "regressions": [{ "metric": "rmse", "version_id": "v1", "value": 0.12 }]
  },
  "generated_at": "..."
}
```

`better` is derived from the metric name (higher / lower / unknown).
Frontend can use `delta_pct` for "Δ %" badges and `winners` to highlight
top performers in a leaderboard.

## Trainer adapter contract

```ts
interface TrainerAdapter {
  identity(): { name: string; version: string; mode: 'mock' | 'local' | 'remote' };
  train(input: TrainInput): Promise<TrainOutput>;
  cancel?(jobId: string): Promise<void>;
}
```

Bundled implementations:

| Adapter               | When                   | What it does                                                                                                  |
| --------------------- | ---------------------- | ------------------------------------------------------------------------------------------------------------- |
| `MockTrainerAdapter`  | tests, demos           | Deterministic metrics from SHA-256 of `(dataset, hp, seed)`. Optional progress callbacks + failure injection. |
| `LocalTrainerAdapter` | small, in-process work | Real least-squares regressor on synthetic data; falls back to seeded metrics for non-regression tasks.        |
| `Real…` (your code)   | production             | Implement the interface and inject via `buildMlModule({ trainer: { adapter } })`.                             |

Env hook:

| Var               | Default | Purpose                                                                 |
| ----------------- | ------- | ----------------------------------------------------------------------- |
| `ML_TRAINER_MODE` | `mock`  | `local` to use LocalTrainerAdapter; `remote` reserved for cloud client. |

## Database

| Table                       | Purpose                                                     | Migration |
| --------------------------- | ----------------------------------------------------------- | --------- |
| `ml_datasets`               | Dataset registry (storage_url, schema, splits).             | 0010      |
| `ml_model_registry`         | Logical model identity.                                     | 0010      |
| `ml_model_versions`         | Immutable version artifacts + metrics + deployment_status.  | 0010      |
| `ml_training_jobs`          | Every training run; status / progress / metrics / artifact. | 0010      |
| `ml_inference_endpoints`    | Reserved (already created in 0010).                         | 0010      |
| `ml_feature_templates`      | Reusable feature configurations.                            | **0021**  |
| `ml_model_releases`         | Release / rollback audit log.                               | **0021**  |
| `ml_auto_finetune_triggers` | Drift / schedule / threshold rules.                         | **0021**  |

See migrations
[`0010_ml_registry.sql`](../../../../infra/db/migrations/0010_ml_registry.sql)
and
[`0021_ml_platform.sql`](../../../../infra/db/migrations/0021_ml_platform.sql).

## Tests

```
tests/unit/ml/
  state-machine.test.ts   training-job + version transition guards
  trainer.test.ts         MockTrainer / LocalTrainer / buildTrainer factory
  schemas.test.ts         Zod parsing of all request schemas
  service.test.ts         service over a fake repository — covers dataset CRUD,
                          training-job success/failure, release + rollback +
                          guardrails, compare report, auto-finetune triggers,
                          manual retrain
  _fakes.ts               FakeMlRepository
```

Run only the ML tests:

```bash
pnpm --filter @fluidmind/backend test -- tests/unit/ml
```

## Wiring

Mounted at `/api/v1/ml` from `src/routes/v1/index.ts` whenever pool +
logger are both available. Coexists with prediction / recommendation /
knowledge / qa / erp.

## Extension cookbook

| Need                                        | Where to plug                                                                                                                                      |
| ------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------- |
| Add a real Sagemaker / Vertex / k8s trainer | implement `TrainerAdapter`, pass via `buildMlModule({ trainer: { adapter } })`                                                                     |
| Persist a model card alongside the artifact | use `ml_model_versions.model_card_url` (already present)                                                                                           |
| Wire shadow deployments                     | the `shadow` deployment_status + `shadow_promote` / `shadow_demote` release actions are already in the schema; add a service method that uses them |
| Run scheduled retrains automatically        | wire your scheduler (k8s CronJob, Temporal, …) to call `service.fireAutoFinetuneTrigger(triggerId)` on the configured cadence                      |
| Add per-metric guardrails on release        | already implemented — pass `guardrails: [{ metric, comparator, threshold }]` in the release body                                                   |

## Reproducibility notes

- Training jobs persist `config.random_seed`, the trainer adapter's
  identity (`name`, `version`), the dataset id, and the feature template
  id. Re-issuing the same job on the same trainer + dataset yields the
  same metrics for the bundled mock + local trainers.
- `ml_model_versions` snapshots `hyperparameters`, `metrics`, and
  `artifact_hash` so a successful release can be replayed even if the
  underlying training-job row is purged.
- The compare report is derived from the live version rows — no caching
  layer; the response is consistent with whatever the registry returns at
  query time.
