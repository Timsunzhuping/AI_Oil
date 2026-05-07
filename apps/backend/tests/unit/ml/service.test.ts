import { describe, it, expect } from 'vitest';
import pino from 'pino';
import { MlService } from '../../../src/modules/ml/service.js';
import { MockTrainerAdapter } from '../../../src/modules/ml/adapters/trainer/mock.js';
import { LocalTrainerAdapter } from '../../../src/modules/ml/adapters/trainer/local.js';
import type { MlRepository } from '../../../src/modules/ml/repository.js';
import type { ModelInput, DatasetInput, ModelVersionRow } from '../../../src/modules/ml/types.js';
import { FakeMlRepository } from './_fakes.js';

const TRACE = 'trace-1';
const logger = pino({ level: 'silent' });

function buildService(opts: { trainer?: 'mock' | 'local'; trainerFailures?: number } = {}) {
  const repo = new FakeMlRepository();
  const trainer =
    opts.trainer === 'local'
      ? new LocalTrainerAdapter()
      : new MockTrainerAdapter(
          opts.trainerFailures ? { failureCounter: { remaining: opts.trainerFailures } } : {}
        );
  const service = new MlService({
    repository: repo as unknown as MlRepository,
    trainer,
    logger,
  });
  return { repo, service, trainer };
}

async function seedModelAndDataset(
  service: MlService,
  model: ModelInput = { name: 'kv-regressor', task_type: 'regression' },
  dataset: DatasetInput = { name: 'samples', storage_url: 'mock://ds' }
) {
  const m = await service.createModel(model, { trace_id: TRACE, user_id: 'u1' });
  const d = await service.createDataset(dataset, { trace_id: TRACE, user_id: 'u1' });
  return { m, d };
}

// ─── Datasets / feature templates ─────────────────────────────────────────

describe('MlService dataset CRUD', () => {
  it('creates and retrieves a dataset', async () => {
    const { service } = buildService();
    const d = await service.createDataset(
      { name: 'pcmo-samples', storage_url: 's3://b/k' },
      { trace_id: TRACE, user_id: 'u1' }
    );
    expect(d.code).toMatch(/^DS-2026-/);
    const r = await service.getDataset(d.id);
    expect(r.id).toBe(d.id);
  });

  it('list paginates correctly', async () => {
    const { service } = buildService();
    for (let i = 0; i < 3; i++) {
      await service.createDataset(
        { name: `ds-${i}`, storage_url: 'mock://x' },
        { trace_id: TRACE, user_id: null }
      );
    }
    const r = await service.listDatasets({ page: 1, pageSize: 2 });
    expect(r.items).toHaveLength(2);
    expect(r.total).toBe(3);
  });
});

describe('MlService feature template CRUD', () => {
  it('creates and lists feature templates', async () => {
    const { service } = buildService();
    const ft = await service.createFeatureTemplate(
      { name: 'kv-feats', task_type: 'regression', spec: { features: [] } },
      { trace_id: TRACE, user_id: 'u1' }
    );
    expect(ft.code).toMatch(/^FT-2026-/);
    expect(ft.task_type).toBe('regression');
    const list = await service.listFeatureTemplates({
      task_type: 'regression',
      page: 1,
      pageSize: 10,
    });
    expect(list.total).toBe(1);
  });
});

// ─── Training jobs ─────────────────────────────────────────────────────────

