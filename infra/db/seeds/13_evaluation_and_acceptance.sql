-- =============================================================================
-- 13_evaluation_and_acceptance.sql
-- Seed evaluation test sets + baseline acceptance runs to demonstrate
-- forward / inverse / stability acceptance workflows.
-- =============================================================================

-- ---------------------------------------------------------------------------
-- Test sets (forward acceptance)
-- ---------------------------------------------------------------------------
INSERT INTO acceptance_test_sets (
  id, code, name, description, test_type, product_category,
  cases, default_tolerance, status, tags, metadata, created_by, trace_id
) VALUES
  (
    '22222222-2222-2222-2222-222222222201',
    'TS-2026-0001',
    'PCMO Forward Acceptance (5W-30)',
    'Five-weight 30 engine oil forward prediction acceptance suite.',
    'forward',
    'engine_oil_pcmo',
    '[
      {
        "id": "fwd-pcmo-001",
        "category": "base_oil",
        "bom": [
          {"material_code": "PAO-6", "material_name": "PAO-6 Synthetic Base", "role": "base_oil", "ratio": 0.50},
          {"material_code": "GIII-4cSt", "material_name": "Group III 4cSt", "role": "base_oil", "ratio": 0.30},
          {"material_code": "OCP", "material_name": "OCP Viscosity Index Improver", "role": "vii", "ratio": 0.12},
          {"material_code": "PKG-A", "material_name": "Advanced Package A", "role": "detergent", "ratio": 0.08}
        ],
        "expected_metrics": {"KV_40C": 55.2, "KV_100C": 11.4, "VI": 165, "TBN": 9.2}
      },
      {
        "id": "fwd-pcmo-002",
        "category": "base_oil",
        "bom": [
          {"material_code": "PAO-8", "material_name": "PAO-8 Synthetic Base", "role": "base_oil", "ratio": 0.45},
          {"material_code": "GIII-6cSt", "material_name": "Group III 6cSt", "role": "base_oil", "ratio": 0.35},
          {"material_code": "OCP", "material_name": "OCP VII", "role": "vii", "ratio": 0.10},
          {"material_code": "PKG-B", "material_name": "Premium Package B", "role": "detergent", "ratio": 0.10}
        ],
        "expected_metrics": {"KV_40C": 62.5, "KV_100C": 12.8, "VI": 158, "TBN": 10.1}
      },
      {
        "id": "fwd-pcmo-003",
        "category": "additive",
        "bom": [
          {"material_code": "PAO-6", "material_name": "PAO-6", "role": "base_oil", "ratio": 0.48},
          {"material_code": "GIII-4cSt", "material_name": "GIII-4cSt", "role": "base_oil", "ratio": 0.32},
          {"material_code": "OCP", "material_name": "OCP", "role": "vii", "ratio": 0.08},
          {"material_code": "PKG-C", "material_name": "Economical Package C", "role": "detergent", "ratio": 0.12}
        ],
        "expected_metrics": {"KV_40C": 54.8, "KV_100C": 11.2, "VI": 162, "TBN": 8.5}
      }
    ]'::jsonb,
    '{"max_relative_error": 0.08, "max_absolute_error": 0.5, "min_metric_pass_rate": 0.75}'::jsonb,
    'published',
    ARRAY['engine_oil', 'pcmo', 'smoke_test'],
    '{"source": "internal_baseline", "confidence": "high"}'::jsonb,
    '11111111-1111-1111-1111-111111111101',
    'seed-2026-05-07'
  ),
  (
    '22222222-2222-2222-2222-222222222202',
    'TS-2026-0002',
    'Industrial Gear Oil Forward Acceptance (ISO VG 220)',
    'Industrial gear oil viscosity + TAN acceptance.',
    'forward',
    'gear_oil_industrial',
    '[
      {
        "id": "fwd-gear-001",
        "category": "iso_vg_220",
        "bom": [
          {"material_code": "PAO-32", "material_name": "PAO-32", "role": "base_oil", "ratio": 0.65},
          {"material_code": "GIII-32cSt", "material_name": "GIII 32cSt", "role": "base_oil", "ratio": 0.25},
          {"material_code": "GEAR-AW-PKG", "material_name": "Gear AW Package", "role": "additive", "ratio": 0.10}
        ],
        "expected_metrics": {"KV_40C": 220, "KV_100C": 19.2, "TAN": 0.5, "VI": 95}
      }
    ]'::jsonb,
    '{"max_relative_error": 0.05, "min_metric_pass_rate": 1.0}'::jsonb,
    'published',
    ARRAY['gear_oil', 'industrial'],
    '{"criticality": "high", "approval_needed": true}'::jsonb,
    '11111111-1111-1111-1111-111111111101',
    'seed-2026-05-07'
  )
