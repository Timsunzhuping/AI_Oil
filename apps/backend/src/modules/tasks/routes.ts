import { Router, Request } from 'express';
import type { Pool } from 'pg';
import type { Logger } from 'pino';
import { z } from 'zod';
import { NotFoundError } from '../../lib/errors.js';
import { validate } from '../../middleware/validate.js';
import { success, paginated } from '../../lib/response.js';
import { TaskRepository } from './repository.js';
import { TaskCenterService } from './service.js';
import { HandlerRegistry } from './handlers/index.js';

const TaskTypeEnum = z.enum([
  'forward_prediction','batch_prediction','cost_optimization',
  'material_replacement','new_product_generation','knowledge_qa',
]);

const PriorityEnum = z.enum(['low','medium','high','critical']);
const InputModeEnum = z.enum(['structured','natural_language','template']);
const InputTypeEnum = z.enum(['structured','natural_language','template_filled','attachment','reference']);
const OutputTypeEnum = z.enum(['prediction','recommendation','report','attachment','error','partial','citation']);

const CreateTaskSchema = z.object({
  code: z.string().min(1).max(64).optional(),
  task_type: TaskTypeEnum,
  title: z.string().min(1).max(255),
  description: z.string().nullable().optional(),
  priority: PriorityEnum.optional(),
  input_mode: InputModeEnum.optional(),
  template_id: z.string().uuid().nullable().optional(),
  related_formula_id: z.string().uuid().nullable().optional(),
  related_formula_version_id: z.string().uuid().nullable().optional(),
  related_product_id: z.string().uuid().nullable().optional(),
  related_experiment_id: z.string().uuid().nullable().optional(),
  tags: z.array(z.string()).optional(),
  metadata: z.record(z.unknown()).optional(),
  input: z.object({
    input_type: InputTypeEnum.optional(),
    payload: z.record(z.unknown()).optional(),
    raw_text: z.string().nullable().optional(),
    is_primary: z.boolean().optional(),
  }).optional(),
});

const UpdateTaskSchema = z.object({
  title: z.string().min(1).max(255).optional(),
  description: z.string().nullable().optional(),
  priority: PriorityEnum.optional(),
  input_mode: InputModeEnum.optional(),
  template_id: z.string().uuid().nullable().optional(),
  related_formula_id: z.string().uuid().nullable().optional(),
  related_formula_version_id: z.string().uuid().nullable().optional(),
  related_product_id: z.string().uuid().nullable().optional(),
  related_experiment_id: z.string().uuid().nullable().optional(),
  tags: z.array(z.string()).optional(),
  metadata: z.record(z.unknown()).optional(),
  expected_version: z.number().int().min(0),
});

const ListQuery = z.object({
  task_kind: z.string().optional(),
  task_type: z.string().optional(),
  status: z.string().optional(),
  related_formula_version_id: z.string().uuid().optional(),
  related_product_id: z.string().uuid().optional(),
  assigned_to: z.string().uuid().optional(),
  reporter_id: z.string().uuid().optional(),
  tag: z.string().optional(),
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(200).default(20),
});

const AttachInputSchema = z.object({
  input_type: InputTypeEnum,
  payload: z.record(z.unknown()).optional(),
  raw_text: z.string().nullable().optional(),
  attachment_url: z.string().url().nullable().optional(),
  attachment_mime: z.string().nullable().optional(),
  is_primary: z.boolean().optional(),
  metadata: z.record(z.unknown()).optional(),
});

const AttachOutputSchema = z.object({
  output_type: OutputTypeEnum,
  payload: z.record(z.unknown()).optional(),
  summary: z.string().optional(),
  attachment_url: z.string().url().optional(),
  attachment_mime: z.string().optional(),
  model_version_id: z.string().uuid().optional(),
  feature_set_version: z.string().optional(),
  confidence: z.number().min(0).max(1).optional(),
  is_primary: z.boolean().optional(),
  metadata: z.record(z.unknown()).optional(),
});

const ManualOverrideSchema = z.object({
  to_status: z.enum(['draft','submitted','processing','completed','failed','cancelled','archived']),
  reason: z.string().min(4),
});

const IdParam = z.object({ id: z.string().uuid() });
const CodeParam = z.object({ code: z.string().min(1) });

