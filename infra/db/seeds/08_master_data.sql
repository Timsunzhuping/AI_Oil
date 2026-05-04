-- =============================================================================
-- 08_master_data.sql
-- Standard units, common metrics, and alias mappings.
-- =============================================================================

-- ---------------------------------------------------------------------------
-- units (canonical dictionary)
-- ---------------------------------------------------------------------------
INSERT INTO units (id, code, name, symbol, dimension, base_unit_code, is_si, display_order) VALUES
  -- Mass
  ('e1000000-0000-0000-0000-000000000001', 'kg',     'Kilogram',   'kg',    'mass',         'kg', TRUE,  10),
  ('e1000000-0000-0000-0000-000000000002', 'g',      'Gram',       'g',     'mass',         'kg', TRUE,  11),
  ('e1000000-0000-0000-0000-000000000003', 'mg',     'Milligram',  'mg',    'mass',         'kg', TRUE,  12),
  ('e1000000-0000-0000-0000-000000000004', 't',      'Metric Ton', 't',     'mass',         'kg', TRUE,  13),
  ('e1000000-0000-0000-0000-000000000005', 'lb',     'Pound',      'lb',    'mass',         'kg', FALSE, 20),
  -- Volume
  ('e1000000-0000-0000-0000-000000000010', 'L',      'Liter',      'L',     'volume',       'm3', TRUE,  10),
  ('e1000000-0000-0000-0000-000000000011', 'mL',     'Milliliter', 'mL',    'volume',       'm3', TRUE,  11),
  ('e1000000-0000-0000-0000-000000000012', 'm3',     'Cubic Meter','m³',    'volume',       'm3', TRUE,  12),
  ('e1000000-0000-0000-0000-000000000013', 'gal',    'US Gallon',  'gal',   'volume',       'm3', FALSE, 20),
  -- Temperature
  ('e1000000-0000-0000-0000-000000000020', 'C',      'Celsius',    '°C',    'temperature',  'K',  FALSE, 10),
  ('e1000000-0000-0000-0000-000000000021', 'K',      'Kelvin',     'K',     'temperature',  'K',  TRUE,  11),
  ('e1000000-0000-0000-0000-000000000022', 'F',      'Fahrenheit', '°F',    'temperature',  'K',  FALSE, 12),
  -- Viscosity
  ('e1000000-0000-0000-0000-000000000030', 'cSt',    'Centistoke', 'cSt',   'viscosity',    'm2/s', FALSE, 10),
  ('e1000000-0000-0000-0000-000000000031', 'mm2_s',  'mm²/s',      'mm²/s', 'viscosity',    'm2/s', TRUE,  11),
  -- Pressure
  ('e1000000-0000-0000-0000-000000000040', 'Pa',     'Pascal',     'Pa',    'pressure',     'Pa', TRUE,  10),
  ('e1000000-0000-0000-0000-000000000041', 'kPa',    'Kilopascal', 'kPa',   'pressure',     'Pa', TRUE,  11),
  ('e1000000-0000-0000-0000-000000000042', 'bar',    'Bar',        'bar',   'pressure',     'Pa', FALSE, 12),
  ('e1000000-0000-0000-0000-000000000043', 'psi',    'PSI',        'psi',   'pressure',     'Pa', FALSE, 13),
  -- Concentration
  ('e1000000-0000-0000-0000-000000000050', 'pct',    'Percent',    '%',     'dimensionless', NULL, FALSE, 10),
  ('e1000000-0000-0000-0000-000000000051', 'ppm',    'PPM',        'ppm',   'dimensionless', NULL, FALSE, 11),
  ('e1000000-0000-0000-0000-000000000052', 'mg_kg',  'mg/kg',      'mg/kg', 'concentration', NULL, FALSE, 12),
  -- Quality
  ('e1000000-0000-0000-0000-000000000060', 'mgKOH_g','mg KOH/g',   'mg KOH/g','acid_base',  NULL, FALSE, 10),
  -- Dimensionless
  ('e1000000-0000-0000-0000-000000000070', 'unit',   'Unit',       '',      'dimensionless', NULL, FALSE, 99)
