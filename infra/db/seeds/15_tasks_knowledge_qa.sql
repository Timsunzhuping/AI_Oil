-- =============================================================================
-- 15_tasks_knowledge_qa.sql
-- Seed R&D tasks, knowledge articles, QA documents to demonstrate
-- collaboration workflows and knowledge discovery.
-- =============================================================================

-- ---------------------------------------------------------------------------
-- R&D Tasks / Task Templates
-- ---------------------------------------------------------------------------
INSERT INTO task_templates (
  id, code, name, description, category, required_fields, workflow_state_machine,
  priority_default, estimated_duration_days, created_by, trace_id
) VALUES
  (
    '88888888-8888-8888-8888-888888888801',
    'tmpl-formula-dev',
    'Formula Development Task',
    'Standard template for developing and testing new formulations.',
    'R&D',
    '["target_product_category", "target_properties", "budget_limit"]'::jsonb,
    '{"draft": ["submitted"], "submitted": ["approved", "rejected"], "approved": ["in_progress"], "in_progress": ["testing", "paused"], "testing": ["completed", "failed"], "completed": ["archived"], "failed": ["draft"]}'::jsonb,
    'medium',
    7,
    '11111111-1111-1111-1111-111111111101',
    'seed-2026-05-07'
  ),
  (
    '88888888-8888-8888-8888-888888888802',
    'tmpl-bench-testing',
    'Bench Testing Task',
    'Validate formulation against target specifications in lab.',
    'QA',
    '["test_type", "sample_size", "test_duration_hours"]'::jsonb,
    '{"open": ["assigned", "declined"], "assigned": ["in_progress"], "in_progress": ["completed", "paused"], "paused": ["in_progress", "cancelled"], "completed": ["documented"], "documented": ["closed"]}'::jsonb,
    'high',
    3,
    '11111111-1111-1111-1111-111111111101',
    'seed-2026-05-07'
  ),
  (
    '88888888-8888-8888-8888-888888888803',
    'tmpl-knowledge-audit',
    'Knowledge Document Audit',
    'Review and audit existing knowledge for accuracy and currency.',
    'Documentation',
    '["document_id", "audit_scope"]'::jsonb,
    '{"pending": ["in_progress"], "in_progress": ["review", "paused"], "review": ["approved", "needs_revision"], "needs_revision": ["in_progress"], "approved": ["archived"]}'::jsonb,
    'low',
    2,
    '11111111-1111-1111-1111-111111111101',
    'seed-2026-05-07'
  )
ON CONFLICT DO NOTHING;

-- Insert task instances
INSERT INTO tasks (
  id, code, template_id, assigned_to, title, description, category, priority,
  status, due_date, completion_notes, metadata, created_by, trace_id
) VALUES
  (
    '99999999-9999-9999-9999-999999999901',
    'TASK-2026-001',
    '88888888-8888-8888-8888-888888888801',
    '11111111-1111-1111-1111-111111111102',
    'Develop 5W-30 PCMO Variant for OEM X',
    'Create a cost-optimized 5W-30 PCMO variant meeting OEM X specs: KV_100C=11.5±0.3cSt, VI≥160, budget ≤$35/L.',
    'R&D',
    'high',
    'in_progress',
    NOW() + INTERVAL '5 days',
    null,
    '{"target_oem": "OEM_X", "spec_version": "2026-Q2", "estimated_batch_volume": 10000}'::jsonb,
    '11111111-1111-1111-1111-111111111101',
    'seed-2026-05-07'
  ),
  (
    '99999999-9999-9999-9999-999999999902',
    'TASK-2026-002',
    '88888888-8888-8888-8888-888888888802',
    '11111111-1111-1111-1111-111111111104',
    'Bench Test: Draft Formula A',
    'Run viscosity + oxidation stability tests on TASK-2026-001 draft formula.',
    'QA',
    'high',
    'assigned',
    NOW() + INTERVAL '3 days',
    null,
    '{"parent_task": "TASK-2026-001", "test_standard": "ASTM_D6304", "duration_hours": 48}'::jsonb,
    '11111111-1111-1111-1111-111111111102',
    'seed-2026-05-07'
  ),
  (
    '99999999-9999-9999-9999-999999999903',
    'TASK-2026-003',
    '88888888-8888-8888-8888-888888888801',
    '11111111-1111-1111-1111-111111111102',
    'Gear Oil ISO VG 220 for Automotive Gearbox',
    'Formulate and validate ISO VG 220 industrial gear oil meeting GL-5 requirements.',
    'R&D',
    'medium',
    'draft',
    NOW() + INTERVAL '10 days',
    null,
    '{"application": "automotive_gearbox", "spec": "GL-5", "team_lead": "scientist-002"}'::jsonb,
    '11111111-1111-1111-1111-111111111101',
    'seed-2026-05-07'
  ),
  (
    '99999999-9999-9999-9999-999999999904',
    'TASK-2026-004',
    '88888888-8888-8888-8888-888888888803',
    '11111111-1111-1111-1111-111111111105',
    'Audit Knowledge Base: Viscosity Improvers',
    'Review all VIIs in knowledge base for accuracy and completeness.',
    'Documentation',
    'low',
    'pending',
    NOW() + INTERVAL '7 days',
    null,
    '{"category": "additives", "focus": "viscosity_improvers", "scope": "complete_review"}'::jsonb,
    '11111111-1111-1111-1111-111111111101',
    'seed-2026-05-07'
  )