describe('MlService training jobs', () => {
  it('runs a training job and registers a new model version', async () => {
    const { service, repo } = buildService();
    const { m, d } = await seedModelAndDataset(service);
    const r = await service.createTrainingJob(
      { model_id: m.id, dataset_id: d.id, config: { random_seed: 1 } },
      { trace_id: TRACE, user_id: 'u1' }
    );
    expect(r.job.status).toBe('succeeded');
    expect(r.produced_version).toBeDefined();
    expect(repo.versions.size).toBe(1);
    const versions = [...repo.versions.values()];
    expect(versions[0]!.deployment_status).toBe('staged');
    expect(versions[0]!.metrics.rmse).toBeGreaterThan(0);
  });

  it('runs without a model_id (exploratory) — no version row created', async () => {
    const { service, repo } = buildService();
    const d = await service.createDataset(
      { name: 'ds', storage_url: 'mock://x' },
      { trace_id: TRACE, user_id: null }
    );
    const r = await service.createTrainingJob(
      { dataset_id: d.id, config: {} },
      { trace_id: TRACE, user_id: null }
    );
    expect(r.job.status).toBe('succeeded');
    expect(r.produced_version).toBeUndefined();
    expect(repo.versions.size).toBe(0);
  });

  it('marks job failed when trainer throws', async () => {
    const { service } = buildService({ trainerFailures: 5 });
    const { m, d } = await seedModelAndDataset(service);
    await expect(
      service.createTrainingJob(
        { model_id: m.id, dataset_id: d.id, config: {} },
        { trace_id: TRACE, user_id: null }
      )
    ).rejects.toThrow();
  });

  it('rejects training on unknown model / dataset / feature_template', async () => {
    const { service } = buildService();
    await expect(
      service.createTrainingJob(
        { model_id: '00000000-0000-0000-0000-000000000abc', dataset_id: null, config: {} },
        { trace_id: TRACE, user_id: null }
      )
    ).rejects.toThrow();
  });

  it('can be cancelled while queued', async () => {
    const { service, repo } = buildService();
    // Manually create a job in 'queued' state so cancel can fire.
    const { m, d } = await seedModelAndDataset(service);
    const j = await repo.createTrainingJob({
      code: 'JOB-2026-000099',
      model_id: m.id,
      trigger_type: 'manual',
      triggered_by: null,
      dataset_id: d.id,
      config: {},
      source_code_commit: null,
      metadata: {},
    });
    const r = await service.cancelTrainingJob(j.id, { trace_id: TRACE, user_id: null });
    expect(r.status).toBe('cancelled');
  });

  it('uses the local trainer when mode=local', async () => {
    const { service, repo } = buildService({ trainer: 'local' });
    const { m, d } = await seedModelAndDataset(service);
    const r = await service.createTrainingJob(
      { model_id: m.id, dataset_id: d.id, config: { random_seed: 7 } },
      { trace_id: TRACE, user_id: null }
    );
    expect(r.job.status).toBe('succeeded');
    expect(r.produced_version!.metrics).toHaveProperty('r2');
    expect(r.produced_version!.metrics).toHaveProperty('slope');
    void repo;
  });
});

// ─── Release / rollback ────────────────────────────────────────────────────