ON CONFLICT (code) DO NOTHING;

-- ---------------------------------------------------------------------------
-- unit_aliases
-- ---------------------------------------------------------------------------
INSERT INTO unit_aliases (unit_id, alias, alias_normalized, language, source) VALUES
  ('e1000000-0000-0000-0000-000000000001', 'Kilogram',     'kilogram',  'en', 'migration'),
  ('e1000000-0000-0000-0000-000000000001', 'kilograms',    'kilograms', 'en', 'migration'),
  ('e1000000-0000-0000-0000-000000000001', 'KG',           'kg',        'en', 'migration'),
  ('e1000000-0000-0000-0000-000000000001', '千克',          '千克',       'zh', 'migration'),
  ('e1000000-0000-0000-0000-000000000001', '公斤',          '公斤',       'zh', 'migration'),
  ('e1000000-0000-0000-0000-000000000002', 'gram',         'gram',      'en', 'migration'),
  ('e1000000-0000-0000-0000-000000000002', 'grams',        'grams',     'en', 'migration'),
  ('e1000000-0000-0000-0000-000000000010', 'liter',        'liter',     'en', 'migration'),
  ('e1000000-0000-0000-0000-000000000010', 'liters',       'liters',    'en', 'migration'),
  ('e1000000-0000-0000-0000-000000000010', 'litre',        'litre',     'en', 'migration'),
  ('e1000000-0000-0000-0000-000000000011', 'milliliter',   'milliliter','en', 'migration'),
  ('e1000000-0000-0000-0000-000000000011', 'ml',           'ml',        'en', 'migration'),
  ('e1000000-0000-0000-0000-000000000020', 'celsius',      'celsius',   'en', 'migration'),
  ('e1000000-0000-0000-0000-000000000020', 'degC',         'degc',      'en', 'migration'),
  ('e1000000-0000-0000-0000-000000000020', 'degree celsius','degree celsius','en','migration'),
  ('e1000000-0000-0000-0000-000000000022', 'fahrenheit',   'fahrenheit','en', 'migration'),
  ('e1000000-0000-0000-0000-000000000022', 'degF',         'degf',      'en', 'migration'),
  ('e1000000-0000-0000-0000-000000000030', 'centistoke',   'centistoke','en', 'migration'),
  ('e1000000-0000-0000-0000-000000000030', 'centistokes',  'centistokes','en','migration'),
  ('e1000000-0000-0000-0000-000000000030', 'mm^2/s',       'mm^2/s',    'en', 'migration'),
  ('e1000000-0000-0000-0000-000000000050', 'percent',      'percent',   'en', 'migration'),
  ('e1000000-0000-0000-0000-000000000050', '%',            '%',         'en', 'migration'),
  ('e1000000-0000-0000-0000-000000000051', 'parts per million','parts per million','en','migration')
ON CONFLICT (unit_id, alias_normalized) DO NOTHING;

