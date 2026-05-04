-- =============================================================================
-- 03_formulas.sql
-- Sample formula with two versions (v1 draft, v2 approved) and items.
-- =============================================================================

-- ---------------------------------------------------------------------------
-- Formula identity
-- ---------------------------------------------------------------------------
INSERT INTO formulas (id, code, name, product_id, status, total_versions, tags) VALUES
  ('88888888-8888-8888-8888-888888888801', 'FORM-EO-5W30-A', 'Engine Oil 5W-30 - Family A',
   '77777777-7777-7777-7777-777777777701', 'active', 2,
   ARRAY['engine_oil','5W-30','active'])
ON CONFLICT (id) DO NOTHING;

-- ---------------------------------------------------------------------------
-- Version 1 — draft
-- ---------------------------------------------------------------------------
INSERT INTO formula_versions (
  id, formula_id, version_number, version_label, parent_version_id, branch, status,
  batch_size, batch_unit, expected_yield_pct,
  process_steps, change_summary, created_by
) VALUES
  ('99999999-9999-9999-9999-999999999901', '88888888-8888-8888-8888-888888888801', 1, 'v1.0.0',
   NULL, 'main', 'retired',
   100.0, 'kg', 99.0,
   '[{"step": 1, "action": "charge_base", "temp_c": 60}, {"step": 2, "action": "add_additives", "temp_c": 75}, {"step": 3, "action": "blend", "duration_min": 30}]'::jsonb,
   'Initial draft from existing 5W-30 reference formulation',
   '22222222-2222-2222-2222-222222222203')
ON CONFLICT (id) DO NOTHING;

-- ---------------------------------------------------------------------------
-- Version 2 — approved (the active version)
-- ---------------------------------------------------------------------------
INSERT INTO formula_versions (
  id, formula_id, version_number, version_label, parent_version_id, branch, status,
  batch_size, batch_unit, expected_yield_pct,
  process_steps, change_summary,
  submitted_at, submitted_by, approved_at, approved_by, is_locked, locked_at, created_by
) VALUES
  ('99999999-9999-9999-9999-999999999902', '88888888-8888-8888-8888-888888888801', 2, 'v1.1.0',
   '99999999-9999-9999-9999-999999999901', 'main', 'approved',
   100.0, 'kg', 99.5,
   '[{"step": 1, "action": "charge_base", "temp_c": 60}, {"step": 2, "action": "add_aw_package", "temp_c": 75}, {"step": 3, "action": "add_vi_improver", "temp_c": 85, "duration_min": 15}, {"step": 4, "action": "final_blend", "duration_min": 30}]'::jsonb,
   'Increased PAO content for better cold-flow; tightened ZDDP dosage; added VI improver pre-mix step',
   NOW() - INTERVAL '7 days', '22222222-2222-2222-2222-222222222203',
   NOW() - INTERVAL '2 days',  '22222222-2222-2222-2222-222222222204',
   TRUE, NOW() - INTERVAL '2 days',
   '22222222-2222-2222-2222-222222222203')
ON CONFLICT (id) DO NOTHING;

-- ---------------------------------------------------------------------------
-- Promote v2 as the head of the formula and as the product's active formula
-- ---------------------------------------------------------------------------
UPDATE formulas
   SET current_version_id = '99999999-9999-9999-9999-999999999902'
 WHERE id = '88888888-8888-8888-8888-888888888801';

UPDATE products
   SET current_formula_version_id = '99999999-9999-9999-9999-999999999902'
 WHERE id = '77777777-7777-7777-7777-777777777701';

-- ---------------------------------------------------------------------------
-- Formula items for v2 (the approved version)
-- ---------------------------------------------------------------------------
INSERT INTO formula_items (
  formula_version_id, raw_material_id, sequence_no, step_no, phase,
  amount, unit_of_measure, percentage, role, is_critical
) VALUES
  ('99999999-9999-9999-9999-999999999902', '55555555-5555-5555-5555-555555555501', 1, 1, 'A',
   60.0, 'kg', 60.0000, 'base', TRUE),                    -- 60% Mineral Oil 150N
  ('99999999-9999-9999-9999-999999999902', '55555555-5555-5555-5555-555555555502', 2, 1, 'A',
   25.0, 'kg', 25.0000, 'base', TRUE),                    -- 25% PAO 6cSt
  ('99999999-9999-9999-9999-999999999902', '55555555-5555-5555-5555-555555555503', 3, 2, 'B',
    1.2, 'kg',  1.2000, 'antiwear', TRUE),                -- 1.2% ZDDP
  ('99999999-9999-9999-9999-999999999902', '55555555-5555-5555-5555-555555555504', 4, 2, 'B',
    0.8, 'kg',  0.8000, 'antioxidant', FALSE),            -- 0.8% Phenolic AO
  ('99999999-9999-9999-9999-999999999902', '55555555-5555-5555-5555-555555555505', 5, 3, 'C',
   13.0, 'kg', 13.0000, 'vi_improver', TRUE)              -- 13% OCP VI Improver
ON CONFLICT (formula_version_id, sequence_no) DO NOTHING;

-- ---------------------------------------------------------------------------
-- Approval trail for v2
-- ---------------------------------------------------------------------------
INSERT INTO formula_approvals (formula_version_id, stage, decision, approver_id, decided_at, comments) VALUES
  ('99999999-9999-9999-9999-999999999902', 'lab_review', 'approved', '22222222-2222-2222-2222-222222222204', NOW() - INTERVAL '5 days', 'Lab tests passing'),
  ('99999999-9999-9999-9999-999999999902', 'qa',         'approved', '22222222-2222-2222-2222-222222222204', NOW() - INTERVAL '3 days', 'QA sign-off complete'),
  ('99999999-9999-9999-9999-999999999902', 'final',      'approved', '22222222-2222-2222-2222-222222222202', NOW() - INTERVAL '2 days', 'Released to production')
ON CONFLICT (formula_version_id, stage) DO NOTHING;
