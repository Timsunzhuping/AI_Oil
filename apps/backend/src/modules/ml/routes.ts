/**
 * HTTP layer for the MLOps platform.
 *
 *   POST  /ml/datasets                       create dataset
 *   GET   /ml/datasets                       list
 *   GET   /ml/datasets/:id                   detail
 *
 *   POST  /ml/feature-templates              create
 *   GET   /ml/feature-templates              list
 *   GET   /ml/feature-templates/:id          detail
 *
 *   POST  /ml/models                         register a model
 *   GET   /ml/models                         list
 *   GET   /ml/models/:id                     detail (incl. versions list)
 *   POST  /ml/models/:id/release             release a version
 *   POST  /ml/models/:id/rollback            rollback to a previous version
 *   GET   /ml/models/:id/releases            release history
 *   GET   /ml/models/compare                 compare metrics across versions
 *
 *   POST  /ml/jobs                           create + run a training job
 *   GET   /ml/jobs                           list
 *   GET   /ml/jobs/:id                       detail
 *   POST  /ml/jobs/:id/cancel                cancel a running job
 *
 *   POST  /ml/auto-finetune-triggers         create trigger
 *   GET   /ml/auto-finetune-triggers         list
 *   POST  /ml/auto-finetune-triggers/:id/fire  manually fire a trigger
 *
 *   POST  /ml/manual-retrain                 one-click retrain entry
 */
import { Router, type Request } from 'express';
import { validate } from '../../middleware/validate.js';
import { paginated, success } from '../../lib/response.js';
import {
  CompareModelsQuerySchema,
  CreateAutoFinetuneTriggerSchema,
  CreateDatasetSchema,
  CreateFeatureTemplateSchema,
  CreateModelSchema,
  CreateTrainingJobSchema,
  FireAutoFinetuneTriggerSchema,
  IdParamSchema,
  ListDatasetsQuerySchema,
  ListModelsQuerySchema,
  ListTrainingJobsQuerySchema,
  ManualRetrainSchema,
  ReleaseSchema,
  RollbackSchema,
  UpdateFeatureTemplateSchema,
} from './schemas.js';
import type { MlService } from './service.js';
import { z } from 'zod';

const userIdOf = (req: Request): string | null =>
  (req as Request & { userId?: string }).userId ?? null;

const FeatureTemplateListQuerySchema = z.object({
  task_type: z.string().max(64).optional(),
  status: z.enum(['draft', 'published', 'archived']).optional(),
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(200).default(20),
});

const AutoFinetuneListQuerySchema = z.object({
  model_id: z.string().uuid().optional(),
});

