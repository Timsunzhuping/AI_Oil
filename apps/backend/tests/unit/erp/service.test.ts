import { describe, it, expect } from 'vitest';
import pino from 'pino';
import { ErpService } from '../../../src/modules/erp/service.js';
import { MockSapAdapter } from '../../../src/modules/erp/adapters/sap/index.js';
import { MockLimsAdapter } from '../../../src/modules/erp/adapters/lims/index.js';
import { MockCarbonAdapter } from '../../../src/modules/erp/adapters/carbon/index.js';
import type { ErpRepository } from '../../../src/modules/erp/repository.js';
import { FakeErpRepository } from './_fakes.js';

const TRACE = 'trace-1';
const logger = pino({ level: 'silent' });

interface BuildOpts {
  sapFailures?: number;
  limsFailures?: number;
  limsAlwaysInProgress?: boolean;
  carbonFailures?: number;
  failConnection?: boolean;
}

function buildService(opts: BuildOpts = {}) {
  const repo = new FakeErpRepository();
  const sap = new MockSapAdapter({
    ...(opts.sapFailures ? { failureCounter: { remaining: opts.sapFailures } } : {}),
    ...(opts.failConnection ? { failConnection: true } : {}),
  });
  const lims = new MockLimsAdapter({
    ...(opts.limsFailures ? { failureCounter: { remaining: opts.limsFailures } } : {}),
    alwaysInProgress: opts.limsAlwaysInProgress ?? false,
  });
  const carbon = new MockCarbonAdapter({
    ...(opts.carbonFailures ? { failureCounter: { remaining: opts.carbonFailures } } : {}),
  });
  const service = new ErpService({
    repository: repo as unknown as ErpRepository,
    sap,
    lims,
    carbon,
    logger,
    sleep: async () => {}, // no-op so tests never wait for backoff
  });
  return { repo, service };
}

// ─── SAP sync ──────────────────────────────────────────────────────────────

describe('ErpService.syncBom', () => {
  it('persists a succeeded job + records', async () => {
    const { repo, service } = buildService();
    const r = await service.syncBom({ mode: 'full' }, { trace_id: TRACE, user_id: 'u1' });
    expect(r.records.length).toBeGreaterThan(0);
    expect(r.cursor_to).not.toBeNull();
    expect(r.status).toBe('succeeded');
    expect(repo.jobs.size).toBe(1);
    const job = [...repo.jobs.values()][0]!;
    expect(job.status).toBe('succeeded');
    expect(job.operation).toBe('sap_bom_sync');
    expect(job.records_extracted).toBe(r.records.length);
  });

  it('retries transient failures and ultimately succeeds', async () => {
    const { repo, service } = buildService({ sapFailures: 2 });
    const r = await service.syncBom(
      { mode: 'full', max_attempts: 3 },
      { trace_id: TRACE, user_id: null }
    );
    expect(r.status).toBe('succeeded');
    const job = [...repo.jobs.values()][0]!;
    expect(job.attempt_number).toBeGreaterThanOrEqual(3);
    const logs = repo.logs.get(job.id) ?? [];
    expect(logs.some((l) => l.phase === 'retry')).toBe(true);
  });

  it('marks job failed when all retries are exhausted', async () => {
    const { repo, service } = buildService({ sapFailures: 5 });
    await expect(
      service.syncBom({ mode: 'full', max_attempts: 3 }, { trace_id: TRACE, user_id: null })
    ).rejects.toThrow();
    const job = [...repo.jobs.values()][0]!;
    expect(job.status).toBe('failed');
    expect(job.error_message).toMatch(/transient/);
  });

  it('records cursor_from + cursor_to on incremental runs', async () => {
    const { service } = buildService();
    const full = await service.syncBom({ mode: 'full' }, { trace_id: TRACE, user_id: null });
    const inc = await service.syncBom(
      { mode: 'incremental', cursor: full.cursor_to ?? undefined },
      { trace_id: TRACE, user_id: null }
    );
    expect(inc.cursor_from).toEqual(full.cursor_to);
  });
});

describe('ErpService.syncCost / syncInventory', () => {
  it('cost sync persists records', async () => {
    const { service } = buildService();
    const r = await service.syncCost({ mode: 'full' }, { trace_id: TRACE, user_id: null });
    expect(r.records.length).toBeGreaterThan(0);
    expect(r.records[0]!.unit_cost).toBeGreaterThan(0);
  });

  it('inventory sync persists records', async () => {
    const { service } = buildService();
    const r = await service.syncInventory({ mode: 'full' }, { trace_id: TRACE, user_id: null });
    expect(r.records.length).toBeGreaterThan(0);
    expect(r.records[0]!.available_qty).toBeGreaterThan(0);
  });
});

// ─── LIMS create + pull ────────────────────────────────────────────────────

describe('ErpService.createLimsTask', () => {
  it('creates a LIMS task, persists a link row + erp_job', async () => {
    const { repo, service } = buildService();
    const r = await service.createLimsTask(
      { test_method: 'KV_100C', sample_count: 2 },
      { trace_id: TRACE, user_id: 'u1' }
    );
    expect(r.link.status).toBe('submitted');
    expect(r.link.external_lims_task_id).toMatch(/^LIMS-/);
    expect(repo.links.size).toBe(1);
    const job = [...repo.jobs.values()][0]!;
    expect(job.operation).toBe('lims_create_task');
    expect(job.reference_id).toBe(r.link.id);
  });

  it('retries transient failures and surfaces UpstreamError on exhaustion', async () => {
    const { service } = buildService({ limsFailures: 4 });
    await expect(
      service.createLimsTask(
        { test_method: 'KV_100C', max_attempts: 2 },
        { trace_id: TRACE, user_id: null }
      )
    ).rejects.toThrow(/LIMS createTask/);
  });
});

