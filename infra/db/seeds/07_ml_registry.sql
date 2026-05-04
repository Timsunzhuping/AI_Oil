-- =============================================================================
-- 07_ml_registry.sql
-- Sample ML datasets, model, version, and training job.
-- =============================================================================

INSERT INTO ml_datasets (
  id, code, name, description, dataset_version, storage_url, format,
  size_bytes, row_count, tags
) VALUES (
  'a1a1a1a1-a1a1-a1a1-a1a1-a1a1a1a1a1a1',
  'DS-LUB-PROPS-2026-Q1',
  'Lubricant property predictions training set',
  'Historical formula → measured property pairs from 2018–2025 R&D logs.',
  '2026.1', 's3://fluidmind-ml/datasets/lub-props/2026q1.parquet', 'parquet',
  1024 * 1024 * 250, 47823,
  ARRAY['lubricants','training','property_prediction']
) ON CONFLICT (id) DO NOTHING;

INSERT INTO ml_model_registry (
  id, code, name, description, task_type, framework, algorithm, use_case,
  status, owner_id, tags
) VALUES (
  'b1b1b1b1-b1b1-b1b1-b1b1-b1b1b1b1b1b1',
  'MODEL-VISCOSITY-PREDICT',
  'Viscosity Predictor',
  'Predicts KV @ 100°C from formula composition.',
  'regression', 'pytorch', 'gradient_boosted_trees', 'property_prediction',
  'staged', '22222222-2222-2222-2222-222222222203',
  ARRAY['regression','viscosity','property_prediction']
) ON CONFLICT (id) DO NOTHING;

INSERT INTO ml_training_jobs (
  id, code, model_id, trigger_type, triggered_by, dataset_id,
  config, status, progress_percentage,
  queued_at, started_at, completed_at, duration_seconds,
  compute_provider, gpu_count, gpu_type, memory_peak_mb,
  metrics
) VALUES (
  'c1c1c1c1-c1c1-c1c1-c1c1-c1c1c1c1c1c1',
  'job-2026-04-15-viscosity-001',
  'b1b1b1b1-b1b1-b1b1-b1b1-b1b1b1b1b1b1',
  'manual', '22222222-2222-2222-2222-222222222203',
  'a1a1a1a1-a1a1-a1a1-a1a1-a1a1a1a1a1a1',
  '{"epochs": 50, "batch_size": 256, "learning_rate": 0.001, "early_stopping_patience": 5}'::jsonb,
  'succeeded', 100,
  NOW() - INTERVAL '10 days',
  NOW() - INTERVAL '10 days' + INTERVAL '1 minutes',
  NOW() - INTERVAL '10 days' + INTERVAL '47 minutes',
  46 * 60,
  'k8s', 1, 'A100', 18432,
  '{"rmse": 0.42, "mae": 0.31, "r2": 0.94, "epochs_completed": 38}'::jsonb
) ON CONFLICT (id) DO NOTHING;

INSERT INTO ml_model_versions (
  id, model_id, version_number, version_label,
  artifact_url, artifact_hash, artifact_size_bytes, framework_version,
  training_job_id, training_dataset_id, hyperparameters,
  metrics, deployment_status, promoted_at, promoted_by, approved_at, approved_by, release_notes
) VALUES (
  'd1d1d1d1-d1d1-d1d1-d1d1-d1d1d1d1d1d1',
  'b1b1b1b1-b1b1-b1b1-b1b1-b1b1b1b1b1b1', 1, 'v1.0.0',
  's3://fluidmind-ml/models/viscosity-predict/v1.0.0/model.pt',
  '5d41402abc4b2a76b9719d911017c592', 1024 * 1024 * 12, 'pytorch==2.2.0',
  'c1c1c1c1-c1c1-c1c1-c1c1-c1c1c1c1c1c1',
  'a1a1a1a1-a1a1-a1a1-a1a1-a1a1a1a1a1a1',
  '{"epochs": 50, "batch_size": 256, "learning_rate": 0.001}'::jsonb,
  '{"rmse": 0.42, "mae": 0.31, "r2": 0.94}'::jsonb,
  'staged',
  NOW() - INTERVAL '7 days', '22222222-2222-2222-2222-222222222203',
  NOW() - INTERVAL '5 days', '22222222-2222-2222-2222-222222222202',
  'Initial release. Trained on Q1-2026 lubricant property dataset. Validation R² = 0.94.'
) ON CONFLICT (id) DO NOTHING;

UPDATE ml_model_registry
   SET current_version_id = 'd1d1d1d1-d1d1-d1d1-d1d1-d1d1d1d1d1d1',
       total_versions = 1
 WHERE id = 'b1b1b1b1-b1b1-b1b1-b1b1-b1b1b1b1b1b1';

UPDATE ml_training_jobs
   SET produced_version_id = 'd1d1d1d1-d1d1-d1d1-d1d1-d1d1d1d1d1d1'
 WHERE id = 'c1c1c1c1-c1c1-c1c1-c1c1-c1c1c1c1c1c1';