export function buildTasksRouter(pool: Pool, logger: Logger): Router {
  const router = Router();
  const repo = new TaskRepository(pool);
  const registry = new HandlerRegistry();
  const service = new TaskCenterService(repo, registry, logger);
  const userId = (req: Request) => (req as Request & { userId?: string }).userId;

  // -------------------------- create / list / read --------------------------

  router.post('/', validate({ body: CreateTaskSchema }), async (req, res) => {
    const task = await service.create(req.body, userId(req));
    res.status(201).json(success(task, 'Task created'));
  });

  router.get('/', validate({ query: ListQuery }), async (req, res) => {
    const q = req.query as unknown as z.infer<typeof ListQuery>;
    const result = await service.list({
      ...(q.task_kind ? { task_kind: q.task_kind } : {}),
      ...(q.task_type ? { task_type: q.task_type } : {}),
      ...(q.status ? { status: q.status } : {}),
      ...(q.related_formula_version_id ? { related_formula_version_id: q.related_formula_version_id } : {}),
      ...(q.related_product_id ? { related_product_id: q.related_product_id } : {}),
      ...(q.assigned_to ? { assigned_to: q.assigned_to } : {}),
      ...(q.reporter_id ? { reporter_id: q.reporter_id } : {}),
      ...(q.tag ? { tag: q.tag } : {}),
      page: q.page,
      pageSize: q.pageSize,
    });
    res.json(paginated(result.items, result.total, q.page, q.pageSize));
  });

  router.get('/templates', async (req, res) => {
    const taskType = req.query.task_type as z.infer<typeof TaskTypeEnum> | undefined;
    const items = await service.listTemplates(taskType);
    res.json(success(items));
  });

  router.get('/templates/:code', validate({ params: CodeParam }), async (req, res) => {
    const tpl = await service.findTemplate(req.params.code);
    if (!tpl) throw new NotFoundError('Template');
    res.json(success(tpl));
  });

  router.get('/handlers', (_req, res) => {
    res.json(success(registry.list()));
  });

  router.get('/:id', validate({ params: IdParam }), async (req, res) => {
    const view = await service.get(req.params.id);
    res.json(success(view));
  });

  router.patch('/:id', validate({ params: IdParam, body: UpdateTaskSchema }), async (req, res) => {
    const updated = await service.updateDraft(req.params.id, req.body, userId(req));
    res.json(success(updated, 'Draft saved'));
  });

  router.delete('/:id', validate({ params: IdParam }), async (req, res) => {
    await service.remove(req.params.id, userId(req));
    res.status(204).end();
  });

  // -------------------------- state actions --------------------------

  router.post('/:id/submit', validate({ params: IdParam }), async (req, res) => {
    const task = await service.submit(req.params.id, userId(req), req.traceId);
    res.status(202).json(success(task, 'Task submitted'));
  });

  router.post('/:id/cancel', validate({ params: IdParam, body: z.object({ reason: z.string().optional() }).default({}) }), async (req, res) => {
    const task = await service.cancel(req.params.id, userId(req), req.body.reason);
    res.json(success(task, 'Task cancelled'));
  });

  router.post('/:id/archive', validate({ params: IdParam, body: z.object({ reason: z.string().optional() }).default({}) }), async (req, res) => {
    const task = await service.archive(req.params.id, userId(req), req.body.reason);
    res.json(success(task, 'Task archived'));
  });

  router.post('/:id/restore', validate({ params: IdParam }), async (req, res) => {
    const task = await service.restore(req.params.id, userId(req));
    res.json(success(task, 'Task restored'));
  });

  router.post('/:id/manual-override', validate({ params: IdParam, body: ManualOverrideSchema }), async (req, res) => {
    const task = await service.manualOverride(req.params.id, req.body.to_status, userId(req), req.body.reason);
    res.json(success(task, 'Status overridden'));
  });

  // -------------------------- inputs --------------------------

  router.get('/:id/inputs', validate({ params: IdParam }), async (req, res) => {
    res.json(success(await service.listInputs(req.params.id)));
  });

  router.post('/:id/inputs', validate({ params: IdParam, body: AttachInputSchema }), async (req, res) => {
    const row = await service.attachInput(req.params.id, req.body, userId(req));
    res.status(201).json(success(row, 'Input attached'));
  });

  // -------------------------- outputs --------------------------

  router.get('/:id/outputs', validate({ params: IdParam }), async (req, res) => {
    res.json(success(await service.listOutputs(req.params.id)));
  });

  router.post('/:id/outputs', validate({ params: IdParam, body: AttachOutputSchema }), async (req, res) => {
    const row = await service.attachOutput(req.params.id, req.body, userId(req));
    res.status(201).json(success(row, 'Output attached'));
  });

  // -------------------------- events --------------------------

  router.get('/:id/events', validate({ params: IdParam }), async (req, res) => {
    const limit = Math.min(1000, Math.max(1, parseInt(String(req.query.limit ?? '200'), 10)));
    res.json(success(await service.listEvents(req.params.id, limit)));
  });

  return router;
}
