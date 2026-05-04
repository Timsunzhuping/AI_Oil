-- =============================================================================
-- 09_integration.sql
-- Sample integration sources and schedules — wired to the mock adapters.
-- =============================================================================

INSERT INTO integration_sources (id, code, name, source_type, description, config, supported_entities, default_retry_max, is_active) VALUES
  ('f1000000-0000-0000-0000-000000000001', 'sap_prod',  'SAP Production',
   'sap',  'Mock SAP ERP connection — replace config + adapter to wire to real SAP RFC/OData.',
   '{"endpoint":"https://sap.example.local/sap/opu/odata","client":"100","language":"EN"}'::jsonb,
   ARRAY['raw_materials','suppliers'],
   3, TRUE),

  ('f1000000-0000-0000-0000-000000000002', 'lims_us',   'LIMS — US Lab',
   'lims', 'Mock LabWare LIMS connection.',
   '{"endpoint":"https://lims.example.local/api/v1","lab_code":"US-01"}'::jsonb,
   ARRAY['test_results','experiments'],
   3, TRUE),

  ('f1000000-0000-0000-0000-000000000003', 'minio_qa',  'MinIO — QA Reports Bucket',
   'file', 'Mock object-storage connection (S3 / MinIO compatible).',
   '{"endpoint":"http://minio.example.local:9000","bucket":"qa-reports","prefix":"reports/"}'::jsonb,
   ARRAY['documents'],
   2, TRUE)
ON CONFLICT (id) DO NOTHING;

-- Initial cursors (NULL = "no prior watermark; full sync from beginning")
INSERT INTO sync_snapshots (source_id, entity_type, cursor_value) VALUES
  ('f1000000-0000-0000-0000-000000000001', 'raw_materials', '{}'::jsonb),
  ('f1000000-0000-0000-0000-000000000001', 'suppliers',     '{}'::jsonb),
  ('f1000000-0000-0000-0000-000000000002', 'test_results',  '{}'::jsonb),
  ('f1000000-0000-0000-0000-000000000003', 'documents',     '{}'::jsonb)
ON CONFLICT (source_id, entity_type) DO NOTHING;

-- Schedules
INSERT INTO integration_schedules (id, source_id, entity_type, job_type, interval_minutes, is_active, next_run_at) VALUES
  ('f2000000-0000-0000-0000-000000000001', 'f1000000-0000-0000-0000-000000000001', 'raw_materials', 'incremental_sync',  30, TRUE, NOW()),
  ('f2000000-0000-0000-0000-000000000002', 'f1000000-0000-0000-0000-000000000002', 'test_results',  'incremental_sync',  15, TRUE, NOW()),
  ('f2000000-0000-0000-0000-000000000003', 'f1000000-0000-0000-0000-000000000003', 'documents',     'incremental_sync',  60, TRUE, NOW())
ON CONFLICT (source_id, entity_type, job_type) DO NOTHING;
