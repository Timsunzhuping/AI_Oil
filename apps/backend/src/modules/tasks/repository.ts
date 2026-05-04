import type { Pool, PoolClient } from 'pg';
import { withTransaction } from '../../lib/db.js';
import { buildUpdateSet } from '../../lib/sql.js';
import type {
  AiTaskType,
  AttachInputBody,
  AttachOutputBody,
  CreateTaskInput,
  EventRow,
  EventType,
  InputRow,
  OutputRow,
  TaskRow,
  TemplateRow,
  UpdateTaskInput,
} from './types.js';

/**
 * Generates a sequential R&D task code, e.g. 'AI-2026-0042'.
 * Uses YEAR + a sequence-per-year. Naive but readable; switch to a real
 * sequence in a follow-up if collisions become a problem.
 */
async function generateTaskCode(client: Pool | PoolClient): Promise<string> {
  const year = new Date().getUTCFullYear();
  const r = await client.query<{ c: string }>(
    `SELECT COUNT(*)::text c FROM r_and_d_tasks
      WHERE task_kind = 'ai_workflow'
        AND created_at >= make_timestamp($1, 1, 1, 0, 0, 0)
        AND created_at <  make_timestamp($1 + 1, 1, 1, 0, 0, 0)`,
    [year]
  );
  const n = parseInt(r.rows[0]?.c ?? '0', 10) + 1;
  return `AI-${year}-${String(n).padStart(4, '0')}`;
}

export class TaskRepository {
  constructor(private pool: Pool) {}

  // -------------------------- create --------------------------

  async createTask(input: CreateTaskInput, userId?: string): Promise<TaskRow> {
    return withTransaction(async (client) => {
      const code = input.code ?? (await generateTaskCode(client));

      const r = await client.query<TaskRow>(
        `INSERT INTO r_and_d_tasks (
            code, task_kind, task_type, title, description, status,
            priority, input_mode, template_id,
            related_formula_id, related_formula_version_id, related_product_id, related_experiment_id,
            tags, metadata, reporter_id, created_by, updated_by
         ) VALUES (
            $1, 'ai_workflow', $2, $3, $4, 'draft',
            $5, $6, $7,
            $8, $9, $10, $11,
            $12, $13, $14, $14, $14
         ) RETURNING *`,
        [
          code, input.task_type, input.title, input.description ?? null,
          input.priority ?? 'medium', input.input_mode ?? null, input.template_id ?? null,
          input.related_formula_id ?? null, input.related_formula_version_id ?? null,
          input.related_product_id ?? null, input.related_experiment_id ?? null,
          input.tags ?? [], input.metadata ?? {}, userId ?? null,
        ]
      );
      const task = r.rows[0]!;
      await this.appendEventRaw(task.id, 'created', null, 'draft', userId, null, { code }, client);
      return task;
    });
  }

  // -------------------------- read --------------------------

  async findById(id: string): Promise<TaskRow | null> {
    const r = await this.pool.query<TaskRow>(
      `SELECT * FROM r_and_d_tasks WHERE id = $1 AND deleted_at IS NULL`,
      [id]
    );
    return r.rows[0] ?? null;
  }

  async list(filter: {
    task_kind?: string;
    task_type?: string;
    status?: string;
    related_formula_version_id?: string;
    related_product_id?: string;
    assigned_to?: string;
    reporter_id?: string;
    tag?: string;
    page?: number;
    pageSize?: number;
  }): Promise<{ items: TaskRow[]; total: number }> {
    const where: string[] = ['deleted_at IS NULL'];
    const params: unknown[] = [];
    let i = 1;
    const push = (clause: string, val: unknown) => { where.push(clause.replace('$$', `$${i++}`)); params.push(val); };

    push('task_kind = $$',  filter.task_kind ?? 'ai_workflow');
    if (filter.task_type)                  push('task_type = $$',                  filter.task_type);
    if (filter.status)                     push('status = $$',                     filter.status);
    if (filter.related_formula_version_id) push('related_formula_version_id = $$', filter.related_formula_version_id);
    if (filter.related_product_id)         push('related_product_id = $$',         filter.related_product_id);
    if (filter.assigned_to)                push('assigned_to = $$',                filter.assigned_to);
    if (filter.reporter_id)                push('reporter_id = $$',                filter.reporter_id);
    if (filter.tag)                        push('tags @> ARRAY[$$]::text[]',       filter.tag);

    const page = Math.max(1, filter.page ?? 1);
    const pageSize = Math.min(200, Math.max(1, filter.pageSize ?? 20));

    const total = parseInt(
      (await this.pool.query<{ c: string }>(
        `SELECT COUNT(*)::text c FROM r_and_d_tasks WHERE ${where.join(' AND ')}`,
        params
      )).rows[0]?.c ?? '0',
      10
    );
    const items = (await this.pool.query<TaskRow>(
      `SELECT * FROM r_and_d_tasks WHERE ${where.join(' AND ')}
        ORDER BY created_at DESC LIMIT $${i++} OFFSET $${i++}`,
      [...params, pageSize, (page - 1) * pageSize]
    )).rows;
    return { items, total };
  }

