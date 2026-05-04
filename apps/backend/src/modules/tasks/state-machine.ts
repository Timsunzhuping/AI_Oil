import type { AiWorkflowStatus, EventType } from './types.js';

/**
 * Pure state machine for AI workflow tasks.
 *
 *   draft     → submitted | cancelled
 *   submitted → processing | cancelled
 *   processing → completed | failed
 *   completed | failed | cancelled → archived
 *   archived  → restored (back to the prior terminal status)
 *
 * The machine is INFORMATIONAL only — it advises the service layer.
 * Persistence guards are in `service.ts`. Tests target this module directly.
 */

export type TaskAction =
  | 'submit'
  | 'pickup'
  | 'complete'
  | 'fail'
  | 'cancel'
  | 'archive'
  | 'restore';

interface Transition {
  from: AiWorkflowStatus;
  to: AiWorkflowStatus;
  event: EventType;
}

const TRANSITIONS: Record<TaskAction, Transition[]> = {
  submit: [
    { from: 'draft', to: 'submitted', event: 'submitted' },
  ],
  pickup: [
    { from: 'submitted', to: 'processing', event: 'processing_started' },
    // Allow re-pickup of a stuck retry (manual override path)
    { from: 'failed', to: 'processing', event: 'retry' },
  ],
  complete: [
    { from: 'processing', to: 'completed', event: 'completed' },
  ],
  fail: [
    { from: 'processing', to: 'failed', event: 'failed' },
    // Submitted → failed is allowed for handler-level pre-flight rejection
    { from: 'submitted', to: 'failed', event: 'failed' },
  ],
  cancel: [
    { from: 'draft', to: 'cancelled', event: 'cancelled' },
    { from: 'submitted', to: 'cancelled', event: 'cancelled' },
  ],
  archive: [
    { from: 'completed', to: 'archived', event: 'archived' },
    { from: 'failed', to: 'archived', event: 'archived' },
    { from: 'cancelled', to: 'archived', event: 'archived' },
  ],
  restore: [
    // `to` here is a placeholder; `restoreTarget()` reads the prior status.
    { from: 'archived', to: 'completed', event: 'restored' },
  ],
};

export function isValidStatus(s: string): s is AiWorkflowStatus {
  return ['draft','submitted','processing','completed','failed','cancelled','archived'].includes(s);
}

export function nextTransition(action: TaskAction, current: AiWorkflowStatus): Transition | null {
  const candidates = TRANSITIONS[action];
  return candidates.find((t) => t.from === current) ?? null;
}

export function canTransition(action: TaskAction, current: AiWorkflowStatus): boolean {
  return nextTransition(action, current) !== null;
}

export function allowedActions(current: AiWorkflowStatus): TaskAction[] {
  const out: TaskAction[] = [];
  for (const [action, transitions] of Object.entries(TRANSITIONS) as Array<[TaskAction, Transition[]]>) {
    if (transitions.some((t) => t.from === current)) out.push(action);
  }
  return out;
}

/**
 * Compute the "restored" target status from the most recent terminal status
 * recorded in the event log. Falls back to 'completed' when no record found.
 */
export function restoreTargetFromEvents(
  events: Array<{ to_status: string | null }>
): AiWorkflowStatus {
  for (const e of events) {
    if (!e.to_status) continue;
    if (e.to_status === 'completed' || e.to_status === 'failed' || e.to_status === 'cancelled') {
      return e.to_status;
    }
  }
  return 'completed';
}

/**
 * Required-field guard for each action. Returns null when valid, or a
 * message when the task is missing prerequisites.
 *
 * The service layer also enforces these (we keep the guard pure for tests).
 */
export interface GuardSubject {
  status: AiWorkflowStatus;
  has_primary_input: boolean;
  has_template: boolean;
  task_type: string;
}

export function guardAction(action: TaskAction, subject: GuardSubject): string | null {
  switch (action) {
    case 'submit':
      if (subject.status !== 'draft') return `Cannot submit from status '${subject.status}'`;
      if (!subject.has_primary_input) return 'Cannot submit without a primary input';
      return null;
    case 'pickup':
      if (subject.status !== 'submitted' && subject.status !== 'failed')
        return `Cannot pickup from status '${subject.status}'`;
      return null;
    case 'complete':
      if (subject.status !== 'processing') return `Cannot complete from status '${subject.status}'`;
      return null;
    case 'fail':
      if (subject.status !== 'processing' && subject.status !== 'submitted')
        return `Cannot fail from status '${subject.status}'`;
      return null;
    case 'cancel':
      if (subject.status !== 'draft' && subject.status !== 'submitted')
        return `Cannot cancel from status '${subject.status}'`;
      return null;
    case 'archive':
      if (!['completed','failed','cancelled'].includes(subject.status))
        return `Cannot archive from status '${subject.status}' — must be terminal`;
      return null;
    case 'restore':
      if (subject.status !== 'archived') return `Cannot restore from status '${subject.status}'`;
      return null;
    default:
      return `Unknown action '${action as string}'`;
  }
}