ON CONFLICT DO NOTHING;

-- ---------------------------------------------------------------------------
-- Knowledge Documents (from Knowledge Base module)
-- ---------------------------------------------------------------------------
INSERT INTO knowledge_documents (
  id, code, title, content, category, tags, author_id, status,
  versions_count, last_reviewed_at, created_at, updated_at, trace_id
) VALUES
  (
    'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa01',
    'KA-2026-0001',
    'PAO Base Oils: Properties & Selection',
    '# PAO Base Oils Overview

## Chemical Structure
Polyalphaolefins (PAOs) are synthetic hydrocarbons with excellent thermal stability and wide viscosity range (ISO VG 2 to VG 1000).

## Key Properties
- **Thermal Stability**: NOACK loss < 8% (typical), excellent at elevated temps
- **Oxidation Resistance**: Group II equivalent or better
- **Pour Point**: Highly negative (-30 to -60°C depending on grade)
- **Solubility**: Good solvent for most additives

## Common Grades for Lubrication
- **PAO-2**: ~2 cSt @ 100°C, light applications
- **PAO-4**: ~4 cSt @ 100°C, hydraulics
- **PAO-6**: ~6 cSt @ 100°C, PCMO base
- **PAO-8**: ~8 cSt @ 100°C, heavier motor oils
- **PAO-32**: ~32 cSt @ 100°C, industrial gears

## Selection Guidance
Choose PAO grade based on target KV@100C:
- Target KV=11 cSt: Use PAO-6 as primary base (50-60% of formulation)
- Target KV=15 cSt: Blend PAO-6 + PAO-8 (1:1 ratio)
- Target KV=30+ cSt: Use PAO-32 or higher with viscosity modifiers

## Cost & Availability
- PAO-6: ~$18-22/L (commodity)
- PAO-8: ~$19-24/L
- PAO-32: ~$25-32/L
- Supply: Multiple suppliers, 2-4 week lead time typical'::text,
    'base_oils',
    ARRAY['pao', 'synthetic', 'base_oil', 'properties'],
    '11111111-1111-1111-1111-111111111102',
    'published',
    3,
    NOW() - INTERVAL '5 days',
    NOW() - INTERVAL '30 days',
    NOW() - INTERVAL '5 days',
    'seed-2026-05-07'
  ),
  (
    'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa02',
    'KA-2026-0002',
    'Viscosity Index Improvers (VII): Function & Effects',
    '# Viscosity Index Improvers

## Function
VIIs are polymeric additives that reduce viscosity change across temperature range. They swell when hot (increase viscosity) and contract when cold (reduce viscosity loss).

## Chemical Classes
- **Olefin Copolymers (OCP)**: Most common, good shear stability, cost-effective
- **Polymethacrylates (PMA)**: Higher VI than OCP, better low-temp fluidity
- **Star Polymers**: Excellent shear stability, premium cost

## Typical Dosing
- 5-15% by mass for passenger car motor oils
- 8-12% for multi-grade performance (e.g., 5W-30)
- Higher dosing = higher VI but worse shear stability over time

## Effects on Properties
| Property | Effect |
|----------|--------|
| VI | +50 to +150 points per 10% VII |
| KV@40C | Slight increase |
| KV@100C | Slight increase |
| Pour Point | May worsen slightly |
| Shear Stability | Depends on polymer structure |
| Cost | +3-8% per 10% VII |

## Supplier Selection
Key vendors: Shell Chemicals (Kraton), Chevron (Duradyne), Dow, Infineum.
Typical lead time: 4-6 weeks for specialty grades.'::text,
    'additives',
    ARRAY['vii', 'viscosity_modifier', 'polymeric_additive'],
    '11111111-1111-1111-1111-111111111102',
    'published',
    2,
    NOW() - INTERVAL '2 days',
    NOW() - INTERVAL '20 days',
    NOW() - INTERVAL '2 days',
    'seed-2026-05-07'
  ),
  (
    'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa03',
    'KA-2026-0003',
    'Detergent-Dispersant Package Selection Guide',
    '# Detergent-Dispersant (DD) Packages

## Overview
DD packages serve dual roles:
1. **Detergent**: Keep metal surfaces clean by suspending oxidation deposits
2. **Dispersant**: Keep soot + oxidation particles suspended in bulk oil

## Package Types
- **Ashless DDs**: No metallic elements, better for engines with three-way catalysts
- **Metallic DDs**: Over-based with Ca or Mg, higher TBN for acid neutralization

## Common Suppliers & Products
- **Afton (Package A)**: Cost-optimized, TBN 9-10
- **Infineum (Package B)**: Performance-oriented, TBN 10-11
- **Chevron (Package C)**: Economical, TBN 8-9
- **Lubrizol**: Premium grades, TBN 11-12

## Dosing Levels
- Light-duty PCMO: 10-15% package
- Heavy-duty diesel: 15-25% package
- Higher dosing = higher TBN, better soot handling, higher cost

## Selection Criteria
1. **Target TBN**: Determine from engine drain interval expectations
2. **Soot Handling**: Heavy-duty = higher dose, better dispersancy
3. **Cost Target**: Premium packages add 5-15% to formulation cost
4. **Compatibility**: Verify with base oils + other additives in package'::text,
    'additives',
    'additives',
    ARRAY['package', 'detergent', 'dispersant', 'tbn'],
    '11111111-1111-1111-1111-111111111102',
    'published',
    1,
    NOW() - INTERVAL '10 days',
    NOW() - INTERVAL '15 days',
    NOW() - INTERVAL '10 days',
    'seed-2026-05-07'
  )
