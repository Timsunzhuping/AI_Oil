/**
 * Audit recorder.
 *
 * The recorder is a thin wrapper around `repository.insertAudit()` that:
 *   • computes a shallow `changes` diff from `before_state` / `after_state`
 *   • swallows DB errors (audit-write failure must NEVER break a business call)
 *   • exposes a typed `record()` and shorthand `record<Action>()` helpers
 *
 * Use it from services after a state change has been committed:
 *
 *   await audit.record({
 *     action: 'formula_modification',
 *     resource_type: 'formula',
 *     resource_id: formula.id,
 *     resource_label: formula.name,
 *     before_state: prev,
 *     after_state: next,
 *     ctx: { trace_id, user_id, ... },
 *   });
 */
import type { Logger } from 'pino';
import type { SecurityRepository } from './repository.js';
import type { AuditAction } from './types.js';

export interface AuditRecordCtx {
  trace_id?: string | null;
  user_id?: string | null;
  impersonator_id?: string | null;
  ip_address?: string | null;
  user_agent?: string | null;
  request_method?: string | null;
  request_path?: string | null;
  status_code?: number | null;
  duration_ms?: number | null;
  error_code?: number | null;
  error_message?: string | null;
}

export interface AuditRecord {
  action: AuditAction | string;
  resource_type: string;
  resource_id?: string | null;
  resource_code?: string | null;
  resource_label?: string | null;
  before_state?: Record<string, unknown> | null;
  after_state?: Record<string, unknown> | null;
  metadata?: Record<string, unknown>;
  ctx: AuditRecordCtx;
}

export class AuditRecorder {
  constructor(
    private readonly repository: SecurityRepository,
    private readonly logger: Logger
  ) {}

  async record(event: AuditRecord): Promise<{ id: string } | null> {
    const changes = computeChanges(event.before_state ?? null, event.after_state ?? null);
    try {
      return await this.repository.insertAudit({
        user_id: event.ctx.user_id ?? null,
        impersonator_id: event.ctx.impersonator_id ?? null,
        trace_id: event.ctx.trace_id ?? null,
        action: event.action,
        resource_type: event.resource_type,
        resource_id: event.resource_id ?? null,
        resource_code: event.resource_code ?? null,
        resource_label: event.resource_label ?? null,
        before_state: event.before_state ?? null,
        after_state: event.after_state ?? null,
        changes,
        request_method: event.ctx.request_method ?? null,
        request_path: event.ctx.request_path ?? null,
        status_code: event.ctx.status_code ?? null,
        duration_ms: event.ctx.duration_ms ?? null,
        error_code: event.ctx.error_code ?? null,
        error_message: event.ctx.error_message ?? null,
        ip_address: event.ctx.ip_address ?? null,
        user_agent: event.ctx.user_agent ?? null,
        metadata: event.metadata ?? {},
      });
    } catch (err) {
      this.logger.warn(
        { err, action: event.action, resource_type: event.resource_type },
        'audit insert failed'
      );
      return null;
    }
  }

  /** Shortcut for boolean-outcome events that don't carry diff state. */
  async event(action: AuditAction | string, ctx: AuditRecordCtx, extra?: Partial<AuditRecord>) {
    return this.record({
      action,
      resource_type: extra?.resource_type ?? 'system',
      ...(extra?.resource_id !== undefined ? { resource_id: extra.resource_id } : {}),
      ...(extra?.resource_label !== undefined ? { resource_label: extra.resource_label } : {}),
      ...(extra?.metadata !== undefined ? { metadata: extra.metadata } : {}),
      ctx,
    });
  }
}

// ─── Pure helpers (exported for tests) ──────────────────────────────────────

/**
 * Shallow diff: returns `{ key: { from, to } }` for keys that differ
 * between `before` and `after`. Nested objects are compared by JSON.
 */
export function computeChanges(
  before: Record<string, unknown> | null,
  after: Record<string, unknown> | null
): Record<string, { from: unknown; to: unknown }> | null {
  if (!before && !after) return null;
  const out: Record<string, { from: unknown; to: unknown }> = {};
  const keys = new Set<string>([...Object.keys(before ?? {}), ...Object.keys(after ?? {})]);
  for (const k of keys) {
    const a = before?.[k];
    const b = after?.[k];
    if (!isEqual(a, b)) out[k] = { from: a ?? null, to: b ?? null };
  }
  return Object.keys(out).length === 0 ? null : out;
}

function isEqual(a: unknown, b: unknown): boolean {
  if (a === b) return true;
  if (a === null || b === null) return a === b;
  if (typeof a !== 'object' || typeof b !== 'object') return false;
  return JSON.stringify(a) === JSON.stringify(b);
}
