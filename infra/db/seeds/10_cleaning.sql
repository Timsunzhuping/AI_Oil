-- =============================================================================
-- 10_cleaning.sql
-- Built-in cleaning rules + sample "dirty" test_results that exercise them.
-- =============================================================================

-- ---------------------------------------------------------------------------
-- Built-in cleaning rules
-- ---------------------------------------------------------------------------

-- pH must be in [0, 14]
INSERT INTO cleaning_rules (id, code, name, rule_type, scope, severity, condition_expr, action_expr, priority, description) VALUES
  ('11000000-0000-0000-0000-000000000001',
   'PH_OUT_OF_PHYSICAL_RANGE',
   'pH outside physical range [0, 14]',
   'outlier', 'test_result', 'error',
   '{"all":[{"fact":"metric.code","op":"eq","value":"PH"},{"any":[{"fact":"value","op":"lt","value":0},{"fact":"value","op":"gt","value":14}]}]}'::jsonb,
   '{"flag":"outlier","outlier_method":"rule","issue_code":"PH_OUT_OF_PHYSICAL_RANGE","message":"pH must be in [0, 14]"}'::jsonb,
   100, 'Hard physical-chemistry constraint'),

  -- Negative numeric values are usually data-entry errors
  ('11000000-0000-0000-0000-000000000002',
   'NEGATIVE_NUMERIC_MEASUREMENT',
   'Numeric measurement is negative',
   'outlier', 'test_result', 'warning',
   '{"all":[{"fact":"value","op":"lt","value":0},{"fact":"metric.code","op":"not_in","value":["TEMPERATURE_DELTA","CURRENT_OFFSET"]}]}'::jsonb,
   '{"flag":"outlier","outlier_method":"rule","issue_code":"NEGATIVE_VALUE","message":"Negative measurement is suspicious for this metric"}'::jsonb,
   90, 'Most properties are non-negative'),

  -- Spec violation: value outside metric.expected_min/max
  ('11000000-0000-0000-0000-000000000003',
   'SPEC_VIOLATION',
   'Value outside metric expected range',
   'outlier', 'test_result', 'warning',
   '{"any":[{"fact":"value","op":"lt","value_fact":"metric.expected_min"},{"fact":"value","op":"gt","value_fact":"metric.expected_max"}]}'::jsonb,
   '{"flag":"outlier","outlier_method":"spec","issue_code":"SPEC_VIOLATION","message":"Value outside metric.expected_min/max"}'::jsonb,
   80, 'Soft envelope from metric registry'),

  -- KV at 100°C must be positive
  ('11000000-0000-0000-0000-000000000004',
   'KV100_NON_POSITIVE',
   'KV @ 100°C must be > 0',
   'outlier', 'test_result', 'error',
   '{"all":[{"fact":"metric.code","op":"eq","value":"KV_100C"},{"fact":"value","op":"lte","value":0}]}'::jsonb,
   '{"flag":"outlier","outlier_method":"rule","issue_code":"KV100_NON_POSITIVE","message":"Kinematic viscosity must be strictly positive"}'::jsonb,
   100, 'Physical constraint'),

  -- Missing required: measured_value present but unit missing
  ('11000000-0000-0000-0000-000000000005',
   'MEASURED_VALUE_WITHOUT_UNIT',
   'measured_value present without a unit',
   'validation', 'test_result', 'warning',
   '{"all":[{"fact":"value","op":"present"},{"fact":"raw_unit","op":"absent"}]}'::jsonb,
   '{"flag":"missing_field","field":"raw_unit","issue_code":"MEASURED_VALUE_WITHOUT_UNIT","message":"Measurement has a value but no unit"}'::jsonb,
   70, 'Cannot trust a number without its unit'),

  -- Unresolved metric flagged separately
  ('11000000-0000-0000-0000-000000000006',
   'UNRESOLVED_METRIC',
   'Could not resolve metric to a standard code',
   'validation', 'test_result', 'error',
   '{"fact":"metric.id","op":"absent"}'::jsonb,
   '{"flag":"unresolved","issue_code":"UNRESOLVED_METRIC","message":"Metric name did not match any standard code or alias"}'::jsonb,
   60, 'Falls back to fuzzy lookup before raising')