export function buildMlRouter(service: MlService): Router {
  const router = Router();

  // ─── Datasets ────────────────────────────────────────────────────
  router.post('/datasets', validate({ body: CreateDatasetSchema }), async (req, res) => {
    const r = await service.createDataset(req.body, {
      trace_id: req.traceId,
      user_id: userIdOf(req),
    });
    res.status(201).json(success(r, 'Dataset created', req.traceId));
  });

  router.get('/datasets', validate({ query: ListDatasetsQuerySchema }), async (req, res) => {
    const q = req.query as unknown as { q?: string; page: number; pageSize: number };
    const r = await service.listDatasets(q);
    res.json(paginated(r.items, r.total, q.page, q.pageSize, req.traceId));
  });

  router.get('/datasets/:id', validate({ params: IdParamSchema }), async (req, res) => {
    const r = await service.getDataset(req.params.id as string);
    res.json(success(r, 'success', req.traceId));
  });

  // ─── Feature templates ───────────────────────────────────────────
  router.post(
    '/feature-templates',
    validate({ body: CreateFeatureTemplateSchema }),
    async (req, res) => {
      const r = await service.createFeatureTemplate(req.body, {
        trace_id: req.traceId,
        user_id: userIdOf(req),
      });
      res.status(201).json(success(r, 'Feature template created', req.traceId));
    }
  );

  router.get(
    '/feature-templates',
    validate({ query: FeatureTemplateListQuerySchema }),
    async (req, res) => {
      const q = req.query as unknown as Parameters<MlService['listFeatureTemplates']>[0];
      const r = await service.listFeatureTemplates(q);
      res.json(paginated(r.items, r.total, q.page, q.pageSize, req.traceId));
    }
  );

  router.get('/feature-templates/:id', validate({ params: IdParamSchema }), async (req, res) => {
    const r = await service.getFeatureTemplate(req.params.id as string);
    res.json(success(r, 'success', req.traceId));
  });

  void UpdateFeatureTemplateSchema; // exposed for future PATCH wiring

  // ─── Models ──────────────────────────────────────────────────────
  router.post('/models', validate({ body: CreateModelSchema }), async (req, res) => {
    const r = await service.createModel(req.body, {
      trace_id: req.traceId,
      user_id: userIdOf(req),
    });
    res.status(201).json(success(r, 'Model registered', req.traceId));
  });

  router.get('/models', validate({ query: ListModelsQuerySchema }), async (req, res) => {
    const q = req.query as unknown as Parameters<MlService['listModels']>[0];
    const r = await service.listModels(q);
    res.json(paginated(r.items, r.total, q.page, q.pageSize, req.traceId));
  });

  router.get('/models/compare', validate({ query: CompareModelsQuerySchema }), async (req, res) => {
    const q = req.query as unknown as { versions: string; baseline?: string };
    const ids = q.versions
      .split(',')
      .map((v) => v.trim())
      .filter(Boolean);
    const report = await service.compareModels(ids, q.baseline);
    res.json(success(report, 'success', req.traceId));
  });

  router.get('/models/:id', validate({ params: IdParamSchema }), async (req, res) => {
    const id = req.params.id as string;
    const [model, versions] = await Promise.all([
      service.getModel(id),
      service.listModelVersions(id),
    ]);
    res.json(success({ model, versions }, 'success', req.traceId));
  });

  router.post(
    '/models/:id/release',
    validate({ params: IdParamSchema, body: ReleaseSchema }),
    async (req, res) => {
      const r = await service.releaseModel(req.params.id as string, req.body, {
        trace_id: req.traceId,
        user_id: userIdOf(req),
      });
      res.status(202).json(success(r, 'Model released', req.traceId));
    }
  );

  router.post(
    '/models/:id/rollback',
    validate({ params: IdParamSchema, body: RollbackSchema.optional().default({}) }),
    async (req, res) => {
      const r = await service.rollbackModel(req.params.id as string, req.body ?? {}, {
        trace_id: req.traceId,
        user_id: userIdOf(req),
      });
      res.status(202).json(success(r, 'Model rolled back', req.traceId));
    }
  );

  router.get('/models/:id/releases', validate({ params: IdParamSchema }), async (req, res) => {
    const r = await service.listReleases(req.params.id as string);
    res.json(success(r, 'success', req.traceId));
  });

  // ─── Training jobs ───────────────────────────────────────────────
  router.post('/jobs', validate({ body: CreateTrainingJobSchema }), async (req, res) => {
    const r = await service.createTrainingJob(req.body, {
      trace_id: req.traceId,
      user_id: userIdOf(req),
    });
    res.status(201).json(success(r, 'Training job submitted', req.traceId));
  });

  router.get('/jobs', validate({ query: ListTrainingJobsQuerySchema }), async (req, res) => {
    const q = req.query as unknown as Parameters<MlService['listTrainingJobs']>[0];
    const r = await service.listTrainingJobs(q);
    res.json(paginated(r.items, r.total, q.page, q.pageSize, req.traceId));
  });

  router.get('/jobs/:id', validate({ params: IdParamSchema }), async (req, res) => {
    const r = await service.getTrainingJob(req.params.id as string);
    res.json(success(r, 'success', req.traceId));
  });

  router.post('/jobs/:id/cancel', validate({ params: IdParamSchema }), async (req, res) => {
    const r = await service.cancelTrainingJob(req.params.id as string, {
      trace_id: req.traceId,
      user_id: userIdOf(req),
    });
    res.json(success(r, 'Training job cancelled', req.traceId));
  });

  // ─── Auto-finetune triggers ─────────────────────────────────────
  router.post(
    '/auto-finetune-triggers',
    validate({ body: CreateAutoFinetuneTriggerSchema }),
    async (req, res) => {
      const r = await service.createAutoFinetuneTrigger(req.body, {
        trace_id: req.traceId,
        user_id: userIdOf(req),
      });
      res.status(201).json(success(r, 'Auto-finetune trigger created', req.traceId));
    }
  );

  router.get(
    '/auto-finetune-triggers',
    validate({ query: AutoFinetuneListQuerySchema }),
    async (req, res) => {
      const q = req.query as unknown as { model_id?: string };
      const r = await service.listAutoFinetuneTriggers(q.model_id ?? null);
      res.json(success(r, 'success', req.traceId));
    }
  );

  router.post(
    '/auto-finetune-triggers/:id/fire',
    validate({ params: IdParamSchema, body: FireAutoFinetuneTriggerSchema.optional().default({}) }),
    async (req, res) => {
      const r = await service.fireAutoFinetuneTrigger(req.params.id as string, req.body ?? {}, {
        trace_id: req.traceId,
        user_id: userIdOf(req),
      });
      res.status(202).json(success(r, 'Trigger fired', req.traceId));
    }
  );

  // ─── Manual retrain ─────────────────────────────────────────────
  router.post('/manual-retrain', validate({ body: ManualRetrainSchema }), async (req, res) => {
    const r = await service.manualRetrain(req.body, {
      trace_id: req.traceId,
      user_id: userIdOf(req),
    });
    res.status(201).json(success(r, 'Manual retrain submitted', req.traceId));
  });

  return router;
}
