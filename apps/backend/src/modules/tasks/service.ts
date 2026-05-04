import { v4 as uuidv4 } from 'uuid';
import type { Logger } from 'pino';
import { withContext } from '../../lib/context.js';
import { BadRequestError, ConflictError, NotFoundError } from '../../lib/errors.js';
import { TaskRepository } from './repository.js';
import { HandlerRegistry } from './handlers/index.js';
import {
  allowedActions,
  canTransition,
  guardAction,
  isValidStatus,
  nextTransition,
  restoreTargetFromEvents,
  type TaskAction,
} from './state-machine.js';
import type {
  AiTaskType,
  AiWorkflowStatus,
  AttachInputBody,
  AttachOutputBody,
  CreateTaskInput,
  EventRow,
  InputRow,
  OutputRow,
  TaskRow,
  TemplateRow,
  UpdateTaskInput,
} from './types.js';

export interface TaskFullView {
  task: TaskRow;
  inputs: InputRow[];
  outputs: OutputRow[];
  recent_events: EventRow[];
  allowed_actions: TaskAction[];
}

/**
 * TaskCenterService — single façade for the task center.
 * Wraps the repository + state machine + handler registry; emits events for
 * every state transition.
 */
export class TaskCenterService {
  constructor(
    private repo: TaskRepository,
    private registry: HandlerRegistry,
    private logger: Logger
  ) {}

  // -------------------------- create / read --------------------------

  async create(input: CreateTaskInput, userId?: string): Promise<TaskRow> {
    if (!isAiTaskType(input.task_type)) {
      throw new BadRequestError(`Unsupported task_type '${input.task_type}'`);
    }
    // If template_id given, ensure it matches the task_type
    if (input.template_id) {
      const tpl = await this.repo.findTemplateById(input.template_id);
      if (!tpl) throw new BadRequestError('template_id does not reference an active template');
      if (tpl.task_type !== input.task_type) {
        throw new BadRequestError(
          `Template '${tpl.code}' is for task_type='${tpl.task_type}', not '${input.task_type}'`
        );
      }
    }
    const task = await this.repo.createTask(input, userId);

    // Optional initial input
    if (input.input) {
      await this.attachInput(
        task.id,
        {
          input_type: input.input.input_type ?? 'structured',
          payload: input.input.payload ?? {},
          ...(input.input.raw_text !== undefined ? { raw_text: input.input.raw_text } : {}),
          is_primary: input.input.is_primary ?? true,
        },
        userId
      );
    }

    return task;
  }

  async get(id: string): Promise<TaskFullView> {
    const task = await this.repo.findById(id);
    if (!task) throw new NotFoundError('Task');
    const [inputs, outputs, events] = await Promise.all([
      this.repo.listInputs(id),
      this.repo.listOutputs(id),
      this.repo.listEvents(id, 50),
    ]);
    const status = isValidStatus(task.status) ? task.status : 'draft';
    return {
      task,
      inputs,
      outputs,
      recent_events: events,
      allowed_actions: allowedActions(status),
    };
  }

  list = (filter: Parameters<TaskRepository['list']>[0]) => this.repo.list(filter);

  // -------------------------- update draft --------------------------

  async updateDraft(id: string, input: UpdateTaskInput, userId?: string): Promise<TaskRow> {
    const cur = await this.repo.findById(id);
    if (!cur) throw new NotFoundError('Task');
    if (cur.status !== 'draft') {
      throw new ConflictError(`Cannot update non-draft task (status='${cur.status}')`);
    }
    const updated = await this.repo.updateDraft(id, input, userId);
    if (!updated) {
      const fresh = await this.repo.findById(id);
      throw new ConflictError(`Version mismatch — current is ${fresh?.version}`);
    }
    await this.repo.appendEventRaw(
      id, 'draft_saved', cur.status, cur.status, userId, cur.trace_id, { keys: Object.keys(input) }
    );
    return updated;
  }

  async remove(id: string, userId?: string): Promise<void> {
    const ok = await this.repo.softDelete(id, userId);
    if (!ok) throw new NotFoundError('Task');
  }

  // -------------------------- inputs / outputs --------------------------