describe('ErpService.pullLimsResult', () => {
  it('updates the link with the pulled status + metrics', async () => {
    const { service } = buildService();
    const created = await service.createLimsTask(
      { test_method: 'KV_100C' },
      { trace_id: TRACE, user_id: null }
    );
    const first = await service.pullLimsResult(
      created.link.id,
      {},
      { trace_id: TRACE, user_id: null }
    );
    expect(first.status).toBe('in_progress');
    const second = await service.pullLimsResult(
      created.link.id,
      {},
      { trace_id: TRACE, user_id: null }
    );
    expect(second.status).toBe('completed');
    expect(second.metrics.length).toBeGreaterThan(0);
    expect(second.link.last_pull_job_id).toBeDefined();
    expect(second.link.result_payload).not.toBeNull();
  });

  it('throws NotFound for unknown link', async () => {
    const { service } = buildService();
    await expect(
      service.pullLimsResult(
        '00000000-0000-0000-0000-000000000abc',
        {},
        { trace_id: TRACE, user_id: null }
      )
    ).rejects.toThrow();
  });

  it('respects alwaysInProgress mock toggle (no completion)', async () => {
    const { service } = buildService({ limsAlwaysInProgress: true });
    const created = await service.createLimsTask(
      { test_method: 'KV_100C' },
      { trace_id: TRACE, user_id: null }
    );
    const r = await service.pullLimsResult(created.link.id, {}, { trace_id: TRACE, user_id: null });
    expect(r.status).toBe('in_progress');
    expect(r.metrics.length).toBe(0);
  });
});

describe('ErpService LIMS list / get', () => {
  it('listLimsLinks paginates correctly', async () => {
    const { service } = buildService();
    for (let i = 0; i < 3; i++) {
      await service.createLimsTask(
        { test_method: 'KV_100C' },
        { trace_id: `${TRACE}-${i}`, user_id: null }
      );
    }
    const all = await service.listLimsLinks({ page: 1, pageSize: 2 });
    expect(all.items).toHaveLength(2);
    expect(all.total).toBe(3);
  });

  it('getLimsLink throws NotFound for unknown id', async () => {
    const { service } = buildService();
    await expect(service.getLimsLink('00000000-0000-0000-0000-000000000abc')).rejects.toThrow();
  });
});

// ─── Carbon ────────────────────────────────────────────────────────────────

describe('ErpService.lookupMaterialCarbon', () => {
  it('returns a known material', async () => {
    const { service } = buildService();
    const r = await service.lookupMaterialCarbon('RM-PAO-6', { trace_id: TRACE, user_id: null });
    expect(r.record.kgCO2e_per_kg).toBeGreaterThan(0);
    expect(r.record.source).toBe('mock-known');
  });

  it('persists the audit job', async () => {
    const { repo, service } = buildService();
    await service.lookupMaterialCarbon('RM-PAO-6', { trace_id: TRACE, user_id: null });
    const job = [...repo.jobs.values()].find((j) => j.operation === 'carbon_material_lookup');
    expect(job?.status).toBe('succeeded');
  });
});

describe('ErpService.estimateFormulaCarbon', () => {
  it('produces a per-kg estimate with breakdown', async () => {
    const { service } = buildService();
    const r = await service.estimateFormulaCarbon(
      {
        bom: [
          { material_code: 'RM-PAO-6', ratio: 0.5 },
          { material_code: 'RM-GIII-4', ratio: 0.5 },
        ],
      },
      { trace_id: TRACE, user_id: null }
    );
    expect(r.result.kgCO2e_per_kg).toBeGreaterThan(0);
    expect(r.result.breakdown).toHaveLength(2);
  });

  it('persists partial status when materials are missing', async () => {
    const { repo, service } = buildService();
    await service.estimateFormulaCarbon(
      {
        bom: [
          { material_code: 'RM-PAO-6', ratio: 0.5 },
          { material_code: 'NONE', ratio: 0.5 },
        ],
      },
      { trace_id: TRACE, user_id: null }
    );
    const job = [...repo.jobs.values()].find((j) => j.operation === 'carbon_formula_estimate');
    expect(job?.status).toBe('partial');
    expect(job?.records_skipped).toBe(1);
  });

  it('rejects empty bom', async () => {
    const { service } = buildService();
    await expect(
      service.estimateFormulaCarbon({ bom: [] }, { trace_id: TRACE, user_id: null })
    ).rejects.toThrow();
  });
});

// ─── Job introspection ────────────────────────────────────────────────────

describe('ErpService.getJob / listJobs', () => {
  it('getJob returns the job + its log trail', async () => {
    const { service } = buildService();
    const r = await service.syncBom({ mode: 'full' }, { trace_id: TRACE, user_id: null });
    const detail = await service.getJob(r.job_id);
    expect(detail.job.id).toBe(r.job_id);
    expect(detail.logs.length).toBeGreaterThanOrEqual(1);
  });

  it('listJobs filters by source_system', async () => {
    const { service } = buildService();
    await service.syncBom({ mode: 'full' }, { trace_id: TRACE, user_id: null });
    await service.lookupMaterialCarbon('RM-PAO-6', { trace_id: TRACE, user_id: null });
    const sap = await service.listJobs({ source_system: 'sap', page: 1, pageSize: 20 });
    expect(sap.items.every((j) => j.source_system === 'sap')).toBe(true);
    const carbon = await service.listJobs({ source_system: 'carbon', page: 1, pageSize: 20 });
    expect(carbon.items.every((j) => j.source_system === 'carbon')).toBe(true);
  });
});
