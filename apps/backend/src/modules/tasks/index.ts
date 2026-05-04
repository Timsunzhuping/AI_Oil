import type { Pool } from 'pg';
import type { Logger } from 'pino';
import { buildTasksRouter } from './routes.js';

export function buildTasksModule(pool: Pool, logger: Logger) {
  return { router: buildTasksRouter(pool, logger) };
}

export { TaskCenterService } from './service.js';
export { TaskRepository } from './repository.js';
export { HandlerRegistry } from './handlers/index.js';
export {
  canTransition,
  allowedActions,
  guardAction,
  nextTransition,
  restoreTargetFromEvents,
} from './state-machine.js';
export type * from './types.js';
