import { describe, it, expect } from 'vitest';
import { MockSapAdapter } from '../../../src/modules/erp/adapters/sap/index.js';
import { MockLimsAdapter } from '../../../src/modules/erp/adapters/lims/index.js';
import { MockCarbonAdapter } from '../../../src/modules/erp/adapters/carbon/index.js';

const TRACE = 'trace-1';

describe('MockSapAdapter', () => {
  it('reports a stable identity', () => {
    const i = new MockSapAdapter().identity();
    expect(i.name).toBe('mock-sap');
    expect(i.mode).toBe('mock');
  });

  it('returns BOM rows in full mode', async () => {
    const a = new MockSapAdapter();
    const r = await a.syncBom({ mode: 'full', cursor: null, trace_id: TRACE });
    expect(r.records.length).toBeGreaterThan(0);
    expect(r.next_cursor).not.toBeNull();
  });

  it('honours cursor in incremental mode', async () => {
    const a = new MockSapAdapter();
    const full = await a.syncBom({ mode: 'full', cursor: null, trace_id: TRACE });
    const since = full.records[0]!.external_updated_at as string;
    const inc = await a.syncBom({ mode: 'incremental', cursor: { since }, trace_id: TRACE });
    expect(inc.records.length).toBeLessThan(full.records.length);
    for (const r of inc.records) {
      expect(new Date(r.external_updated_at!).getTime()).toBeGreaterThan(new Date(since).getTime());
    }
  });

  it('caps results by limit', async () => {
    const a = new MockSapAdapter();
    const r = await a.syncCost({ mode: 'full', cursor: null, limit: 2, trace_id: TRACE });
    expect(r.records).toHaveLength(2);
  });

  it('throws on demand to exercise retry', async () => {
    const a = new MockSapAdapter({ failureCounter: { remaining: 1 } });
    await expect(
      a.syncInventory({ mode: 'full', cursor: null, trace_id: TRACE })
    ).rejects.toThrow();
    // Subsequent call succeeds.
    const r = await a.syncInventory({ mode: 'full', cursor: null, trace_id: TRACE });
    expect(r.records.length).toBeGreaterThan(0);
  });

  it('reports failed connection when configured', async () => {
    const a = new MockSapAdapter({ failConnection: true });
    const r = await a.testConnection();
    expect(r.ok).toBe(false);
  });
});