ON CONFLICT (code) DO NOTHING;

-- ---------------------------------------------------------------------------
-- Sample "dirty" raw test_results that exercise multiple cleaning paths.
-- (Pre-seeded raw_materials/products/formula_versions used as anchors.)
-- ---------------------------------------------------------------------------
INSERT INTO test_results (
  id, formula_version_id, product_id,
  test_code, test_name, measured_value, unit_of_measure,
  expected_min, expected_max, pass,
  measured_at, sample_code, batch_code, metadata
) VALUES
  -- 1. Clean baseline — should normalize cleanly
  ('22000000-0000-0000-0000-000000000001',
   '99999999-9999-9999-9999-999999999902', '77777777-7777-7777-7777-777777777701',
   'KV_100C', 'Kinematic Viscosity @ 100°C', 10.4, 'cSt',
   9.3, 12.5, TRUE,
   NOW() - INTERVAL '1 day', 'CLEAN-S001', 'BATCH-001', '{}'::jsonb),

  -- 2. Unit needs conversion (mm²/s → cSt is identity, but exercise the path)
  ('22000000-0000-0000-0000-000000000002',
   '99999999-9999-9999-9999-999999999902', '77777777-7777-7777-7777-777777777701',
   'KV_100C', 'KV at 100C', 10.5, 'mm²/s',
   NULL, NULL, NULL,
   NOW() - INTERVAL '1 day', 'CLEAN-S002', 'BATCH-001', '{}'::jsonb),

  -- 3. Alias lookup needed (raw test name uses "p.H." → resolve to PH)
  ('22000000-0000-0000-0000-000000000003',
   NULL, NULL,
   'p.H.', 'p.H.', 7.2, NULL,
   NULL, NULL, NULL,
   NOW() - INTERVAL '2 days', 'CLEAN-S003', 'BATCH-002', '{}'::jsonb),

  -- 4. pH WAY out of physical range — rule should flag as outlier
  ('22000000-0000-0000-0000-000000000004',
   NULL, NULL,
   'PH', 'pH', 17.5, NULL,
   NULL, NULL, NULL,
   NOW() - INTERVAL '2 days', 'CLEAN-S004', 'BATCH-002', '{}'::jsonb),

  -- 5. Missing measured value
  ('22000000-0000-0000-0000-000000000005',
   '99999999-9999-9999-9999-999999999902', '77777777-7777-7777-7777-777777777701',
   'TBN', 'Total Base Number', NULL, 'mg KOH/g',
   7.5, 10.0, NULL,
   NOW() - INTERVAL '3 days', 'CLEAN-S005', 'BATCH-003', '{}'::jsonb),

  -- 6. Spec violation (KV100 too low)
  ('22000000-0000-0000-0000-000000000006',
   '99999999-9999-9999-9999-999999999902', '77777777-7777-7777-7777-777777777701',
   'KV_100C', 'KV100', 4.0, 'cSt',
   9.3, 12.5, FALSE,
   NOW() - INTERVAL '3 days', 'CLEAN-S006', 'BATCH-003', '{}'::jsonb),

  -- 7. Negative measurement (data entry error)
  ('22000000-0000-0000-0000-000000000007',
   NULL, NULL,
   'TAN', 'Total Acid Number', -0.5, 'mg KOH/g',
   NULL, NULL, NULL,
   NOW() - INTERVAL '4 days', 'CLEAN-S007', 'BATCH-004', '{}'::jsonb),

  -- 8. Unresolvable metric name (typo / unknown)
  ('22000000-0000-0000-0000-000000000008',
   NULL, NULL,
   'COMPLETELY_UNKNOWN_METRIC_XYZ', 'Mystery Metric', 42.0, NULL,
   NULL, NULL, NULL,
   NOW() - INTERVAL '4 days', 'CLEAN-S008', 'BATCH-004', '{}'::jsonb)
ON CONFLICT (id) DO NOTHING;