describe('MlService release / rollback', () => {
  async function setupTwoVersions() {
    const { service, repo } = buildService();
    const { m, d } = await seedModelAndDataset(service);
    const r1 = await service.createTrainingJob(
      { model_id: m.id, dataset_id: d.id, config: { random_seed: 1 } },
      { trace_id: TRACE, user_id: null }
    );
    const r2 = await service.createTrainingJob(
      { model_id: m.id, dataset_id: d.id, config: { random_seed: 2 } },
      { trace_id: TRACE, user_id: null }
    );
    return { service, repo, model: m, v1: r1.produced_version!, v2: r2.produced_version! };
  }

  it('release flips deployment_status, demotes previous active, persists release row', async () => {
    const { service, repo, model, v1, v2 } = await setupTwoVersions();

    const a = await service.releaseModel(
      model.id,
      { version_id: v1.id },
      { trace_id: TRACE, user_id: 'u1' }
    );
    expect(a.active_version!.id).toBe(v1.id);
    expect(a.active_version!.deployment_status).toBe('active');

    const b = await service.releaseModel(
      model.id,
      { version_id: v2.id },
      { trace_id: TRACE, user_id: 'u1' }
    );
    expect(b.active_version!.id).toBe(v2.id);
    /* v1 should now be retired. */
    const v1Refreshed = repo.versions.get(v1.id) as ModelVersionRow;
    expect(v1Refreshed.deployment_status).toBe('retired');

    const releases = await service.listReleases(model.id);
    expect(releases).toHaveLength(2);
    expect(releases[0]!.action).toBe('release');
  });

  it('rollback reverts to the previous active version', async () => {
    const { service, repo, model, v1, v2 } = await setupTwoVersions();
    await service.releaseModel(model.id, { version_id: v1.id }, { trace_id: TRACE, user_id: null });
    await service.releaseModel(model.id, { version_id: v2.id }, { trace_id: TRACE, user_id: null });
    const r = await service.rollbackModel(model.id, {}, { trace_id: TRACE, user_id: null });
    expect(r.release.action).toBe('rollback');
    expect(r.active_version!.id).toBe(v1.id);
    /* v2 was rolled back. */
    expect((repo.versions.get(v2.id) as ModelVersionRow).deployment_status).toBe('rolled_back');
  });

  it('rollback to a specific version is supported', async () => {
    const { service, model, v1, v2 } = await setupTwoVersions();
    await service.releaseModel(model.id, { version_id: v1.id }, { trace_id: TRACE, user_id: null });
    await service.releaseModel(model.id, { version_id: v2.id }, { trace_id: TRACE, user_id: null });
    const r = await service.rollbackModel(
      model.id,
      { to_version_id: v1.id },
      { trace_id: TRACE, user_id: null }
    );
    expect(r.active_version!.id).toBe(v1.id);
  });

  it('release fails when guardrails are not met (and persists a failed audit row)', async () => {
    const { service, repo, model, v1 } = await setupTwoVersions();
    await expect(
      service.releaseModel(
        model.id,
        {
          version_id: v1.id,
          guardrails: [{ metric: 'r2', comparator: 'gte', threshold: 999 }],
        },
        { trace_id: TRACE, user_id: null }
      )
    ).rejects.toThrow(/guardrails/);
    const releases = [...repo.releases.values()];
    expect(releases.some((r) => r.status === 'failed')).toBe(true);
  });

  it('release without version_id is rejected', async () => {
    const { service, model } = await setupTwoVersions();
    await expect(
      service.releaseModel(model.id, {}, { trace_id: TRACE, user_id: null })
    ).rejects.toThrow(/version_id/);
  });

  it('rollback with no active version is rejected', async () => {
    const { service } = buildService();
    const { m } = await seedModelAndDataset(service);
    await expect(
      service.rollbackModel(m.id, {}, { trace_id: TRACE, user_id: null })
    ).rejects.toThrow(/active/);
  });
});

// ─── Compare report ────────────────────────────────────────────────────────

