# Sample Base Tables & Feature Foundation

The single source of (X, y) for FluidMind's forward and inverse models.

```
/api/v1/features
├── /runs                       trigger + browse generation runs
├── /dictionary                 the feature catalog (per version)
├── /forward-samples            wide (X, y) rows for forward training
├── /forward-matrix             ready-to-fit numeric matrices
├── /inverse-base               anchor catalog for the inverse recommender
└── /formula-version/:id        cached features for one version
```

## Why this layer

The cleaning layer produces clean per-measurement rows in `normalized_test_results`. The features layer turns that — plus master-data + formula composition — into:

- **`mart_forward_training_sample`** — one row per `(formula_version × batch × feature_set_version)`. Carries the wide feature vector AND the achieved target metrics for that specific batch. **This is the X, y for the forward model.**
- **`mart_inverse_generation_base`** — one row per `(formula_version × feature_set_version)`. Carries the composition vector, achieved-metric averages over batches, and constraint hints. **This is the anchor catalog for the inverse recommender.**
- **`formula_version_features`** — per-version cache so feature lookups are a single PK hit, not a 6-stage recomputation.
- **`material_batch_features`** — per-(material, batch) snapshots for lot-aware modeling.

Every model trainer in the platform should ONLY read from this module — never from `formula_items` directly. That keeps the extractor logic in one place and makes `feature_set_version` upgrades atomic.

## Feature catalog (v1.0)

Six groups, ~30 features. The full dictionary lives in `feature_definitions` and is queryable at `GET /features/dictionary`.

### structure
Structural shape of the formula — counts of items, phases, steps, roles, and percentage sums by role.
- `num_items`, `num_phases`, `num_steps`
- `num_active`, `num_base`, `num_additive`
- `pct_active`, `pct_base`, `pct_additive`
- `critical_count`, `optional_count`

### weighted_property
Mass-weighted averages of material physical/chemical properties:
```
weighted_p = Σ (pct_i × p_i) / Σ pct_i        over items where p_i is defined
```
- `weighted_density`, `weighted_molecular_weight`, `weighted_flash_point`, `weighted_ph`

Items missing the property are excluded from BOTH numerator and denominator, so partial inputs still yield a meaningful (if noisier) average. Skipped counts surface in `missing_inputs`.

### log_mix
Two viscosity-blending features:

- `weighted_viscosity_log` — naive log-weighted: `Σ (pct_i × ln(ν_i)) / Σ pct_i`. Degrades gracefully with missing items.
- `blended_viscosity_cst` — **Refutas equation** (industry standard for mineral-oil blends):
  ```
  VBN_i      = 14.534 × ln(ln(ν_i + 0.8)) + 10.975
  VBN_blend  = Σ (x_i × VBN_i)         where x_i = pct_i / Σ pct_i
  ν_blend    = exp(exp((VBN_blend − 10.975) / 14.534)) − 0.8
  ```
  Strict on completeness — only emits a value when ≥ 2 items have viscosity. Returns null + `missing_count` otherwise.

### complexity
Distribution-shape features over the percentage vector:
- `complexity_entropy`     `−Σ p_i × ln(p_i)`  (Shannon entropy in nats)
- `simpson_diversity`      `1 − Σ p_i²`
- `concentration_top3`     sum of three largest pcts
- `effective_n_ingredients` `exp(entropy)` (Hill number of order 1)

### cost
- `total_cost`        `Σ (amount_i × unit_cost_i)`     (item.unit_cost wins; falls back to material.default_unit_cost)
- `cost_per_kg`       `total_cost / batch_size`
- `top_cost_share`    `max(item_cost) / total_cost`

### functional
Tag-driven detection over `raw_materials.tags`:
- `has_zddp`, `has_pao`, `has_vi_improver`, `has_antioxidant`, `has_detergent`
- `additive_to_base_ratio`        `pct_additive / pct_base`
- `phosphorus_ppm_estimate`        `Σ pct_i × P_pct_i × 100` (only across ZDDP-tagged items)

## Architecture