  // -------------------------- update / status --------------------------

  async updateDraft(
    id: string,
    input: UpdateTaskInput,
    userId?: string,
    client?: PoolClient
  ): Promise<TaskRow | null> {
    const exec = client ?? this.pool;
    const { expected_version, ...rest } = input;
    const set = buildUpdateSet({ ...rest, updated_by: userId ?? null });
    if (set.params.length === 0) {
      const cur = await exec.query<TaskRow>(
        `SELECT * FROM r_and_d_tasks WHERE id = $1 AND deleted_at IS NULL`,
        [id]
      );
      return cur.rows[0] ?? null;
    }
    const r = await exec.query<TaskRow>(
      `UPDATE r_and_d_tasks SET ${set.sql}
        WHERE id = $${set.nextIndex} AND version = $${set.nextIndex + 1} AND deleted_at IS NULL
        RETURNING *`,
      [...set.params, id, expected_version]
    );
    return r.rows[0] ?? null;
  }

  /** Atomically transition status + emit event in one transaction. */
  async transition(
    id: string,
    fromStatus: string,
    toStatus: string,
    eventType: EventType,
    opts: {
      userId?: string;
      traceId?: string | null;
      message?: string;
      payload?: Record<string, unknown>;
      // Mutate adjacent timestamp columns based on event type
      submitted_at?: boolean;
      processing_started_at?: boolean;
      completed_at?: boolean;
      archived_at?: boolean;
      error_class?: string;
      error_message?: string;
      handler_version?: string;
      summary?: string;
    } = {}
  ): Promise<TaskRow | null> {
    return withTransaction(async (client) => {
      const setParts: string[] = ['status = $2'];
      const params: unknown[] = [id, toStatus];
      let i = 3;
      const set = (sql: string, val: unknown) => { setParts.push(sql.replace('$$', `$${i++}`)); params.push(val); };

      if (opts.submitted_at)           set('submitted_at = $$', new Date());
      if (opts.processing_started_at)  set('processing_started_at = $$', new Date());
      if (opts.completed_at)           set('completed_at = $$', new Date());
      if (opts.archived_at)            set('archived_at = $$', new Date());
      if (opts.error_class !== undefined)     set('error_class = $$', opts.error_class);
      if (opts.error_message !== undefined)   set('error_message = $$', opts.error_message);
      if (opts.handler_version !== undefined) set('handler_version = $$', opts.handler_version);
      if (opts.summary !== undefined)         set('summary = $$', opts.summary);
      if (opts.traceId !== undefined && opts.traceId !== null) set('trace_id = $$', opts.traceId);
      set('updated_by = $$', opts.userId ?? null);

      const r = await client.query<TaskRow>(
        `UPDATE r_and_d_tasks SET ${setParts.join(', ')}
          WHERE id = $1 AND status = $${i++} AND deleted_at IS NULL
          RETURNING *`,
        [...params, fromStatus]
      );
      const updated = r.rows[0] ?? null;
      if (!updated) return null; // status drift — caller will reload and retry / report

      await this.appendEventRaw(
        id,
        eventType,
        fromStatus,
        toStatus,
        opts.userId,
        opts.traceId ?? null,
        { ...opts.payload, ...(opts.message ? { message: opts.message } : {}) },
        client,
        opts.message
      );

      return updated;
    });
  }

  async softDelete(id: string, userId?: string): Promise<boolean> {
    const r = await this.pool.query(
      `UPDATE r_and_d_tasks SET deleted_at = NOW(), updated_by = $2
        WHERE id = $1 AND deleted_at IS NULL`,
      [id, userId ?? null]
    );
    return (r.rowCount ?? 0) > 0;
  }

  // -------------------------- inputs --------------------------

  async addInput(taskId: string, body: AttachInputBody, userId?: string, client?: PoolClient): Promise<InputRow> {
    const exec = client ?? this.pool;
    const r = await exec.query<InputRow>(
      `INSERT INTO r_and_d_task_inputs
         (task_id, input_type, payload, raw_text, attachment_url, attachment_mime, is_primary, metadata, created_by)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
       RETURNING *`,
      [
        taskId, body.input_type, body.payload ?? {}, body.raw_text ?? null,
        body.attachment_url ?? null, body.attachment_mime ?? null,
        body.is_primary ?? false, body.metadata ?? {}, userId ?? null,
      ]
    );
    if (body.is_primary) await this.demoteOtherInputs(taskId, r.rows[0]!.id, exec);
    return r.rows[0]!;
  }

  async listInputs(taskId: string): Promise<InputRow[]> {
    const r = await this.pool.query<InputRow>(
      `SELECT * FROM r_and_d_task_inputs WHERE task_id = $1 ORDER BY created_at DESC`,
      [taskId]
    );
    return r.rows;
  }