describe('MockLimsAdapter', () => {
  const adapter = () => new MockLimsAdapter();

  it('createTask returns an external id deterministic in the trace_id seed', async () => {
    const a1 = adapter();
    const a2 = adapter();
    const r1 = await a1.createTask(
      {
        test_method: 'KV_100C',
        related_formula_version_id: '00000000-0000-0000-0000-000000000001',
      },
      { trace_id: 'fixed-trace' }
    );
    const r2 = await a2.createTask(
      {
        test_method: 'KV_100C',
        related_formula_version_id: '00000000-0000-0000-0000-000000000001',
      },
      { trace_id: 'fixed-trace' }
    );
    expect(r1.external_lims_task_id).toBe(r2.external_lims_task_id);
    expect(r1.accepted).toBe(true);
  });

  it('pullResult progresses task: submitted → in_progress → completed', async () => {
    const a = adapter();
    const created = await a.createTask({ test_method: 'KV_100C' }, { trace_id: TRACE });
    const first = await a.pullResult(created.external_lims_task_id, { trace_id: TRACE });
    expect(first.status).toBe('in_progress');
    const second = await a.pullResult(created.external_lims_task_id, { trace_id: TRACE });
    expect(second.status).toBe('completed');
    expect(second.metrics?.length).toBeGreaterThan(0);
  });

  it('alwaysInProgress sticks a task in the in_progress state', async () => {
    const a = new MockLimsAdapter({ alwaysInProgress: true });
    const created = await a.createTask({ test_method: 'KV_100C' }, { trace_id: TRACE });
    const r1 = await a.pullResult(created.external_lims_task_id, { trace_id: TRACE });
    const r2 = await a.pullResult(created.external_lims_task_id, { trace_id: TRACE });
    expect(r1.status).toBe('in_progress');
    expect(r2.status).toBe('in_progress');
  });

  it('synthesises a result for unknown task ids', async () => {
    const a = adapter();
    const r = await a.pullResult('UNKNOWN-1', { trace_id: TRACE });
    expect(r.status).toBe('completed');
    expect(r.metrics?.length).toBeGreaterThan(0);
  });

  it('throws on demand for retry tests', async () => {
    const a = new MockLimsAdapter({ failureCounter: { remaining: 2 } });
    await expect(a.createTask({ test_method: 'KV_100C' }, { trace_id: TRACE })).rejects.toThrow();
    await expect(a.createTask({ test_method: 'KV_100C' }, { trace_id: TRACE })).rejects.toThrow();
    const ok = await a.createTask({ test_method: 'KV_100C' }, { trace_id: TRACE });
    expect(ok.accepted).toBe(true);
  });

  it('listTasks honours status filter', async () => {
    const a = adapter();
    const t = await a.createTask({ test_method: 'NOACK' }, { trace_id: TRACE });
    await a.pullResult(t.external_lims_task_id, { trace_id: TRACE }); // → in_progress
    const inProgress = await a.listTasks({ status: 'in_progress' }, { trace_id: TRACE });
    expect(inProgress).toHaveLength(1);
    const completed = await a.listTasks({ status: 'completed' }, { trace_id: TRACE });
    expect(completed).toHaveLength(0);
  });
});

describe('MockCarbonAdapter', () => {
  const a = new MockCarbonAdapter();

  it('returns known kgCO2e values for catalogued materials', async () => {
    const r = await a.lookupMaterial('RM-PAO-6', { trace_id: TRACE });
    expect(r?.kgCO2e_per_kg).toBe(1.85);
    expect(r?.source).toBe('mock-known');
  });

  it('synthesises deterministic values for unknown codes', async () => {
    const r1 = await a.lookupMaterial('UNKNOWN-X', { trace_id: TRACE });
    const r2 = await new MockCarbonAdapter().lookupMaterial('UNKNOWN-X', { trace_id: TRACE });
    expect(r1?.kgCO2e_per_kg).toBe(r2?.kgCO2e_per_kg);
    expect(r1?.source).toBe('mock-synthesised');
  });

  it('estimateFormula sums per-material contributions', async () => {
    const r = await a.estimateFormula(
      {
        bom: [
          { material_code: 'RM-PAO-6', ratio: 0.5 },
          { material_code: 'RM-GIII-4', ratio: 0.5 },
        ],
      },
      { trace_id: TRACE }
    );
    expect(r.kgCO2e_per_kg).toBeCloseTo(0.5 * 1.85 + 0.5 * 1.2, 3);
    expect(r.missing_materials).toEqual([]);
    expect(r.breakdown).toHaveLength(2);
  });

  it('flags missing materials when codes are not catalogued', async () => {
    const r = await a.estimateFormula(
      {
        bom: [
          { material_code: 'RM-PAO-6', ratio: 0.5 },
          { material_code: 'RM-UNKNOWN', ratio: 0.5 },
        ],
      },
      { trace_id: TRACE }
    );
    expect(r.missing_materials).toContain('RM-UNKNOWN');
    expect(r.source).toBe('mock-mixed');
  });

  it('throws on demand for retry tests', async () => {
    const a2 = new MockCarbonAdapter({ failureCounter: { remaining: 1 } });
    await expect(a2.lookupMaterial('RM-PAO-6', { trace_id: TRACE })).rejects.toThrow();
    const ok = await a2.lookupMaterial('RM-PAO-6', { trace_id: TRACE });
    expect(ok?.kgCO2e_per_kg).toBe(1.85);
  });
});