ON CONFLICT DO NOTHING;

-- ---------------------------------------------------------------------------
-- QA / Knowledge QA (from QA module for document discovery)
-- ---------------------------------------------------------------------------
INSERT INTO qa_documents (
  id, knowledge_id, question, answer, confidence_score, source_references,
  created_by, trace_id
) VALUES
  (
    'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb01',
    'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa01',
    'Why should I use PAO-6 as the primary base oil for 5W-30 PCMO?',
    'PAO-6 provides approximately 6 cSt @ 100°C, which is near the target for 5W-30 (typically 9.3-12.5 cSt @ 100°C). Using PAO-6 at 50-60% concentration gives you predictable viscosity behavior; then you blend lighter bases (PAO-4 or Group III) and viscosity modifiers (VII) to achieve your exact target. PAO-6 also offers excellent thermal stability and good solubility for additives.',
    0.94,
    '["KA-2026-0001", "formulation_handbook_2024"]'::jsonb,
    '11111111-1111-1111-1111-111111111102',
    'seed-2026-05-07'
  ),
  (
    'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb02',
    'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa02',
    'How much VI improvement can I expect from adding a VII?',
    'Olefin copolymer (OCP) VIIs typically add 50-100 VI points per 10% dosage. Polymethacrylates add 60-120 VI points per 10%. So for a base oil with VI ~95, adding 10% OCP would give you VI ~155-195. However, higher VII dosages can worsen low-temperature fluidity (higher pour point) and reduce shear stability over engine life. Optimal dosing for PCMO is typically 8-12%.',
    0.91,
    '["KA-2026-0002", "ASTM_D6304"]'::jsonb,
    '11111111-1111-1111-1111-111111111102',
    'seed-2026-05-07'
  ),
  (
    'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb03',
    'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa03',
    'What TBN level should I target for a 5W-30 PCMO with 10,000 km drain interval?',
    'For a 10,000 km drain interval on modern gasoline engines, a TBN of 9-10 is typical. This provides adequate acid neutralization for ~1 year of normal driving. If the oil is exposed to high-sulfur fuel or severe driving, increase to TBN 10-11. If drain interval is extended to 15,000 km, increase TBN to 10-12. Base your choice on detergent-dispersant package: Package A (TBN 9), Package B (TBN 10-11), or Package C (TBN 8-9).',
    0.88,
    '["KA-2026-0003", "OEM_X_spec_2026"]'::jsonb,
    '11111111-1111-1111-1111-111111111102',
    'seed-2026-05-07'
  )
ON CONFLICT DO NOTHING;
