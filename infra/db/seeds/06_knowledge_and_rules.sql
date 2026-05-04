-- =============================================================================
-- 06_knowledge_and_rules.sql
-- Sample knowledge documents and expert rules.
-- =============================================================================

INSERT INTO knowledge_documents (
  id, code, title, doc_type, status, summary, content, content_format,
  domain, tags, author_id, published_at
) VALUES
  ('eeeeeeee-eeee-eeee-eeee-eeeeeeeeee01',
   'KB-LUB-001',
   'ZDDP Anti-wear Chemistry — Quick Reference',
   'memo', 'published',
   'Practical compatibility notes on ZDDP anti-wear additives in modern engine-oil formulations.',
   '# ZDDP Notes

ZDDP delivers anti-wear performance via a tribofilm formed under boundary-lubrication conditions.

## Compatibility
- Phenolic antioxidants: synergistic at moderate doses (≤ 1.0%)
- Detergents (calcium sulfonate): generally compatible
- Tertiary amine antioxidants: avoid above 90°C (risk of S/P depletion)

## Dosage
Recommended P content: 600–800 ppm for SP / API SP+. Above 800 ppm risks catalyst poisoning.',
   'markdown', 'lubricants',
   ARRAY['zddp','aw','additive_compatibility'],
   '22222222-2222-2222-2222-222222222204', NOW() - INTERVAL '60 days'),

  ('eeeeeeee-eeee-eeee-eeee-eeeeeeeeee02',
   'KB-PROC-001',
   'Standard Blending SOP',
   'sop', 'published',
   'Standard operating procedure for laboratory blending of lubricant formulations.',
   '# Lab Blending SOP\n\n1. Pre-heat base oils to 60°C ± 2°C\n2. Charge in order: high-VI base → low-VI base\n3. Add additives in B-phase between 70-80°C\n4. Final blend 30 min at 800 RPM',
   'markdown', 'lubricants',
   ARRAY['sop','blending','procedure'],
   '22222222-2222-2222-2222-222222222204', NOW() - INTERVAL '180 days')
ON CONFLICT (id) DO NOTHING;

-- ---------------------------------------------------------------------------
-- Expert rules
-- ---------------------------------------------------------------------------
INSERT INTO expert_rules (
  id, code, name, natural_language_description, rule_type, domain, severity,
  condition_expr, action_expr, source_doc_id, is_active, authored_by, approved_by, approved_at
) VALUES
  ('ffffffff-ffff-ffff-ffff-ffffffffff01',
   'RULE-ZDDP-MAX-PHOSPHORUS',
   'Maximum phosphorus from ZDDP',
   'Total phosphorus contribution from ZDDP additives must not exceed 800 ppm in API SP / GF-6 formulations.',
   'regulatory', 'lubricants', 'error',
   '{"all": [{"fact": "formula.api_grade", "op": "in", "value": ["SP","GF-6"]}, {"fact": "formula.phosphorus_ppm", "op": "gt", "value": 800}]}'::jsonb,
   '{"block": true, "message": "Phosphorus exceeds API SP limit of 800 ppm"}'::jsonb,
   'eeeeeeee-eeee-eeee-eeee-eeeeeeeeee01',
   TRUE, '22222222-2222-2222-2222-222222222204', '22222222-2222-2222-2222-222222222202', NOW() - INTERVAL '30 days'),

  ('ffffffff-ffff-ffff-ffff-ffffffffff02',
   'RULE-AO-ZDDP-COMPAT',
   'Tertiary amine AO incompatible with ZDDP at high temp',
   'Tertiary-amine antioxidants combined with ZDDP at process temperatures above 90°C accelerate sulfur/phosphorus depletion.',
   'compatibility', 'lubricants', 'warning',
   '{"all": [{"fact": "ingredients.contains", "op": "eq", "value": "tertiary_amine_ao"}, {"fact": "ingredients.contains", "op": "eq", "value": "zddp"}, {"fact": "process.peak_temp_c", "op": "gt", "value": 90}]}'::jsonb,
   '{"block": false, "message": "Consider phenolic AO substitution or lower process temperature"}'::jsonb,
   'eeeeeeee-eeee-eeee-eeee-eeeeeeeeee01',
   TRUE, '22222222-2222-2222-2222-222222222204', '22222222-2222-2222-2222-222222222202', NOW() - INTERVAL '20 days'),

  ('ffffffff-ffff-ffff-ffff-ffffffffff03',
   'RULE-VI-MIN',
   'Minimum VI for engine oil',
   'Engine oils must have a Viscosity Index of at least 150 to qualify for the FluidMind premium tier.',
   'quality', 'lubricants', 'warning',
   '{"all": [{"fact": "product.category", "op": "eq", "value": "engine_oil"}, {"fact": "formula.vi", "op": "lt", "value": 150}]}'::jsonb,
   '{"block": false, "message": "VI below premium-tier threshold (150)"}'::jsonb,
   NULL,
   TRUE, '22222222-2222-2222-2222-222222222204', '22222222-2222-2222-2222-222222222202', NOW() - INTERVAL '15 days')
ON CONFLICT (id) DO NOTHING;
