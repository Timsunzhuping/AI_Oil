-- =============================================================================
-- 04_experiments_and_tests.sql
-- Test methods catalog, sample experiment, and test_results.
-- =============================================================================

-- ---------------------------------------------------------------------------
-- test_methods catalog
-- ---------------------------------------------------------------------------
INSERT INTO test_methods (id, code, name, standard, unit_of_measure, data_type, category, expected_min, expected_max) VALUES
  ('aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaa01', 'KV_40C',     'Kinematic Viscosity @ 40°C',   'ASTM D445',  'cSt',  'numeric', 'physical', NULL, NULL),
  ('aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaa02', 'KV_100C',    'Kinematic Viscosity @ 100°C',  'ASTM D445',  'cSt',  'numeric', 'physical', NULL, NULL),
  ('aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaa03', 'VI',         'Viscosity Index',              'ASTM D2270', NULL,   'numeric', 'physical', NULL, NULL),
  ('aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaa04', 'POUR_POINT', 'Pour Point',                   'ASTM D97',   '°C',   'numeric', 'physical', NULL, NULL),
  ('aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaa05', 'FLASH_POINT','Flash Point',                  'ASTM D92',   '°C',   'numeric', 'physical', NULL, NULL),
  ('aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaa06', 'TBN',        'Total Base Number',            'ASTM D2896', 'mg KOH/g', 'numeric', 'chemical', NULL, NULL),
  ('aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaa07', 'NOACK',      'Noack Volatility',             'ASTM D5800', '%',    'numeric', 'physical', NULL, NULL)
ON CONFLICT (code) DO NOTHING;

-- ---------------------------------------------------------------------------
-- Sample experiment for the approved formula version
-- ---------------------------------------------------------------------------
INSERT INTO experiments (
  id, code, title, formula_version_id, product_id, experiment_type, status,
  hypothesis, conditions, batch_size, batch_unit,
  scheduled_at, started_at, completed_at, conducted_by, outcome, conclusion, tags
) VALUES (
  'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbb01',
  'EXP-2026-0001',
  'Validation batch for FORM-EO-5W30-A v1.1.0',
  '99999999-9999-9999-9999-999999999902',
  '77777777-7777-7777-7777-777777777701',
  'validation', 'completed',
  'Confirms KV100, VI, and TBN meet target spec',
  '{"ambient_temp_c": 22, "humidity_pct": 45, "blender_rpm": 800}'::jsonb,
  100.0, 'kg',
  NOW() - INTERVAL '6 days',
  NOW() - INTERVAL '5 days' - INTERVAL '4 hours',
  NOW() - INTERVAL '5 days' - INTERVAL '1 hours',
  '22222222-2222-2222-2222-222222222203',
  'success',
  'All critical specs met. KV100 at 10.4 cSt, within target range. VI 167. TBN 8.6.',
  ARRAY['validation','engine_oil','5W-30']
) ON CONFLICT (id) DO NOTHING;

-- ---------------------------------------------------------------------------
-- Test results from the experiment
-- ---------------------------------------------------------------------------
INSERT INTO test_results (
  experiment_id, formula_version_id, product_id,
  test_method_id, test_code, test_name, test_standard,
  measured_value, unit_of_measure, expected_min, expected_max, pass,
  measured_at, measured_by, sample_code
) VALUES
  ('bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbb01', '99999999-9999-9999-9999-999999999902', '77777777-7777-7777-7777-777777777701',
   'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaa02', 'KV_100C', 'Kinematic Viscosity @ 100°C', 'ASTM D445',
   10.4, 'cSt', 9.3, 12.5, TRUE,
   NOW() - INTERVAL '5 days', '22222222-2222-2222-2222-222222222203', 'EXP-2026-0001-S1'),

  ('bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbb01', '99999999-9999-9999-9999-999999999902', '77777777-7777-7777-7777-777777777701',
   'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaa03', 'VI', 'Viscosity Index', 'ASTM D2270',
   167, NULL, 150, NULL, TRUE,
   NOW() - INTERVAL '5 days', '22222222-2222-2222-2222-222222222203', 'EXP-2026-0001-S1'),

  ('bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbb01', '99999999-9999-9999-9999-999999999902', '77777777-7777-7777-7777-777777777701',
   'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaa06', 'TBN', 'Total Base Number', 'ASTM D2896',
   8.6, 'mg KOH/g', 7.5, 10.0, TRUE,
   NOW() - INTERVAL '5 days', '22222222-2222-2222-2222-222222222203', 'EXP-2026-0001-S1'),

  ('bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbb01', '99999999-9999-9999-9999-999999999902', '77777777-7777-7777-7777-777777777701',
   'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaa07', 'NOACK', 'Noack Volatility', 'ASTM D5800',
   8.2, '%', NULL, 13.0, TRUE,
   NOW() - INTERVAL '5 days', '22222222-2222-2222-2222-222222222203', 'EXP-2026-0001-S1');