describe('MlService.compareModels', () => {
  it('produces metric rows with deltas vs baseline', async () => {
    const { service } = buildService();
    const { m, d } = await seedModelAndDataset(service);
    const a = await service.createTrainingJob(
      { model_id: m.id, dataset_id: d.id, config: { random_seed: 1 } },
      { trace_id: TRACE, user_id: null }
    );
    const b = await service.createTrainingJob(
      { model_id: m.id, dataset_id: d.id, config: { random_seed: 2 } },
      { trace_id: TRACE, user_id: null }
    );
    const ids = [a.produced_version!.id, b.produced_version!.id];
    const report = await service.compareModels(ids);
    expect(report.baseline_version_id).toBe(ids[0]);
    expect(report.versions).toHaveLength(2);
    expect(report.metric_rows.length).toBeGreaterThan(0);
    const rmseRow = report.metric_rows.find((r) => r.name === 'rmse');
    expect(rmseRow!.deltas[ids[0]!]).toBe(0);
    expect(rmseRow!.deltas[ids[1]!]).not.toBeNull();
    expect(report.summary.winners.length).toBeGreaterThan(0);
  });

  it('rejects empty version list', async () => {
    const { service } = buildService();
    await expect(service.compareModels([])).rejects.toThrow();
  });

  it('rejects unknown version ids', async () => {
    const { service } = buildService();
    await expect(service.compareModels(['00000000-0000-0000-0000-000000000abc'])).rejects.toThrow();
  });

  it('exposes hyperparameter diffs', async () => {
    const { service } = buildService();
    const { m, d } = await seedModelAndDataset(service);
    const a = await service.createTrainingJob(
      {
        model_id: m.id,
        dataset_id: d.id,
        config: { random_seed: 1, hyperparameters: { lr: 0.01 } },
      },
      { trace_id: TRACE, user_id: null }
    );
    const b = await service.createTrainingJob(
      {
        model_id: m.id,
        dataset_id: d.id,
        config: { random_seed: 2, hyperparameters: { lr: 0.05 } },
      },
      { trace_id: TRACE, user_id: null }
    );
    const report = await service.compareModels([a.produced_version!.id, b.produced_version!.id]);
    const lrDiff = report.hyperparameter_diffs.find((d) => d.key === 'lr');
    expect(lrDiff!.is_uniform).toBe(false);
  });
});

// ─── Auto-finetune triggers + manual retrain ──────────────────────────────

describe('MlService auto-finetune triggers', () => {
  it('creates and lists triggers', async () => {
    const { service } = buildService();
    const { m, d } = await seedModelAndDataset(service);
    const t = await service.createAutoFinetuneTrigger(
      {
        model_id: m.id,
        default_dataset_id: d.id,
        condition: { type: 'drift', metric: 'psi', threshold: 0.2 },
      },
      { trace_id: TRACE, user_id: 'u1' }
    );
    expect(t.code).toMatch(/^FTR-2026-/);
    const list = await service.listAutoFinetuneTriggers(m.id);
    expect(list).toHaveLength(1);
    expect(list[0]!.id).toBe(t.id);
  });

  it('fire produces a training job and bumps fire_count', async () => {
    const { service, repo } = buildService();
    const { m, d } = await seedModelAndDataset(service);
    const t = await service.createAutoFinetuneTrigger(
      { model_id: m.id, default_dataset_id: d.id, condition: { type: 'drift', threshold: 0.1 } },
      { trace_id: TRACE, user_id: null }
    );
    const r = await service.fireAutoFinetuneTrigger(t.id, {}, { trace_id: TRACE, user_id: null });
    expect(r.job.trigger_type).toBe('auto_retrain');
    const refreshed = repo.triggers.get(t.id)!;
    expect(refreshed.fire_count).toBe(1);
    expect(refreshed.last_fired_job_id).toBe(r.job.id);
  });

  it('rejects fire of inactive triggers', async () => {
    const { service, repo } = buildService();
    const { m, d } = await seedModelAndDataset(service);
    const t = await service.createAutoFinetuneTrigger(
      { model_id: m.id, default_dataset_id: d.id, condition: { type: 'manual' }, is_active: false },
      { trace_id: TRACE, user_id: null }
    );
    void repo;
    await expect(
      service.fireAutoFinetuneTrigger(t.id, {}, { trace_id: TRACE, user_id: null })
    ).rejects.toThrow(/inactive/);
  });
});

describe('MlService.manualRetrain', () => {
  it('is equivalent to creating a manual training job', async () => {
    const { service } = buildService();
    const { m, d } = await seedModelAndDataset(service);
    const r = await service.manualRetrain(
      { model_id: m.id, dataset_id: d.id, notes: 'requested by ops' },
      { trace_id: TRACE, user_id: 'u1' }
    );
    expect(r.job.status).toBe('succeeded');
    expect(r.job.trigger_type).toBe('manual');
    expect(r.produced_version).toBeDefined();
  });
});