```
                  formula_version + items + materials
                                 │
                                 ▼
               ┌──────────────────────────────────────┐
               │ Repository.listFormulaVersionInputs  │
               │ — single round-trip, joined view     │
               └─────────────────────┬────────────────┘
                                     ▼
               ┌─────────────────────────────────────┐
               │ buildFeatureSet (pure)              │
               │   1. StructureExtractor             │
               │   2. WeightedPropertyExtractor      │
               │   3. LogMixViscosityExtractor       │
               │   4. ComplexityExtractor            │
               │   5. CostExtractor                  │
               │   6. FunctionalExtractor            │
               │   → wide FeatureMap                 │
               └─────────┬───────────────────────────┘
                         │
       ┌─────────────────┼─────────────────┐
       ▼                 ▼                 ▼
  formula_version_  mart_forward_       mart_inverse_
  features          training_sample     generation_base
  (X cache)         (X + y, per batch)  (X + composition + achieved)
```

The orchestrator (`FeatureGenerator.run()`) does this for every formula version in scope, in one feature_set_version, in one transaction.

## Versioning

`feature_set_version` is a free-form text label (`v1.0`, `v2.0`, `2026-q3-physics`). To roll out a new feature set:

1. Add new rows to `feature_definitions` under the new version label.
2. Update `defaultExtractors()` to add/remove extractors as needed.
3. Trigger generation: `POST /features/runs { "feature_set_version": "v2.0", ... }`.
4. The new mart rows live alongside the old ones (UNIQUE on `(formula_version_id, feature_set_version)`).
5. Trainers explicitly request a version via `?feature_set_version=v2.0`.

Old rows can stay as-is (immutable) — no migration is required to bump versions.

## Per-product-category sample sets

The `product_category_code` column is denormalized onto `mart_forward_training_sample` and `mart_inverse_generation_base`. Get a category-specific training set with:

```bash
curl '/api/v1/features/forward-samples?product_category_code=ENGINE_OILS&target_metric=KV_100C'
```

Or scope the generator itself:

```bash
curl -X POST '/api/v1/features/runs' \
  -H 'Content-Type: application/json' \
  -d '{ "feature_set_version": "v1.0", "scope": { "product_category_code": "ENGINE_OILS", "only_approved": true } }'
```

## Unified Feature API

The `FeatureApi` class is the single entry point for downstream model code:

```ts
import { FeatureApi } from '@fluidmind/backend/modules/features';

const api = new FeatureApi(pool, logger);

// Forward trainer
const samples = await api.getForwardSamples({
  product_category_code: 'ENGINE_OILS',
  target_metric: 'KV_100C',
  is_complete: true,
});

// Or directly into a numeric matrix
const matrix = await api.getForwardMatrix({
  feature_set_version: 'v1.0',
  product_category_code: 'ENGINE_OILS',
  target_metric: 'KV_100C',
  feature_names: [
    'pct_base', 'pct_additive', 'weighted_density', 'blended_viscosity_cst',
    'complexity_entropy', 'has_zddp', 'has_pao',
  ],
});
// → { feature_names, X: number[][], y: number[], weights, formula_version_ids, batch_codes }

// Inverse recommender
const anchors = await api.getInverseAnchors({ product_category_code: 'ENGINE_OILS' });
// each anchor has: features, composition_vector, achieved_metrics, sample_size, cost_target
```

Inputs from upstream modules:

- `cleaning` → `normalized_test_results` (used as the y-source via Repository.loadBatchTargets / loadAchievedMetrics)
- `master-data` → `raw_materials.tags`, `density`, `viscosity_cst`, `default_unit_cost`, `properties` (the X-source)
- `formulas` → `formula_versions` + `formula_items` (the X-structure)

## REST API

