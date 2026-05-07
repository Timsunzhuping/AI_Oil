-- =============================================================================
-- 14_prediction_and_recommendation.sql
-- Seed prediction model versions, recommendation requests, and results
-- to demonstrate the full forward + inverse recommendation loop.
-- =============================================================================

-- ---------------------------------------------------------------------------
-- ML Model Registry + Versions (for prediction + recommendation models)
-- ---------------------------------------------------------------------------
INSERT INTO ml_model_registry (
  id, code, name, description, task_type, framework, model_type,
  status, owner_id, created_by, trace_id
) VALUES
  (
    '33333333-3333-3333-3333-333333333301',
    'pred-viscosity-v1',
    'Viscosity Prediction (KV@100C)',
    'Predicts kinematic viscosity at 100°C from BOM composition using gradient boosting.',
    'regression',
    'xgboost',
    'supervised_tabular',
    'active',
    '11111111-1111-1111-1111-111111111102',
    '11111111-1111-1111-1111-111111111101',
    'seed-2026-05-07'
  ),
  (
    '33333333-3333-3333-3333-333333333302',
    'pred-multioutput-v1',
    'Multi-Output Property Prediction',
    'Predicts KV@40C, KV@100C, VI, TBN, TAN from BOM in single pass.',
    'regression',
    'lightgbm',
    'supervised_tabular',
    'active',
    '11111111-1111-1111-1111-111111111102',
    '11111111-1111-1111-1111-111111111101',
    'seed-2026-05-07'
  ),
  (
    '33333333-3333-3333-3333-333333333303',
    'rec-formula-gen-v1',
    'Formula Recommendation Engine',
    'Generates candidate BOMs satisfying target metrics and cost constraints via bayesian optimization.',
    'recommendation',
    'custom',
    'generative',
    'active',
    '11111111-1111-1111-1111-111111111102',
    '11111111-1111-1111-1111-111111111101',
    'seed-2026-05-07'
  )
ON CONFLICT DO NOTHING;

-- ---------------------------------------------------------------------------
-- Model Versions
-- ---------------------------------------------------------------------------
INSERT INTO ml_model_versions (
  id, model_id, version_num, version_tag, model_artifact_url, input_schema, output_schema,
  training_metadata, evaluation_metrics, status, deployed_at, created_by, trace_id
) VALUES
  (
    '44444444-4444-4444-4444-444444444401',
    '33333333-3333-3333-3333-333333333301',
    1,
    'v1.0.0',
    's3://fluidmind-models/pred-viscosity/v1.0.0/model.pkl',
    '{"bom_items": "array", "product_category": "string", "target_metrics": ["array", "string"]}'::jsonb,
    '{"KV_100C": "float", "confidence": "float"}'::jsonb,
    '{"training_set": "PCMO_2024_Q1", "epochs": 150, "batch_size": 32, "seed": 42}'::jsonb,
    '{"rmse": 0.34, "mae": 0.22, "r2": 0.956, "cross_val_rmse": 0.38}'::jsonb,
    'production',
    '2026-04-15 10:00:00+00',
    '11111111-1111-1111-1111-111111111101',
    'seed-2026-05-07'
  ),
  (
    '44444444-4444-4444-4444-444444444402',
    '33333333-3333-3333-3333-333333333302',
    1,
    'v1.0.0',
    's3://fluidmind-models/pred-multioutput/v1.0.0/model.pkl',
    '{"bom_items": "array", "product_category": "string"}'::jsonb,
    '{"KV_40C": "float", "KV_100C": "float", "VI": "float", "TBN": "float", "TAN": "float", "confidence": "float"}'::jsonb,
    '{"training_set": "PCMO_GearOil_2024_Q1", "epochs": 200, "batch_size": 64}'::jsonb,
    '{"multioutput_rmse": 0.45, "kv100c_rmse": 0.35, "r2_avg": 0.943}'::jsonb,
    'production',
    '2026-04-20 14:30:00+00',
    '11111111-1111-1111-1111-111111111101',
    'seed-2026-05-07'
  ),
  (
    '44444444-4444-4444-4444-444444444403',
    '33333333-3333-3333-3333-333333333303',
    1,
    'v1.0.0',
    's3://fluidmind-models/rec-formula-gen/v1.0.0/',
    '{"request": {"product_category": "string", "target_metrics": "array", "cost_limit": "float", "n_candidates": "int"}}'::jsonb,
    '{"candidates": [{"bom": "array", "cost": "float", "confidence": "float", "risks": "array"}]}'::jsonb,
    '{"optimization_method": "bayesian", "material_pool_size": 450, "candidate_generation_timeout_ms": 5000}'::jsonb,
    '{"avg_top1_confidence": 0.82, "avg_cost_vs_limit": 0.71, "constraint_satisfaction_rate": 0.94}'::jsonb,
    'production',
    '2026-05-01 09:00:00+00',
    '11111111-1111-1111-1111-111111111101',
    'seed-2026-05-07'
  )
