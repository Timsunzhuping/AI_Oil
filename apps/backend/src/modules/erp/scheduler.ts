/**
 * ERP background scheduler.
 *
 * Runs declarative interval-based jobs. Each entry triggers a service call
 * (e.g. `sap_bom_sync` every 30 min). The service handles retry + audit,
 * so the scheduler is dumb — it just calls `service.X()` on a timer.
 *
 * Production deployments should swap this for k8s CronJob / Temporal /
 * BullMQ; for in-process testing and small deployments the timer is fine.
 */
import type { Logger } from 'pino';
import type { ErpService } from './service.js';
import type { SapSyncRequest } from './types.js';

export type ScheduleOperation = 'sap_bom_sync' | 'sap_cost_sync' | 'sap_inventory_sync';

export interface ScheduleEntry {
  /** Stable label for log lines. */
  name: string;
  operation: ScheduleOperation;
  /** Polling interval in milliseconds. */
  intervalMs: number;
  /** Forwarded to `service.syncBom/syncCost/syncInventory`. */
  request?: SapSyncRequest;
  /** Trace prefix for these scheduled calls. */
  traceTag?: string;
}

export interface ErpSchedulerDeps {
  service: ErpService;
  logger: Logger;
  schedule: ScheduleEntry[];
}

export class ErpScheduler {
  private timers: NodeJS.Timeout[] = [];
  private running = new Set<string>();

  constructor(private readonly deps: ErpSchedulerDeps) {}

  start(): void {
    if (this.timers.length > 0) return;
    for (const entry of this.deps.schedule) {
      const timer = setInterval(() => this.tick(entry), entry.intervalMs);
      timer.unref?.();
      this.timers.push(timer);
      this.deps.logger.info(
        { name: entry.name, operation: entry.operation, intervalMs: entry.intervalMs },
        'ERP scheduler entry registered'
      );
    }
  }

  stop(): void {
    for (const t of this.timers) clearInterval(t);
    this.timers = [];
  }

  /** Run every entry once immediately — used by /erp/jobs/run-all (admin) or tests. */
  async runAllOnce(): Promise<void> {
    for (const entry of this.deps.schedule) {
      await this.tick(entry);
    }
  }

  // ── internals ──────────────────────────────────────────────────

  private async tick(entry: ScheduleEntry): Promise<void> {
    if (this.running.has(entry.name)) return; // skip overlapping runs
    this.running.add(entry.name);
    const traceId = `${entry.traceTag ?? 'erp.scheduler'}.${entry.name}.${Date.now()}`;
    try {
      const ctx = { trace_id: traceId, user_id: null };
      const req = entry.request ?? {};
      switch (entry.operation) {
        case 'sap_bom_sync':
          await this.deps.service.syncBom(req, ctx);
          break;
        case 'sap_cost_sync':
          await this.deps.service.syncCost(req, ctx);
          break;
        case 'sap_inventory_sync':
          await this.deps.service.syncInventory(req, ctx);
          break;
      }
    } catch (err) {
      this.deps.logger.warn({ err, name: entry.name }, 'ERP scheduled task failed');
    } finally {
      this.running.delete(entry.name);
    }
  }
}