| Method | Path | Notes |
|--------|------|-------|
| POST   | `/features/runs`                 | Trigger generation. Accepts `{ feature_set_version, scope: { formula_ids?, product_category_code?, only_approved? }, limit }` |
| GET    | `/features/runs[/:id]`           | List / fetch runs |
| GET    | `/features/dictionary?version=v1.0` | Catalog grouped by `feature_group` |
| GET    | `/features/forward-samples`      | Filter `feature_set_version`, `product_category_code`, `target_metric`, `is_complete`, `formula_version_id` |
| GET    | `/features/forward-matrix?target_metric=...&feature_names=...` | Returns `{ X, y, weights }` ready for training |
| GET    | `/features/inverse-base`         | Filter same as above |
| GET    | `/features/formula-version/:id?version=v1.0` | Cached features for one version |

All responses use the platform unified envelope.

## Try it locally

```bash
docker-compose up -d postgres                # auto-applies 0014 + 11
pnpm -F @fluidmind/backend dev

# Run the cleaning pipeline first so we have y-data
curl -X POST http://localhost:3001/api/v1/cleaning/runs -H 'Content-Type: application/json' -d '{}'

# Then generate features (covers all formula_versions)
curl -X POST http://localhost:3001/api/v1/features/runs -H 'Content-Type: application/json' -d '{}'

# Inspect the dictionary
curl 'http://localhost:3001/api/v1/features/dictionary?version=v1.0' | jq

# Pull engine-oil samples for KV_100C
curl 'http://localhost:3001/api/v1/features/forward-samples?product_category_code=ENGINE_OILS&target_metric=KV_100C' | jq

# Fit-ready matrix
curl 'http://localhost:3001/api/v1/features/forward-matrix?product_category_code=ENGINE_OILS&target_metric=KV_100C&feature_names=pct_base,pct_additive,weighted_density,blended_viscosity_cst,complexity_entropy,has_zddp' | jq

# Browse inverse anchors
curl 'http://localhost:3001/api/v1/features/inverse-base?product_category_code=ENGINE_OILS' | jq
```

## Testing

```bash
pnpm -F @fluidmind/backend test
```

Module-specific suite (`tests/unit/features/extractors.test.ts`) covers:

- StructureExtractor: counts, role buckets, percentage sums
- WeightedPropertyExtractor + `weightedAvg`: mass-weighting math, missing-input handling
- Refutas viscosity blending: known-good values, completeness gates, missing_count
- Naive log-weighted viscosity: matches direct calculation
- Complexity: entropy of uniform mix == ln(N), single-component == 0, top3 ranking
- CostExtractor: amount × unit_cost, fallback to material.default_unit_cost, batch_size division
- FunctionalExtractor: tag-driven detection, additive/base ratio, phosphorus estimate
- buildFeatureSet integration: hot column population, missing-input propagation

37 cases total.

## Adding a new feature

1. Implement an `Extractor` (or extend an existing one) under `extractors/`.
2. Add it to `defaultExtractors()` in `pipeline/builder.ts`.
3. Register the metadata row in `feature_definitions` under the next `feature_set_version`.
4. (If hot-column-worthy) add a column to `formula_version_features` via a new migration and update `repository.upsertFormulaVersionFeatures`.
5. Trigger a generation run with the new version. Old samples remain on the prior version.

The shipped 6 extractors are unit-test-friendly templates — clone one when starting.

## Operational notes

- **Idempotent runs**: every persistence path uses `ON CONFLICT … DO UPDATE`, keyed by `(formula_version_id, batch_code, feature_set_version)` for marts and `(formula_version_id, feature_set_version)` for caches/anchors. Re-running is safe.
- **Trace propagation**: every run is wrapped in `withContext({ traceId })`; logs from any extractor or stage carry the same id, and the same id is stored on `feature_generation_runs.trace_id`.
- **Performance**: Repository.listFormulaVersionInputs joins items + materials in **one** query; the per-version processing loop is in-memory and fast (~ms each). For 10K versions, plan ~30-60 s end-to-end including all marts.
- **Outliers**: `mart_forward_training_sample.is_outlier` is set when ANY of the source `normalized_test_results` was an outlier. Down-weighted to `weight = 0.3` rather than excluded — the trainer can choose to filter further.
- **Missing inputs**: `formula_version_features.missing_inputs` is a JSON array of human-readable notes (e.g. `["density: 2 items missing"]`). Useful when a feature unexpectedly comes back null.