ON CONFLICT DO NOTHING;

-- ---------------------------------------------------------------------------
-- Prediction History (Forward runs — demonstrates output from prediction module)
-- ---------------------------------------------------------------------------
INSERT INTO prediction_history (
  id, model_version_id, input_data, predicted_output, confidence_scores,
  prediction_duration_ms, status, metadata, created_at, trace_id
) VALUES
  (
    '55555555-5555-5555-5555-555555555501',
    '44444444-4444-4444-4444-444444444402',
    '{
      "product_category": "engine_oil_pcmo",
      "bom_items": [
        {"material_code": "PAO-6", "ratio": 0.50},
        {"material_code": "GIII-4cSt", "ratio": 0.30},
        {"material_code": "OCP", "ratio": 0.12},
        {"material_code": "PKG-A", "ratio": 0.08}
      ]
    }'::jsonb,
    '{
      "KV_40C": 55.1,
      "KV_100C": 11.42,
      "VI": 164,
      "TBN": 9.15,
      "TAN": 0.08
    }'::jsonb,
    '{"overall_confidence": 0.91, "per_metric": {"KV_100C": 0.93, "VI": 0.88, "TBN": 0.86}}'::jsonb,
    23,
    'succeeded',
    '{"model_mode": "mock", "temperature": 0.0}'::jsonb,
    NOW() - INTERVAL '2 days',
    'pred-hist-001'
  ),
  (
    '55555555-5555-5555-5555-555555555502',
    '44444444-4444-4444-4444-444444444402',
    '{
      "product_category": "engine_oil_pcmo",
      "bom_items": [
        {"material_code": "PAO-8", "ratio": 0.45},
        {"material_code": "GIII-6cSt", "ratio": 0.35},
        {"material_code": "OCP", "ratio": 0.10},
        {"material_code": "PKG-B", "ratio": 0.10}
      ]
    }'::jsonb,
    '{
      "KV_40C": 62.8,
      "KV_100C": 12.85,
      "VI": 157,
      "TBN": 10.05,
      "TAN": 0.07
    }'::jsonb,
    '{"overall_confidence": 0.88, "per_metric": {"KV_100C": 0.90, "VI": 0.85, "TBN": 0.89}}'::jsonb,
    21,
    'succeeded',
    '{"model_mode": "mock", "temperature": 0.0}'::jsonb,
    NOW() - INTERVAL '1 day',
    'pred-hist-002'
  )
ON CONFLICT DO NOTHING;

-- ---------------------------------------------------------------------------
-- Recommendation Requests + Candidates (Inverse runs)
-- ---------------------------------------------------------------------------
INSERT INTO recommendation_requests (
  id, product_category, target_metrics, cost_limit, material_pool_constraints,
  strategy, n_candidates_requested, metadata, created_by, trace_id
) VALUES
  (
    '66666666-6666-6666-6666-666666666601',
    'engine_oil_pcmo',
    '[{"name": "KV_100C", "target": 11.5, "weight": 0.7}, {"name": "VI", "target": 160, "weight": 0.3}]'::jsonb,
    35.0,
    '{"required_roles": ["base_oil", "vii"], "excluded_materials": ["deprecated_additive_x"]}'::jsonb,
    'cost_priority',
    3,
    '{"campaign": "Q2_cost_reduction", "priority": "high"}'::jsonb,
    '11111111-1111-1111-1111-111111111102',
    'rec-req-001'
  ),
  (
    '66666666-6666-6666-6666-666666666602',
    'engine_oil_pcmo',
    '[{"name": "KV_100C", "target": 12.0, "weight": 0.5}, {"name": "VI", "target": 165, "weight": 0.3}, {"name": "TBN", "target": 10, "weight": 0.2}]'::jsonb,
    50.0,
    '{"required_materials": ["PAO-6"]}'::jsonb,
    'quality_balance',
    5,
    '{"campaign": "premium_line", "priority": "medium"}'::jsonb,
    '11111111-1111-1111-1111-111111111102',
    'rec-req-002'
  )
