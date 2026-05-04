import { describe, it, expect } from 'vitest';
import { HandlerRegistry } from '../../../src/modules/tasks/handlers/index.js';
import type { HandlerContext, InputRow, TaskRow } from '../../../src/modules/tasks/types.js';

const FIXED_TRACE = '00000000-0000-0000-0000-000000000abc';

function fakeTask(task_type: string): TaskRow {
  return {
    id: 't-1', code: 'AI-2026-0001', task_kind: 'ai_workflow',
    task_type, status: 'processing',
    title: 't', description: null, summary: null,
    input_mode: null, template_id: null, trace_id: FIXED_TRACE, handler_version: null,
    priority: 'medium', assigned_to: null, reporter_id: null,
    related_formula_id: null, related_formula_version_id: null,
    related_product_id: null, related_experiment_id: null,
    submitted_at: null, processing_started_at: null,
    completed_at: null, archived_at: null,
    error_class: null, error_message: null,
    tags: [], metadata: {},
    created_at: new Date(), updated_at: new Date(),
    created_by: null, updated_by: null,
    deleted_at: null, version: 1,
  };
}

function input(payload: Record<string, unknown>, raw_text?: string): InputRow {
  return {
    id: 'i-1', task_id: 't-1', input_type: 'structured',
    payload, raw_text: raw_text ?? null,
    attachment_url: null, attachment_mime: null, attachment_size: null,
    is_primary: true, metadata: {}, created_at: new Date(), created_by: null,
  };
}

function ctx(task_type: string, payload: Record<string, unknown>, raw_text?: string): HandlerContext {
  return { task: fakeTask(task_type), primaryInput: input(payload, raw_text), traceId: FIXED_TRACE };
}

describe('HandlerRegistry', () => {
  const reg = new HandlerRegistry();

  it.each([
    'forward_prediction','batch_prediction','cost_optimization',
    'material_replacement','new_product_generation','knowledge_qa',
  ] as const)('registers handler for %s', (t) => {
    const h = reg.resolve(t);
    expect(h.task_type).toBe(t);
  });

  it('list() reports every registered handler with version', () => {
    const list = reg.list();
    expect(list).toHaveLength(6);
    expect(list.every((x) => x.version === 'mock-v1')).toBe(true);
  });

  it('throws on unknown task_type', () => {
    expect(() => reg.resolve('unknown' as never)).toThrow();
  });
});

describe('handler.validateInput', () => {
  const reg = new HandlerRegistry();

  it('forward_prediction requires formula_version_id and target_metric', () => {
    const h = reg.resolve('forward_prediction');
    expect(h.validateInput({}, null).ok).toBe(false);
    expect(h.validateInput({ formula_version_id: 'x' }, null).ok).toBe(false);
    expect(h.validateInput({ formula_version_id: 'x', target_metric: 'KV_100C' }, null).ok).toBe(true);
  });

  it('knowledge_qa accepts question via payload OR raw_text', () => {
    const h = reg.resolve('knowledge_qa');
    expect(h.validateInput({ question: 'What is pH?' }, null).ok).toBe(true);
    expect(h.validateInput({}, 'What is pH?').ok).toBe(true);
    expect(h.validateInput({}, null).ok).toBe(false);
    expect(h.validateInput({}, 'a').ok).toBe(false); // too short
  });

  it('cost_optimization requires base_formula_version_id and cost_target', () => {
    const h = reg.resolve('cost_optimization');
    expect(h.validateInput({}, null).ok).toBe(false);
    expect(h.validateInput({ base_formula_version_id: 'fv' }, null).ok).toBe(false);
    expect(h.validateInput({ base_formula_version_id: 'fv', cost_target: 100 }, null).ok).toBe(true);
  });
});

describe('handler.execute (mock outputs)', () => {
  const reg = new HandlerRegistry();

  it('forward_prediction returns one prediction output', async () => {
    const r = await reg.resolve('forward_prediction').execute(
      ctx('forward_prediction', { formula_version_id: 'fv-1', target_metric: 'KV_100C' })
    );
    expect(r.success).toBe(true);
    expect(r.outputs).toHaveLength(1);
    expect(r.outputs[0].output_type).toBe('prediction');
    expect(r.outputs[0].is_primary).toBe(true);
    const p = r.outputs[0].payload as { point_estimate: number; ci_low: number; ci_high: number };
    expect(typeof p.point_estimate).toBe('number');
    expect(p.ci_low).toBeLessThan(p.point_estimate);
    expect(p.ci_high).toBeGreaterThan(p.point_estimate);
  });

  it('batch_prediction returns rows × target_metrics', async () => {
    const r = await reg.resolve('batch_prediction').execute(
      ctx('batch_prediction', {
        product_category_code: 'ENGINE_OILS',
        target_metrics: ['KV_100C','VI'],
      })
    );
    expect(r.success).toBe(true);
    const p = r.outputs[0].payload as { rows: Array<Record<string, unknown>> };
    expect(p.rows.length).toBeGreaterThan(0);
    expect(Object.keys(p.rows[0]!)).toEqual(expect.arrayContaining(['KV_100C','VI']));
  });

  it('material_replacement returns N candidates', async () => {
    const r = await reg.resolve('material_replacement').execute(
      ctx('material_replacement', {
        base_formula_version_id: 'fv-1', replace_raw_material_id: 'rm-1', max_candidates: 3,
      })
    );
    expect(r.success).toBe(true);
    const p = r.outputs[0].payload as { candidates: unknown[] };
    expect(p.candidates).toHaveLength(3);
  });

  it('knowledge_qa returns answer + citation outputs', async () => {
    const r = await reg.resolve('knowledge_qa').execute(
      ctx('knowledge_qa', { question: 'What is the recommended P limit?', max_sources: 3 })
    );
    expect(r.success).toBe(true);
    expect(r.outputs.map((o) => o.output_type)).toEqual(expect.arrayContaining(['report','citation']));
    const report = r.outputs.find((o) => o.output_type === 'report')!;
    const p = report.payload as { sources: unknown[] };
    expect(p.sources).toHaveLength(3);
  });

  it('handlers are deterministic for the same input', async () => {
    const h = new HandlerRegistry().resolve('forward_prediction');
    const r1 = await h.execute(ctx('forward_prediction', { formula_version_id: 'X', target_metric: 'Y' }));
    const r2 = await h.execute(ctx('forward_prediction', { formula_version_id: 'X', target_metric: 'Y' }));
    expect((r1.outputs[0].payload as { point_estimate: number }).point_estimate)
      .toBe((r2.outputs[0].payload as { point_estimate: number }).point_estimate);
  });
});