  async findPrimaryInput(taskId: string, client?: Pool | PoolClient): Promise<InputRow | null> {
    const exec = client ?? this.pool;
    const r = await exec.query<InputRow>(
      `SELECT * FROM r_and_d_task_inputs WHERE task_id = $1 AND is_primary = TRUE
        ORDER BY created_at DESC LIMIT 1`,
      [taskId]
    );
    return r.rows[0] ?? null;
  }

  private async demoteOtherInputs(taskId: string, keepId: string, client: Pool | PoolClient): Promise<void> {
    await client.query(
      `UPDATE r_and_d_task_inputs SET is_primary = FALSE WHERE task_id = $1 AND id <> $2`,
      [taskId, keepId]
    );
  }

  // -------------------------- outputs --------------------------

  async addOutput(taskId: string, body: AttachOutputBody, userId?: string, client?: PoolClient): Promise<OutputRow> {
    const exec = client ?? this.pool;
    const r = await exec.query<OutputRow>(
      `INSERT INTO r_and_d_task_outputs
         (task_id, output_type, payload, summary, attachment_url, attachment_mime,
          model_version_id, feature_set_version, confidence, is_primary, metadata, created_by)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12)
       RETURNING *`,
      [
        taskId, body.output_type, body.payload ?? {}, body.summary ?? null,
        body.attachment_url ?? null, body.attachment_mime ?? null,
        body.model_version_id ?? null, body.feature_set_version ?? null,
        body.confidence ?? null, body.is_primary ?? false, body.metadata ?? {},
        userId ?? null,
      ]
    );
    if (body.is_primary) await this.demoteOtherOutputs(taskId, r.rows[0]!.id, exec);
    return r.rows[0]!;
  }

  async listOutputs(taskId: string): Promise<OutputRow[]> {
    const r = await this.pool.query<OutputRow>(
      `SELECT * FROM r_and_d_task_outputs WHERE task_id = $1 ORDER BY generated_at DESC`,
      [taskId]
    );
    return r.rows;
  }

  private async demoteOtherOutputs(taskId: string, keepId: string, client: Pool | PoolClient): Promise<void> {
    await client.query(
      `UPDATE r_and_d_task_outputs SET is_primary = FALSE WHERE task_id = $1 AND id <> $2`,
      [taskId, keepId]
    );
  }

  // -------------------------- events --------------------------

  /**
   * INTERNAL — write an event row. Public callers should go through
   * service.ts which emits events alongside state transitions.
   */
  async appendEventRaw(
    taskId: string,
    event_type: EventType,
    from_status: string | null,
    to_status: string | null,
    actor_id: string | undefined,
    trace_id: string | null,
    payload: Record<string, unknown>,
    client?: Pool | PoolClient,
    message?: string
  ): Promise<EventRow> {
    const exec = client ?? this.pool;
    const r = await exec.query<EventRow>(
      `INSERT INTO r_and_d_task_events
         (task_id, event_type, from_status, to_status, actor_id, trace_id, message, payload)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8)
       RETURNING *`,
      [taskId, event_type, from_status, to_status, actor_id ?? null, trace_id, message ?? null, payload]
    );
    return r.rows[0]!;
  }

  async listEvents(taskId: string, limit = 200): Promise<EventRow[]> {
    const r = await this.pool.query<EventRow>(
      `SELECT * FROM r_and_d_task_events WHERE task_id = $1 ORDER BY occurred_at DESC, id DESC LIMIT $2`,
      [taskId, Math.min(1000, Math.max(1, limit))]
    );
    return r.rows;
  }

  // -------------------------- templates --------------------------

  async listTemplates(taskType?: AiTaskType): Promise<TemplateRow[]> {
    const params: unknown[] = [];
    const where: string[] = ['deleted_at IS NULL', 'is_active = TRUE'];
    if (taskType) {
      where.push(`task_type = $1`);
      params.push(taskType);
    }
    const r = await this.pool.query<TemplateRow>(
      `SELECT id, code, name, task_type, description, input_schema, default_payload, example_payload, is_active
         FROM r_and_d_task_templates
        WHERE ${where.join(' AND ')}
        ORDER BY task_type, display_order, code`,
      params
    );
    return r.rows;
  }

  async findTemplateByCode(code: string): Promise<TemplateRow | null> {
    const r = await this.pool.query<TemplateRow>(
      `SELECT id, code, name, task_type, description, input_schema, default_payload, example_payload, is_active
         FROM r_and_d_task_templates WHERE code = $1 AND deleted_at IS NULL LIMIT 1`,
      [code]
    );
    return r.rows[0] ?? null;
  }

  async findTemplateById(id: string): Promise<TemplateRow | null> {
    const r = await this.pool.query<TemplateRow>(
      `SELECT id, code, name, task_type, description, input_schema, default_payload, example_payload, is_active
         FROM r_and_d_task_templates WHERE id = $1 AND deleted_at IS NULL LIMIT 1`,
      [id]
    );
    return r.rows[0] ?? null;
  }
}