-- ---------------------------------------------------------------------------
-- unit_conversions  (factor and offset chosen so target = source*factor + offset)
-- ---------------------------------------------------------------------------
INSERT INTO unit_conversions (from_unit_id, to_unit_id, factor, offset_value, formula) VALUES
  -- mass
  ('e1000000-0000-0000-0000-000000000001', 'e1000000-0000-0000-0000-000000000002', 1000,        0, 'g = kg * 1000'),
  ('e1000000-0000-0000-0000-000000000002', 'e1000000-0000-0000-0000-000000000001', 0.001,       0, 'kg = g / 1000'),
  ('e1000000-0000-0000-0000-000000000001', 'e1000000-0000-0000-0000-000000000003', 1000000,     0, 'mg = kg * 1e6'),
  ('e1000000-0000-0000-0000-000000000003', 'e1000000-0000-0000-0000-000000000001', 0.000001,    0, 'kg = mg / 1e6'),
  ('e1000000-0000-0000-0000-000000000001', 'e1000000-0000-0000-0000-000000000004', 0.001,       0, 't = kg / 1000'),
  ('e1000000-0000-0000-0000-000000000004', 'e1000000-0000-0000-0000-000000000001', 1000,        0, 'kg = t * 1000'),
  ('e1000000-0000-0000-0000-000000000001', 'e1000000-0000-0000-0000-000000000005', 2.20462262,  0, 'lb = kg * 2.20462'),
  ('e1000000-0000-0000-0000-000000000005', 'e1000000-0000-0000-0000-000000000001', 0.45359237,  0, 'kg = lb * 0.4536'),
  -- volume
  ('e1000000-0000-0000-0000-000000000010', 'e1000000-0000-0000-0000-000000000011', 1000,        0, 'mL = L * 1000'),
  ('e1000000-0000-0000-0000-000000000011', 'e1000000-0000-0000-0000-000000000010', 0.001,       0, 'L = mL / 1000'),
  ('e1000000-0000-0000-0000-000000000010', 'e1000000-0000-0000-0000-000000000012', 0.001,       0, 'm3 = L / 1000'),
  ('e1000000-0000-0000-0000-000000000012', 'e1000000-0000-0000-0000-000000000010', 1000,        0, 'L = m3 * 1000'),
  -- temperature (linear with offset)
  ('e1000000-0000-0000-0000-000000000020', 'e1000000-0000-0000-0000-000000000021', 1,         273.15, 'K = C + 273.15'),
  ('e1000000-0000-0000-0000-000000000021', 'e1000000-0000-0000-0000-000000000020', 1,        -273.15, 'C = K - 273.15'),
  ('e1000000-0000-0000-0000-000000000020', 'e1000000-0000-0000-0000-000000000022', 1.8,        32,    'F = C * 9/5 + 32'),
  ('e1000000-0000-0000-0000-000000000022', 'e1000000-0000-0000-0000-000000000020', 0.5555556, -17.7777778, 'C = (F - 32) * 5/9'),
  -- viscosity (1 cSt = 1 mm²/s)
  ('e1000000-0000-0000-0000-000000000030', 'e1000000-0000-0000-0000-000000000031', 1,           0, 'mm2/s = cSt'),
  ('e1000000-0000-0000-0000-000000000031', 'e1000000-0000-0000-0000-000000000030', 1,           0, 'cSt = mm2/s'),
  -- pressure
  ('e1000000-0000-0000-0000-000000000040', 'e1000000-0000-0000-0000-000000000041', 0.001,       0, 'kPa = Pa / 1000'),
  ('e1000000-0000-0000-0000-000000000041', 'e1000000-0000-0000-0000-000000000040', 1000,        0, 'Pa = kPa * 1000'),
  ('e1000000-0000-0000-0000-000000000041', 'e1000000-0000-0000-0000-000000000042', 0.01,        0, 'bar = kPa / 100'),
  ('e1000000-0000-0000-0000-000000000042', 'e1000000-0000-0000-0000-000000000041', 100,         0, 'kPa = bar * 100'),
  ('e1000000-0000-0000-0000-000000000042', 'e1000000-0000-0000-0000-000000000043', 14.5037738,  0, 'psi = bar * 14.5'),
  ('e1000000-0000-0000-0000-000000000043', 'e1000000-0000-0000-0000-000000000042', 0.06894757,  0, 'bar = psi * 0.0689'),
  -- concentration
  ('e1000000-0000-0000-0000-000000000050', 'e1000000-0000-0000-0000-000000000051', 10000,       0, 'ppm = % * 10000'),
  ('e1000000-0000-0000-0000-000000000051', 'e1000000-0000-0000-0000-000000000050', 0.0001,      0, '% = ppm / 10000')
ON CONFLICT (from_unit_id, to_unit_id) DO NOTHING;

