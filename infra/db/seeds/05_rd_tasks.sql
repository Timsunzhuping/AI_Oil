-- =============================================================================
-- 05_rd_tasks.sql
-- Sample R&D project + tasks tied to the engine-oil formula work.
-- =============================================================================

INSERT INTO r_and_d_projects (
  id, code, name, description, status, priority,
  start_date, due_date, owner_id, related_product_ids, tags
) VALUES (
  'cccccccc-cccc-cccc-cccc-cccccccccc01',
  'RND-2026-EO-PROGRAM',
  '2026 Engine Oil Optimization Program',
  'Reformulate the 5W-30 family for improved fuel economy and longer drain intervals.',
  'active', 'high',
  '2026-01-15', '2026-12-31',
  '22222222-2222-2222-2222-222222222203',
  ARRAY['77777777-7777-7777-7777-777777777701']::UUID[],
  ARRAY['engine_oil','optimization','2026']
) ON CONFLICT (id) DO NOTHING;

INSERT INTO r_and_d_tasks (
  id, code, project_id, title, task_type, status, priority,
  assigned_to, reporter_id, due_date, started_at,
  estimated_hours, progress_percentage,
  related_formula_id, related_formula_version_id, tags
) VALUES
  ('dddddddd-dddd-dddd-dddd-dddddddddd01', 'RND-2026-0001',
   'cccccccc-cccc-cccc-cccc-cccccccccc01',
   'Baseline characterization of FORM-EO-5W30-A v1.0.0',
   'analysis', 'done', 'high',
   '22222222-2222-2222-2222-222222222203', '22222222-2222-2222-2222-222222222204',
   '2026-02-15', NOW() - INTERVAL '14 days',
   16, 100,
   '88888888-8888-8888-8888-888888888801', '99999999-9999-9999-9999-999999999901',
   ARRAY['baseline','characterization']),

  ('dddddddd-dddd-dddd-dddd-dddddddddd02', 'RND-2026-0002',
   'cccccccc-cccc-cccc-cccc-cccccccccc01',
   'Increase PAO ratio and re-test',
   'experiment', 'done', 'high',
   '22222222-2222-2222-2222-222222222203', '22222222-2222-2222-2222-222222222204',
   '2026-04-10', NOW() - INTERVAL '10 days',
   24, 100,
   '88888888-8888-8888-8888-888888888801', '99999999-9999-9999-9999-999999999902',
   ARRAY['pao','formulation']),

  ('dddddddd-dddd-dddd-dddd-dddddddddd03', 'RND-2026-0003',
   'cccccccc-cccc-cccc-cccc-cccccccccc01',
   'Long-duration stability study',
   'experiment', 'in_progress', 'medium',
   '22222222-2222-2222-2222-222222222203', '22222222-2222-2222-2222-222222222204',
   '2026-08-30', NOW() - INTERVAL '2 days',
   80, 25,
   '88888888-8888-8888-8888-888888888801', '99999999-9999-9999-9999-999999999902',
   ARRAY['stability','long_term'])
ON CONFLICT (id) DO NOTHING;

INSERT INTO r_and_d_task_comments (task_id, author_id, body) VALUES
  ('dddddddd-dddd-dddd-dddd-dddddddddd02',
   '22222222-2222-2222-2222-222222222204',
   'Approved for batch trial. Note: keep ZDDP within ±0.05% of target.'),
  ('dddddddd-dddd-dddd-dddd-dddddddddd02',
   '22222222-2222-2222-2222-222222222203',
   'Batch run complete. KV100 = 10.4 cSt, VI = 167. Submitting for review.');

-- Link the experiment we created in 04 to its task (now possible since experiments.task_id FK exists)
UPDATE experiments
   SET task_id = 'dddddddd-dddd-dddd-dddd-dddddddddd02'
 WHERE id = 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbb01';