ON CONFLICT DO NOTHING;

-- ---------------------------------------------------------------------------
-- Candidate BOMs from Recommendation Engine
-- ---------------------------------------------------------------------------
INSERT INTO recommendation_candidates (
  id, request_id, rank, bom_json, estimated_cost, confidence, evaluation_summary,
  risk_warnings, passed_filter, created_at
) VALUES
  (
    '77777777-7777-7777-7777-777777777701',
    '66666666-6666-6666-6666-666666666601',
    1,
    '[
      {"material_code": "PAO-6", "material_name": "PAO-6 Synthetic", "role": "base_oil", "ratio": 0.50, "cost": 18.0},
      {"material_code": "GIII-4cSt", "material_name": "GIII-4cSt", "role": "base_oil", "ratio": 0.30, "cost": 5.5},
      {"material_code": "OCP", "material_name": "OCP VII", "role": "vii", "ratio": 0.12, "cost": 3.2},
      {"material_code": "PKG-A", "material_name": "Package A", "role": "detergent", "ratio": 0.08, "cost": 2.8}
    ]'::jsonb,
    29.5,
    0.87,
    '{"metric_coverage": 0.92, "cost_efficiency": 0.85, "overall_feasibility": 0.87}'::jsonb,
    '[
      {"level": "info", "code": "HISTORICAL_DATA_LIMITED", "message": "Only 8 months production history for GIII-4cSt supplier"}
    ]'::jsonb,
    true,
    NOW() - INTERVAL '3 hours'
  ),
  (
    '77777777-7777-7777-7777-777777777702',
    '66666666-6666-6666-6666-666666666601',
    2,
    '[
      {"material_code": "PAO-8", "material_name": "PAO-8 Synthetic", "role": "base_oil", "ratio": 0.45, "cost": 19.5},
      {"material_code": "GIII-6cSt", "material_name": "GIII-6cSt", "role": "base_oil", "ratio": 0.35, "cost": 6.8},
      {"material_code": "OCP", "material_name": "OCP VII", "role": "vii", "ratio": 0.10, "cost": 2.7},
      {"material_code": "PKG-C", "material_name": "Package C", "role": "detergent", "ratio": 0.10, "cost": 3.2}
    ]'::jsonb,
    32.2,
    0.79,
    '{"metric_coverage": 0.88, "cost_efficiency": 0.78, "overall_feasibility": 0.79}'::jsonb,
    '[]'::jsonb,
    true,
    NOW() - INTERVAL '3 hours'
  ),
  (
    '77777777-7777-7777-7777-777777777703',
    '66666666-6666-6666-6666-666666666602',
    1,
    '[
      {"material_code": "PAO-6", "material_name": "PAO-6 Synthetic", "role": "base_oil", "ratio": 0.50, "cost": 18.0},
      {"material_code": "GIII-4cSt", "material_name": "GIII-4cSt", "role": "base_oil", "ratio": 0.28, "cost": 5.2},
      {"material_code": "OCP", "material_name": "OCP VII", "role": "vii", "ratio": 0.14, "cost": 3.8},
      {"material_code": "PKG-A", "material_name": "Package A", "role": "detergent", "ratio": 0.08, "cost": 2.8}
    ]'::jsonb,
    29.8,
    0.92,
    '{"metric_coverage": 0.96, "cost_efficiency": 0.88, "overall_feasibility": 0.92}'::jsonb,
    '[]'::jsonb,
    true,
    NOW() - INTERVAL '2 hours'
  )
ON CONFLICT DO NOTHING;
