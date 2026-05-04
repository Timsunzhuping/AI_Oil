import type { Logger } from 'pino';
import type { IntegrationRepository } from '../repository.js';
import type { JobRunner } from '../job-runner.js';
import type { JobType, Loader, SourceRow } from '../types.js';

export interface SchedulerOptions {
  /** How often the scheduler ticks. Default 30s. */
  tickIntervalMs?: number;
  /** Master switch — when false, `start()` is a no-op. */
  enabled?: boolean;
  /**
   * Factory that returns the right `Loader` for the requested entity_type.
   * The scheduler doesn't know which destination an entity belongs to;
   * the caller wires this in.
   */
  loaderResolver: (entityType: string) => Loader;
}

/**
 * In-process scheduler skeleton.
 *
 * Production-grade orchestration (k8s CronJob, Temporal, Airflow) should
 * replace this with an external trigger that POSTs `/sync` to the API.
 * The interface stays identical, so swapping is contained.
 *
 * Behavior:
 *   - On each `tick()`, it reads `integration_schedules` rows whose
 *     `next_run_at <= now` and `is_active = TRUE`.
 *   - For each row it kicks the JobRunner in fire-and-forget mode.
 *   - On completion (success OR failure), it advances `next_run_at`.
 *   - It also processes `next_retry_at` due rows separately so retry logic
 *     doesn't depend on a schedule row existing.
 */
export class IntegrationScheduler {
  private timer: NodeJS.Timeout | null = null;
  private running = false;
  private stopped = false;

  constructor(
    private repo: IntegrationRepository,
    private runner: JobRunner,
    private logger: Logger,
    private options: SchedulerOptions
  ) {}

  start(): void {
    if (this.options.enabled === false) {
      this.logger.info('IntegrationScheduler disabled (options.enabled=false)');
      return;
    }
    if (this.timer) return;
    const intervalMs = this.options.tickIntervalMs ?? 30_000;
    this.logger.info({ intervalMs }, 'IntegrationScheduler started');
    this.timer = setInterval(() => {
      this.safeTick().catch((err) => this.logger.error({ err }, 'scheduler tick failed'));
    }, intervalMs);

    // Run a tick immediately on start
    void this.safeTick();
  }

  async stop(): Promise<void> {
    this.stopped = true;
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
    // Wait for the in-flight tick to drain
    while (this.running) await new Promise((r) => setTimeout(r, 50));
    this.logger.info('IntegrationScheduler stopped');
  }

  private async safeTick(): Promise<void> {
    if (this.running || this.stopped) return;
    this.running = true;
    try {
      await this.tick();
    } finally {
      this.running = false;
    }
  }

  /**
   * One scheduler iteration:
   *   1. Run all due schedules
   *   2. Run all due retries
   */
  async tick(): Promise<{ scheduledRuns: number; retryRuns: number }> {
    const now = new Date();
    let scheduledRuns = 0;
    let retryRuns = 0;

    const due = await this.repo.findDueSchedules(now);
    for (const s of due) {
      try {
        const source: SourceRow = {
          id: s.source_id as string,
          code: '',
          name: '',
          source_type: s.source_type as SourceRow['source_type'],
          config: {},
          secret_ref: null,
          supported_entities: [],
          default_retry_max: 3,
          default_retry_backoff_ms: 30_000,
          is_active: true,
        };
        // Hydrate full source row
        const fullSrc = await this.repo.findSourceById(source.id);
        if (!fullSrc) {
          this.logger.warn({ source_id: source.id }, 'Schedule references missing source, skipping');
          continue;
        }
        const result = await this.runner.run({
          source: fullSrc,
          entityType: s.entity_type as string,
          jobType: s.job_type as JobType,
          triggerType: 'scheduled',
          loader: this.options.loaderResolver(s.entity_type as string),
        });
        await this.repo.advanceScheduleAfterRun(
          s.id as string,
          result.job_id,
          (s.interval_minutes as number | null) ?? null
        );
        scheduledRuns++;
      } catch (e) {
        this.logger.error({ err: e, schedule_id: s.id }, 'scheduled run failed');
      }
    }

    // Retries (independent of schedules)
    try {
      const retried = await this.runner.runDueRetries(this.options.loaderResolver);
      retryRuns = retried.length;
    } catch (e) {
      this.logger.error({ err: e }, 'retry sweep failed');
    }

    if (scheduledRuns > 0 || retryRuns > 0) {
      this.logger.info({ scheduledRuns, retryRuns }, 'scheduler tick complete');
    }

    return { scheduledRuns, retryRuns };
  }
}