ON CONFLICT DO NOTHING;

-- ---------------------------------------------------------------------------
-- Test sets (inverse acceptance)
-- ---------------------------------------------------------------------------
INSERT INTO acceptance_test_sets (
  id, code, name, description, test_type, product_category,
  cases, default_tolerance, status, tags, metadata, created_by, trace_id
) VALUES
  (
    '22222222-2222-2222-2222-222222222203',
    'TS-2026-0003',
    'PCMO Inverse Recommendation Acceptance',
    'Validate recommendation engine meets constraints: KV_100C ~ 11.5 cSt at cost < 35 USD/L.',
    'inverse',
    'engine_oil_pcmo',
    '[
      {
        "id": "inv-pcmo-cost-opt",
        "category": "cost_optimized",
        "request": {
          "product_category": "engine_oil_pcmo",
          "target_metrics": [
            {"name": "KV_100C", "target": 11.5, "weight": 0.7},
            {"name": "VI", "target": 160, "weight": 0.3}
          ],
          "cost_limit": 35,
          "n_candidates": 3,
          "random_seed": 42
        },
        "expectations": {
          "min_passed_candidates": 1,
          "top1_must_have_materials": ["PAO-6"],
          "top1_max_cost": 32,
          "top1_min_confidence": 0.6,
          "no_critical_risks_top": 3
        }
      },
      {
        "id": "inv-pcmo-premium",
        "category": "premium",
        "request": {
          "product_category": "engine_oil_pcmo",
          "target_metrics": [
            {"name": "KV_100C", "target": 12.0, "weight": 0.5},
            {"name": "VI", "target": 165, "weight": 0.3},
            {"name": "TBN", "target": 10, "weight": 0.2}
          ],
          "cost_limit": 50,
          "n_candidates": 5,
          "random_seed": 123
        },
        "expectations": {
          "min_passed_candidates": 2,
          "top1_min_confidence": 0.75,
          "no_critical_risks_top": 1
        }
      }
    ]'::jsonb,
    '{}'::jsonb,
    'published',
    ARRAY['inverse', 'recommendation', 'constraint_satisfaction'],
    '{"strategy": "cost_priority,quality_balance"}'::jsonb,
    '11111111-1111-1111-1111-111111111102',
    'seed-2026-05-07'
  )
ON CONFLICT DO NOTHING;

-- ---------------------------------------------------------------------------
-- Test sets (stability acceptance)
-- ---------------------------------------------------------------------------
INSERT INTO acceptance_test_sets (
  id, code, name, description, test_type, product_category,
  cases, default_tolerance, status, tags, metadata, created_by, trace_id
) VALUES
  (
    '22222222-2222-2222-2222-222222222204',
    'TS-2026-0004',
    'Prediction Stability (5 runs)',
    'Verify predictor output determinism: same BOM × 5 runs → pairwise cosine > 0.99.',
    'stability',
    'engine_oil_pcmo',
    '[
      {
        "id": "stab-predict-pcmo",
        "category": "determinism",
        "mode": "predict",
        "runs": 5,
        "payload": {
          "product_category": "engine_oil_pcmo",
          "bom_items": [
            {"material_code": "PAO-6", "material_name": "PAO-6", "role": "base_oil", "ratio": 0.50},
            {"material_code": "GIII-4cSt", "material_name": "GIII-4cSt", "role": "base_oil", "ratio": 0.30},
            {"material_code": "OCP", "material_name": "OCP", "role": "vii", "ratio": 0.12},
            {"material_code": "PKG-A", "material_name": "PKG-A", "role": "detergent", "ratio": 0.08}
          ],
          "target_metrics": ["KV_40C", "KV_100C", "VI", "TBN"]
        },
        "tolerance": {"min_pairwise_cosine": 0.99, "max_cv": 0.001}
      }
    ]'::jsonb,
    '{"min_pairwise_cosine": 0.98, "max_cv": 0.01}'::jsonb,
    'published',
    ARRAY['stability', 'determinism', 'predict'],
    '{"criticality": "high"}'::jsonb,
    '11111111-1111-1111-1111-111111111102',
    'seed-2026-05-07'
  )
ON CONFLICT DO NOTHING;