  async attachInput(taskId: string, body: AttachInputBody, userId?: string): Promise<InputRow> {
    const task = await this.repo.findById(taskId);
    if (!task) throw new NotFoundError('Task');
    if (task.status !== 'draft' && task.status !== 'failed') {
      throw new ConflictError(`Cannot attach input to a task in status '${task.status}'`);
    }
    const row = await this.repo.addInput(taskId, body, userId);
    await this.repo.appendEventRaw(
      taskId, 'input_attached', null, null, userId, task.trace_id,
      { input_id: row.id, input_type: row.input_type, is_primary: row.is_primary }
    );
    return row;
  }

  async attachOutput(taskId: string, body: AttachOutputBody, userId?: string): Promise<OutputRow> {
    const task = await this.repo.findById(taskId);
    if (!task) throw new NotFoundError('Task');
    const row = await this.repo.addOutput(taskId, body, userId);
    await this.repo.appendEventRaw(
      taskId, 'output_attached', null, null, userId, task.trace_id,
      {
        output_id: row.id,
        output_type: row.output_type,
        is_primary: row.is_primary,
        ...(body.summary ? { summary: body.summary } : {}),
      }
    );
    return row;
  }

  listInputs   = (id: string) => this.repo.listInputs(id);
  listOutputs  = (id: string) => this.repo.listOutputs(id);
  listEvents   = (id: string, limit?: number) => this.repo.listEvents(id, limit);
  listTemplates = (taskType?: AiTaskType): Promise<TemplateRow[]> => this.repo.listTemplates(taskType);
  findTemplate  = (code: string) => this.repo.findTemplateByCode(code);

  // -------------------------- state transitions --------------------------

  async submit(taskId: string, userId?: string, traceId?: string): Promise<TaskRow> {
    const task = await this.repo.findById(taskId);
    if (!task) throw new NotFoundError('Task');

    const handler = this.registry.resolve(task.task_type as AiTaskType);
    const primary = await this.repo.findPrimaryInput(taskId);
    const guardMsg = guardAction('submit', {
      status: task.status as AiWorkflowStatus,
      has_primary_input: primary !== null,
      has_template: !!task.template_id,
      task_type: task.task_type,
    });
    if (guardMsg) throw new BadRequestError(guardMsg);

    // Validate input shape against handler-specific rules
    const v = handler.validateInput(primary?.payload ?? {}, primary?.raw_text);
    if (!v.ok) throw new BadRequestError(`Input validation failed: ${v.errors.join('; ')}`);

    const trace = traceId ?? task.trace_id ?? uuidv4();
    const transition = nextTransition('submit', task.status as AiWorkflowStatus);
    if (!transition) throw new BadRequestError(`Cannot submit from status '${task.status}'`);

    const submitted = await this.repo.transition(
      taskId, transition.from, transition.to, transition.event,
      { ...(userId !== undefined ? { userId } : {}), traceId: trace, submitted_at: true, handler_version: handler.version }
    );
    if (!submitted) throw new ConflictError('Status drifted; reload and try again');

    // Fire-and-forget execution
    void this.runHandler(submitted.id, trace, userId);

    return submitted;
  }

  async cancel(taskId: string, userId?: string, message?: string): Promise<TaskRow> {
    return this.simpleTransition(taskId, 'cancel', userId, message);
  }

  async archive(taskId: string, userId?: string, message?: string): Promise<TaskRow> {
    return this.simpleTransition(taskId, 'archive', userId, message);
  }

  async restore(taskId: string, userId?: string): Promise<TaskRow> {
    const task = await this.repo.findById(taskId);
    if (!task) throw new NotFoundError('Task');
    if (task.status !== 'archived') throw new BadRequestError(`Cannot restore from status '${task.status}'`);
    const events = await this.repo.listEvents(taskId, 100);
    const target = restoreTargetFromEvents(events);
    const updated = await this.repo.transition(
      taskId, 'archived', target, 'restored',
      { ...(userId !== undefined ? { userId } : {}), traceId: task.trace_id, payload: { restored_to: target } }
    );
    if (!updated) throw new ConflictError('Status drifted during restore');
    return updated;
  }

  /**
   * Manual override for ops — write an event but force a status. Use with care;
   * intended for unsticking a task that's stuck in `processing` due to a crash.
   */
  async manualOverride(
    taskId: string,
    toStatus: AiWorkflowStatus,
    userId: string | undefined,
    reason: string
  ): Promise<TaskRow> {
    const task = await this.repo.findById(taskId);
    if (!task) throw new NotFoundError('Task');
    const updated = await this.repo.transition(
      taskId, task.status, toStatus, 'manual_override',
      { ...(userId !== undefined ? { userId } : {}), traceId: task.trace_id, message: reason, payload: { reason } }
    );
    if (!updated) throw new ConflictError('Status drifted; reload and try again');
    return updated;
  }

