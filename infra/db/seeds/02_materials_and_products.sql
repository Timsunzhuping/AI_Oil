-- =============================================================================
-- 02_materials_and_products.sql
-- Sample raw materials, suppliers, products.
-- Aligned with FluidMind's lubricant / fluid R&D domain.
-- =============================================================================

-- ---------------------------------------------------------------------------
-- Material categories (oils → base oils → mineral / synthetic)
-- ---------------------------------------------------------------------------
INSERT INTO material_categories (id, code, name, parent_id, level, path) VALUES
  ('33333333-3333-3333-3333-333333333301', 'BASE_OILS',     'Base Oils',          NULL, 1, '/base_oils/'),
  ('33333333-3333-3333-3333-333333333302', 'MINERAL_OIL',   'Mineral Oil',        '33333333-3333-3333-3333-333333333301', 2, '/base_oils/mineral_oil/'),
  ('33333333-3333-3333-3333-333333333303', 'PAO',           'PAO Synthetic Oil',  '33333333-3333-3333-3333-333333333301', 2, '/base_oils/pao/'),
  ('33333333-3333-3333-3333-333333333310', 'ADDITIVES',     'Additives',          NULL, 1, '/additives/'),
  ('33333333-3333-3333-3333-333333333311', 'AW_EP',         'Anti-wear / EP',     '33333333-3333-3333-3333-333333333310', 2, '/additives/aw_ep/'),
  ('33333333-3333-3333-3333-333333333312', 'ANTIOXIDANT',   'Antioxidants',       '33333333-3333-3333-3333-333333333310', 2, '/additives/antioxidant/'),
  ('33333333-3333-3333-3333-333333333313', 'VI_IMPROVER',   'VI Improvers',       '33333333-3333-3333-3333-333333333310', 2, '/additives/vi_improver/')
ON CONFLICT (id) DO NOTHING;

-- ---------------------------------------------------------------------------
-- Suppliers
-- ---------------------------------------------------------------------------
INSERT INTO suppliers (id, code, name, country_code, qualification_status, qualified_until, rating, is_active) VALUES
  ('44444444-4444-4444-4444-444444444401', 'SUP-001', 'PetroBase Inc.',          'US', 'qualified', '2027-12-31', 4.50, TRUE),
  ('44444444-4444-4444-4444-444444444402', 'SUP-002', 'SynLube Solutions',       'DE', 'qualified', '2027-06-30', 4.20, TRUE),
  ('44444444-4444-4444-4444-444444444403', 'SUP-003', 'AdditivePro Co.',         'JP', 'qualified', '2027-09-30', 4.80, TRUE)
ON CONFLICT (id) DO NOTHING;

-- ---------------------------------------------------------------------------
-- Raw materials
-- ---------------------------------------------------------------------------
INSERT INTO raw_materials (
  id, code, name, cas_number, category_id, physical_state,
  density, viscosity_cst, flash_point_c, unit_of_measure,
  default_supplier_id, default_unit_cost, hazard_class, status,
  properties, tags
) VALUES
  ('55555555-5555-5555-5555-555555555501', 'RM-MO-150N', 'Mineral Oil 150N', '64742-54-7',
   '33333333-3333-3333-3333-333333333302', 'liquid',
   0.870, 30.5, 220.0, 'kg',
   '44444444-4444-4444-4444-444444444401', 1.20, 'combustible', 'active',
   '{"vi": 95, "pour_point_c": -12, "noack_volatility": 6.5}'::jsonb,
   ARRAY['base','mineral','group_i']),

  ('55555555-5555-5555-5555-555555555502', 'RM-PAO-6',   'PAO 6cSt',          '68037-01-4',
   '33333333-3333-3333-3333-333333333303', 'liquid',
   0.827, 6.1, 235.0, 'kg',
   '44444444-4444-4444-4444-444444444402', 4.80, NULL, 'active',
   '{"vi": 138, "pour_point_c": -57, "noack_volatility": 6.2}'::jsonb,
   ARRAY['base','synthetic','pao','group_iv']),

  ('55555555-5555-5555-5555-555555555503', 'RM-ZDDP-A',  'ZDDP Anti-wear',    '68649-42-3',
   '33333333-3333-3333-3333-333333333311', 'liquid',
   1.080, NULL, 195.0, 'kg',
   '44444444-4444-4444-4444-444444444403', 8.50, 'corrosive', 'active',
   '{"phosphorus_pct": 7.5, "zinc_pct": 8.5, "sulfur_pct": 15.0}'::jsonb,
   ARRAY['additive','aw','ep']),

  ('55555555-5555-5555-5555-555555555504', 'RM-AO-PHEN', 'Phenolic Antioxidant', '128-37-0',
   '33333333-3333-3333-3333-333333333312', 'solid',
   1.050, NULL, 110.0, 'kg',
   '44444444-4444-4444-4444-444444444403', 12.00, NULL, 'active',
   '{"melting_point_c": 70, "solubility_in_oil": "high"}'::jsonb,
   ARRAY['additive','antioxidant']),

  ('55555555-5555-5555-5555-555555555505', 'RM-VI-OCP',  'OCP VI Improver',   '9010-79-1',
   '33333333-3333-3333-3333-333333333313', 'liquid',
   0.880, NULL, NULL, 'kg',
   '44444444-4444-4444-4444-444444444402', 6.20, NULL, 'active',
   '{"shear_stability_index": 25, "thickening_efficiency": "high"}'::jsonb,
   ARRAY['additive','vi_improver','polymer'])