-- ---------------------------------------------------------------------------
-- metrics dictionary
-- ---------------------------------------------------------------------------
INSERT INTO metrics (id, code, name_std, name_short, category, data_type, default_unit_id, expected_min, expected_max, test_method, description, precision_decimals) VALUES
  ('e2000000-0000-0000-0000-000000000001', 'PH',          'pH',                            'pH',     'chemical',   'numeric',
    NULL, 0, 14, 'IEC 60746',
    'Acidity / alkalinity', 2),
  ('e2000000-0000-0000-0000-000000000002', 'KV_40C',      'Kinematic Viscosity @ 40°C',    'KV40',   'rheological','numeric',
    'e1000000-0000-0000-0000-000000000030', 0, 1000, 'ASTM D445',
    'Kinematic viscosity at 40°C', 2),
  ('e2000000-0000-0000-0000-000000000003', 'KV_100C',     'Kinematic Viscosity @ 100°C',   'KV100',  'rheological','numeric',
    'e1000000-0000-0000-0000-000000000030', 0, 100, 'ASTM D445',
    'Kinematic viscosity at 100°C', 2),
  ('e2000000-0000-0000-0000-000000000004', 'VI',          'Viscosity Index',               'VI',     'rheological','numeric',
    NULL, 0, 400, 'ASTM D2270',
    'Viscosity Index', 0),
  ('e2000000-0000-0000-0000-000000000005', 'TBN',         'Total Base Number',             'TBN',    'chemical',   'numeric',
    'e1000000-0000-0000-0000-000000000060', 0, 200, 'ASTM D2896',
    'Total Base Number', 2),
  ('e2000000-0000-0000-0000-000000000006', 'TAN',         'Total Acid Number',             'TAN',    'chemical',   'numeric',
    'e1000000-0000-0000-0000-000000000060', 0, 200, 'ASTM D664',
    'Total Acid Number', 2),
  ('e2000000-0000-0000-0000-000000000007', 'FLASH_POINT', 'Flash Point',                   'FP',     'physical',   'numeric',
    'e1000000-0000-0000-0000-000000000020', -50, 500, 'ASTM D92',
    'Flash point (open cup)', 0),
  ('e2000000-0000-0000-0000-000000000008', 'POUR_POINT',  'Pour Point',                    'PP',     'physical',   'numeric',
    'e1000000-0000-0000-0000-000000000020', -100, 100, 'ASTM D97',
    'Pour point', 0),
  ('e2000000-0000-0000-0000-000000000009', 'NOACK',       'Noack Volatility',              'NOACK',  'physical',   'numeric',
    'e1000000-0000-0000-0000-000000000050', 0, 100, 'ASTM D5800',
    'Noack volatility (mass loss after 1h at 250°C)', 2),
  ('e2000000-0000-0000-0000-000000000010', 'DENSITY',     'Density',                       'rho',    'physical',   'numeric',
    NULL, 0, 5, 'ASTM D4052',
    'Density at 15°C (or specified)', 4),
  ('e2000000-0000-0000-0000-000000000011', 'COLOR_ASTM',  'Color (ASTM)',                  'Color',  'optical',    'numeric',
    NULL, 0, 8, 'ASTM D1500',
    'ASTM color scale', 1),
  ('e2000000-0000-0000-0000-000000000012', 'WATER_KF',    'Water Content (Karl Fischer)',  'H2O',    'chemical',   'numeric',
    'e1000000-0000-0000-0000-000000000051', 0, 100000, 'ASTM E203',
    'Water content via Karl Fischer titration', 0)
ON CONFLICT (code) DO NOTHING;

