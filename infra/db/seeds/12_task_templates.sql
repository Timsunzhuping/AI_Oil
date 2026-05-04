-- =============================================================================
-- 12_task_templates.sql
-- Default templates for every AI workflow task type.
-- Each template's `input_schema` is a JSON-Schema-like fragment that the
-- task service uses to validate incoming structured payloads.
-- =============================================================================

INSERT INTO r_and_d_task_templates (id, code, name, task_type, description, input_schema, default_payload, example_payload, display_order) VALUES

  -- ========== forward_prediction ==========
  ('aa000000-0000-0000-0000-000000000001',
   'tpl.forward_prediction.kv100',
   'Forward Prediction — Kinematic Viscosity @ 100°C',
   'forward_prediction',
   'Predict KV100 for a given formula composition + feature_set_version.',
   '{"type":"object","required":["formula_version_id","target_metric"],"properties":{
       "formula_version_id":{"type":"string","format":"uuid"},
       "target_metric":{"type":"string","enum":["KV_100C","KV_40C","VI","TBN","FLASH_POINT","NOACK"]},
       "feature_set_version":{"type":"string","default":"v1.0"}
     }}'::jsonb,
   '{"feature_set_version":"v1.0","target_metric":"KV_100C"}'::jsonb,
   '{"formula_version_id":"99999999-9999-9999-9999-999999999902","target_metric":"KV_100C","feature_set_version":"v1.0"}'::jsonb,
   10),

  -- ========== batch_prediction ==========
  ('aa000000-0000-0000-0000-000000000002',
   'tpl.batch_prediction.engine_oils',
   'Batch Prediction — Engine Oils Family',
   'batch_prediction',
   'Run forward prediction across every approved formula_version in a category.',
   '{"type":"object","required":["target_metrics","product_category_code"],"properties":{
       "product_category_code":{"type":"string"},
       "target_metrics":{"type":"array","items":{"type":"string"},"minItems":1},
       "feature_set_version":{"type":"string","default":"v1.0"},
       "only_approved":{"type":"boolean","default":true}
     }}'::jsonb,
   '{"feature_set_version":"v1.0","only_approved":true,"target_metrics":["KV_100C","VI"]}'::jsonb,
   '{"product_category_code":"ENGINE_OILS","target_metrics":["KV_100C","VI","TBN"],"feature_set_version":"v1.0","only_approved":true}'::jsonb,
   20),

  -- ========== cost_optimization ==========
  ('aa000000-0000-0000-0000-000000000003',
   'tpl.cost_optimization.iso_46',
   'Cost Optimization — ISO VG 46 Hydraulic',
   'cost_optimization',
   'Suggest formulation tweaks that reduce total_cost while keeping target metrics within tolerance.',
   '{"type":"object","required":["base_formula_version_id","cost_target","constraints"],"properties":{
       "base_formula_version_id":{"type":"string","format":"uuid"},
       "cost_target":{"type":"number","exclusiveMinimum":0,"description":"USD per batch"},
       "max_cost_reduction_pct":{"type":"number","minimum":0,"maximum":50,"default":15},
       "constraints":{"type":"object","description":"metric_code → {min,max} preserved bounds"}
     }}'::jsonb,
   '{"max_cost_reduction_pct":15}'::jsonb,
   '{"base_formula_version_id":"99999999-9999-9999-9999-999999999902","cost_target":110,"max_cost_reduction_pct":12,"constraints":{"KV_100C":{"min":9.3,"max":12.5},"VI":{"min":150}}}'::jsonb,
   30),

  -- ========== material_replacement ==========
  ('aa000000-0000-0000-0000-000000000004',
   'tpl.material_replacement.zddp_alternative',
   'Material Replacement — Find ZDDP Alternative',
   'material_replacement',
   'Find candidate replacements for a specific raw material; project the impact on metrics.',
   '{"type":"object","required":["base_formula_version_id","replace_raw_material_id"],"properties":{
       "base_formula_version_id":{"type":"string","format":"uuid"},
       "replace_raw_material_id":{"type":"string","format":"uuid"},
       "candidate_role":{"type":"string","description":"Restrict replacements to this role"},
       "preserve_metrics":{"type":"array","items":{"type":"string"},"description":"Metrics that must stay within current spec"},
       "max_candidates":{"type":"integer","minimum":1,"maximum":50,"default":5}
     }}'::jsonb,
   '{"max_candidates":5}'::jsonb,
   '{"base_formula_version_id":"99999999-9999-9999-9999-999999999902","replace_raw_material_id":"55555555-5555-5555-5555-555555555503","candidate_role":"antiwear","preserve_metrics":["KV_100C","VI"],"max_candidates":5}'::jsonb,
   40),

  -- ========== new_product_generation ==========
  ('aa000000-0000-0000-0000-000000000005',
   'tpl.new_product.engine_oil_5W30',
   'New Product Generation — 5W-30 Engine Oil',
   'new_product_generation',
   'Synthesize a brand-new candidate formulation given target metrics and constraints.',
   '{"type":"object","required":["product_category_code","target_metrics"],"properties":{
       "product_category_code":{"type":"string"},
       "target_metrics":{"type":"object","description":"metric_code → {target?, min?, max?}"},
       "max_total_cost":{"type":"number"},
       "preferred_materials":{"type":"array","items":{"type":"string","format":"uuid"}},
       "excluded_materials":{"type":"array","items":{"type":"string","format":"uuid"}},
       "n_candidates":{"type":"integer","minimum":1,"maximum":20,"default":3}
     }}'::jsonb,
   '{"n_candidates":3}'::jsonb,
   '{"product_category_code":"ENGINE_OILS","target_metrics":{"KV_100C":{"min":9.3,"max":12.5},"VI":{"min":160}},"max_total_cost":350,"n_candidates":3}'::jsonb,
   50),

  -- ========== knowledge_qa ==========
  ('aa000000-0000-0000-0000-000000000006',
   'tpl.knowledge_qa.basic',
   'Knowledge Q&A',
   'knowledge_qa',
   'Ask a question; the system retrieves relevant SOP/papers/notes and answers with citations.',
   '{"type":"object","required":["question"],"properties":{
       "question":{"type":"string","minLength":4},
       "domain":{"type":"string","description":"Restrict retrieval to a domain (lubricants, cosmetics, ...)"},
       "max_sources":{"type":"integer","minimum":1,"maximum":20,"default":5}
     }}'::jsonb,
   '{"max_sources":5}'::jsonb,
   '{"question":"What is the recommended phosphorus limit for API SP engine oils?","domain":"lubricants","max_sources":5}'::jsonb,
   60)

ON CONFLICT (code) DO NOTHING;