ON CONFLICT (id) DO NOTHING;

-- ---------------------------------------------------------------------------
-- Material-supplier specs
-- ---------------------------------------------------------------------------
INSERT INTO material_supplier_specs (raw_material_id, supplier_id, supplier_sku, unit_cost, lead_time_days, is_primary) VALUES
  ('55555555-5555-5555-5555-555555555501', '44444444-4444-4444-4444-444444444401', 'PB-150N',  1.20, 14, TRUE),
  ('55555555-5555-5555-5555-555555555502', '44444444-4444-4444-4444-444444444402', 'SYN-PAO6', 4.80, 21, TRUE),
  ('55555555-5555-5555-5555-555555555503', '44444444-4444-4444-4444-444444444403', 'AP-ZDDPA', 8.50, 28, TRUE)
ON CONFLICT (raw_material_id, supplier_id) DO NOTHING;

-- ---------------------------------------------------------------------------
-- Product categories
-- ---------------------------------------------------------------------------
INSERT INTO product_categories (id, code, name, parent_id, level, path) VALUES
  ('66666666-6666-6666-6666-666666666601', 'ENGINE_OILS',  'Engine Oils',     NULL, 1, '/engine_oils/'),
  ('66666666-6666-6666-6666-666666666602', 'GEAR_OILS',    'Gear Oils',       NULL, 1, '/gear_oils/'),
  ('66666666-6666-6666-6666-666666666603', 'HYDRAULIC',    'Hydraulic Oils',  NULL, 1, '/hydraulic/')
ON CONFLICT (id) DO NOTHING;

-- ---------------------------------------------------------------------------
-- Products (target spec stored both as JSONB sketch + normalized rows)
-- ---------------------------------------------------------------------------
INSERT INTO products (id, code, name, product_type, category_id, status, target_specifications, intended_use, tags) VALUES
  ('77777777-7777-7777-7777-777777777701', 'PROD-EO-5W30', 'FluidMind 5W-30 Engine Oil', 'finished',
   '66666666-6666-6666-6666-666666666601', 'development',
   '{"viscosity_grade": "5W-30", "api": "SP", "sulfated_ash_pct_max": 1.0}'::jsonb,
   'Passenger car gasoline engines', ARRAY['engine_oil','5W-30','passenger_car']),

  ('77777777-7777-7777-7777-777777777702', 'PROD-HYD-46',  'FluidMind Hydraulic ISO 46',  'finished',
   '66666666-6666-6666-6666-666666666603', 'development',
   '{"viscosity_grade": "ISO VG 46", "iso_cleanliness": "20/18/15"}'::jsonb,
   'Industrial hydraulic systems', ARRAY['hydraulic','iso_46','industrial'])
ON CONFLICT (id) DO NOTHING;

-- ---------------------------------------------------------------------------
-- Product specifications (normalized targets)
-- ---------------------------------------------------------------------------
INSERT INTO product_specifications (product_id, spec_code, spec_name, test_method, unit_of_measure, target_value, min_value, max_value, is_critical, display_order) VALUES
  ('77777777-7777-7777-7777-777777777701', 'KV_100C',    'Kinematic Viscosity @ 100°C', 'ASTM D445', 'cSt',  10.5, 9.3, 12.5, TRUE, 1),
  ('77777777-7777-7777-7777-777777777701', 'VI',         'Viscosity Index',             'ASTM D2270', NULL,  165, 150, NULL, TRUE, 2),
  ('77777777-7777-7777-7777-777777777701', 'TBN',        'Total Base Number',           'ASTM D2896', 'mg KOH/g', 8.5, 7.5, 10.0, TRUE, 3),
  ('77777777-7777-7777-7777-777777777702', 'KV_40C',     'Kinematic Viscosity @ 40°C',  'ASTM D445', 'cSt',  46.0, 41.4, 50.6, TRUE, 1),
  ('77777777-7777-7777-7777-777777777702', 'VI',         'Viscosity Index',             'ASTM D2270', NULL,  100, 95, NULL, FALSE, 2)
ON CONFLICT (product_id, spec_code) DO NOTHING;