-- ---------------------------------------------------------------------------
-- metric_aliases
-- ---------------------------------------------------------------------------
INSERT INTO metric_aliases (metric_id, alias, alias_normalized, language, source) VALUES
  ('e2000000-0000-0000-0000-000000000001', 'pH value',                  'ph value',                 'en', 'migration'),
  ('e2000000-0000-0000-0000-000000000001', 'PH',                        'ph',                       'en', 'migration'),
  ('e2000000-0000-0000-0000-000000000001', 'p.H.',                      'p.h.',                     'en', 'migration'),
  ('e2000000-0000-0000-0000-000000000001', '酸碱度',                     '酸碱度',                    'zh', 'migration'),
  ('e2000000-0000-0000-0000-000000000002', 'KV40',                      'kv40',                     'en', 'migration'),
  ('e2000000-0000-0000-0000-000000000002', 'Viscosity at 40C',          'viscosity at 40c',         'en', 'migration'),
  ('e2000000-0000-0000-0000-000000000002', '40度运动粘度',                '40度运动粘度',              'zh', 'migration'),
  ('e2000000-0000-0000-0000-000000000003', 'KV100',                     'kv100',                    'en', 'migration'),
  ('e2000000-0000-0000-0000-000000000003', 'Viscosity at 100C',         'viscosity at 100c',        'en', 'migration'),
  ('e2000000-0000-0000-0000-000000000003', '100度运动粘度',               '100度运动粘度',             'zh', 'migration'),
  ('e2000000-0000-0000-0000-000000000004', 'Viscosity Index',           'viscosity index',          'en', 'migration'),
  ('e2000000-0000-0000-0000-000000000004', '粘度指数',                   '粘度指数',                  'zh', 'migration'),
  ('e2000000-0000-0000-0000-000000000005', 'Base Number',               'base number',              'en', 'migration'),
  ('e2000000-0000-0000-0000-000000000005', '总碱值',                     '总碱值',                    'zh', 'migration'),
  ('e2000000-0000-0000-0000-000000000007', 'FP',                        'fp',                       'en', 'migration'),
  ('e2000000-0000-0000-0000-000000000007', 'Flash Pt',                  'flash pt',                 'en', 'migration'),
  ('e2000000-0000-0000-0000-000000000007', '闪点',                       '闪点',                      'zh', 'migration')
ON CONFLICT (metric_id, alias_normalized) DO NOTHING;

-- ---------------------------------------------------------------------------
-- raw_material_aliases — sample mappings for the seeded materials
-- (raw materials seeded in 02_materials_and_products.sql)
-- ---------------------------------------------------------------------------
INSERT INTO raw_material_aliases (raw_material_id, alias, alias_normalized, alias_type, language, source) VALUES
  ('55555555-5555-5555-5555-555555555501', 'Mineral Oil 150N', 'mineral oil 150n', 'name',         'en', 'migration'),
  ('55555555-5555-5555-5555-555555555501', '150 Neutral',       '150 neutral',      'synonym',      'en', 'migration'),
  ('55555555-5555-5555-5555-555555555501', 'PB-150N',           'pb-150n',          'supplier_sku', 'en', 'migration'),
  ('55555555-5555-5555-5555-555555555501', '矿物油 150N',         '矿物油 150n',       'name',         'zh', 'migration'),
  ('55555555-5555-5555-5555-555555555502', 'PAO 6',             'pao 6',            'name',         'en', 'migration'),
  ('55555555-5555-5555-5555-555555555502', 'PAO-6',             'pao-6',            'abbreviation', 'en', 'migration'),
  ('55555555-5555-5555-5555-555555555502', 'PolyAlphaOlefin 6', 'polyalphaolefin 6','name',         'en', 'migration'),
  ('55555555-5555-5555-5555-555555555503', 'ZDDP',              'zddp',             'abbreviation', 'en', 'migration'),
  ('55555555-5555-5555-5555-555555555503', 'Zinc Dialkyldithiophosphate', 'zinc dialkyldithiophosphate', 'name', 'en', 'migration'),
  ('55555555-5555-5555-5555-555555555504', 'BHT',               'bht',              'abbreviation', 'en', 'migration'),
  ('55555555-5555-5555-5555-555555555504', '2,6-Di-tert-butyl-4-methylphenol', '2,6-di-tert-butyl-4-methylphenol', 'name', 'en', 'migration'),
  ('55555555-5555-5555-5555-555555555505', 'OCP',               'ocp',              'abbreviation', 'en', 'migration'),
  ('55555555-5555-5555-5555-555555555505', 'Olefin Copolymer',  'olefin copolymer', 'name',         'en', 'migration')
ON CONFLICT (raw_material_id, alias_normalized) DO NOTHING;