  private async simpleTransition(
    taskId: string, action: 'cancel' | 'archive', userId?: string, message?: string
  ): Promise<TaskRow> {
    const task = await this.repo.findById(taskId);
    if (!task) throw new NotFoundError('Task');
    const status = task.status as AiWorkflowStatus;
    const guardMsg = guardAction(action, {
      status, has_primary_input: false, has_template: !!task.template_id, task_type: task.task_type,
    });
    if (guardMsg) throw new BadRequestError(guardMsg);

    const transition = nextTransition(action, status);
    if (!transition) throw new BadRequestError(`Cannot ${action} from status '${status}'`);

    const updated = await this.repo.transition(
      taskId, transition.from, transition.to, transition.event,
      {
        ...(userId !== undefined ? { userId } : {}),
        traceId: task.trace_id,
        ...(message !== undefined ? { message } : {}),
        archived_at: action === 'archive',
      }
    );
    if (!updated) throw new ConflictError('Status drifted');
    return updated;
  }

  // -------------------------- handler run --------------------------

  /**
   * Async fire-and-forget handler execution. Runs out-of-band so the HTTP
   * call returns immediately. Failures are caught and recorded as `failed`
   * with a structured error_message.
   */
  private async runHandler(taskId: string, traceId: string, userId?: string): Promise<void> {
    await withContext({ traceId, startTime: Date.now() }, async () => {
      const log = this.logger.child({ taskId, module: 'tasks' });
      try {
        // Move to processing
        const task = await this.repo.findById(taskId);
        if (!task) return;
        const moved = await this.repo.transition(
          taskId, 'submitted', 'processing', 'processing_started',
          { ...(userId !== undefined ? { userId } : {}), traceId, processing_started_at: true }
        );
        if (!moved) {
          log.warn('task no longer submitted at pickup time');
          return;
        }

        const handler = this.registry.resolve(moved.task_type as AiTaskType);
        const primary = await this.repo.findPrimaryInput(taskId);

        const result = await handler.execute({ task: moved, primaryInput: primary, traceId });

        if (result.success) {
          // Persist outputs
          for (const o of result.outputs) {
            await this.repo.addOutput(taskId, {
              output_type: o.output_type,
              payload: o.payload,
              ...(o.summary !== undefined ? { summary: o.summary } : {}),
              ...(o.confidence !== undefined ? { confidence: o.confidence } : {}),
              ...(o.feature_set_version !== undefined ? { feature_set_version: o.feature_set_version } : {}),
              ...(o.model_version_id !== undefined ? { model_version_id: o.model_version_id } : {}),
              ...(o.is_primary !== undefined ? { is_primary: o.is_primary } : {}),
            }, userId);
          }

          await this.repo.transition(
            taskId, 'processing', 'completed', 'completed',
            {
              ...(userId !== undefined ? { userId } : {}),
              traceId,
              completed_at: true,
              ...(result.summary !== undefined ? { summary: result.summary } : {}),
              payload: { output_count: result.outputs.length },
            }
          );
          log.info({ outputs: result.outputs.length }, 'task completed');
        } else {
          await this.repo.transition(
            taskId, 'processing', 'failed', 'failed',
            {
              ...(userId !== undefined ? { userId } : {}),
              traceId,
              completed_at: true,
              ...(result.error?.class !== undefined ? { error_class: result.error.class } : {}),
              ...(result.error?.message !== undefined ? { error_message: result.error.message } : {}),
              payload: { ...(result.error ? { error: result.error } : {}) },
            }
          );
          log.warn({ err: result.error }, 'task failed (handler-reported)');
        }
      } catch (err) {
        const e = err as Error;
        log.error({ err: e }, 'task handler threw');
        await this.repo.transition(
          taskId, 'processing', 'failed', 'failed',
          {
            ...(userId !== undefined ? { userId } : {}),
            traceId,
            completed_at: true,
            error_class: e.name,
            error_message: e.message,
            payload: { stack: e.stack },
          }
        );
      }
    });
  }
}

function isAiTaskType(s: string): s is AiTaskType {
  return [
    'forward_prediction','batch_prediction','cost_optimization',
    'material_replacement','new_product_generation','knowledge_qa',
  ].includes(s);
}
