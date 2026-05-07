/**
 * Evaluation service.
 *
 * Coordinates: test-set CRUD, acceptance runs (forward / inverse / stability),
 * persistence, and report export. Adapter dependencies (PredictorAdapter +
 * a recommendation pipeline shape) are injected so the module is independent
 * of the prediction / recommendation modules' internals.
 */
import type { Logger } from 'pino';
import { BadRequestError, NotFoundError } from '../../lib/errors.js';
import type { PredictorAdapter } from '../prediction/adapters/types.js';
import type { EvaluationRepository } from './repository.js';
import {
  runForward,
  runInverse,
  runStability,
  type LimitedRecommendationPipeline,
} from './runners/index.js';
import { renderJson, renderMarkdown } from './reporters/index.js';
import type {
  AcceptanceReport,
  ExportResponse,
  ForwardCase,
  InverseCase,
  ReportEnvelopeBase,
  ResultRow,
  RunConfig,
  RunRequest,
  RunRow,
  RunStatus,
  StabilityCase,
  StabilityTolerance,
  TestSetInput,
  TestSetRow,
  TestSetStatus,
  TestType,
  Tolerance,
  TriggerType,
} from './types.js';

export interface EvaluationServiceDeps {
  repository: EvaluationRepository;
  predictor: PredictorAdapter;
  pipeline: LimitedRecommendationPipeline;
  logger: Logger;
}

interface OpContext {
  trace_id: string | null;
  user_id: string | null;
}

export class EvaluationService {
  constructor(private readonly deps: EvaluationServiceDeps) {}

  // ── test sets ─────────────────────────────────────────────────────
  async createTestSet(input: TestSetInput, ctx: OpContext): Promise<TestSetRow> {
    if (!Array.isArray(input.cases) || input.cases.length === 0) {
      throw new BadRequestError('cases must contain at least one entry');
    }
    const code = input.code ?? (await this.deps.repository.nextTestSetCode());
    return this.deps.repository.createTestSet(input, code, ctx.user_id, ctx.trace_id);
  }

  async getTestSet(id: string): Promise<TestSetRow> {
    const row = await this.deps.repository.findTestSet(id);
    if (!row) throw new NotFoundError('Test set');
    return row;
  }

  async listTestSets(filter: {
    test_type?: TestType;
    status?: TestSetStatus;
    q?: string;
    page: number;
    pageSize: number;
  }) {
    return this.deps.repository.listTestSets(filter);
  }

  // ── acceptance runs ───────────────────────────────────────────────
  async runAcceptance(
    req: RunRequest,
    ctx: OpContext
  ): Promise<{ run: RunRow; results: ResultRow[] }> {
    const testSet = await this.deps.repository.findTestSet(req.test_set_id);
    if (!testSet) throw new NotFoundError('Test set');

    const config: RunConfig = req.config ?? {};
    const cases = config.case_ids
      ? testSet.cases.filter((c) => config.case_ids!.includes((c as { id: string }).id))
      : testSet.cases;
    if (cases.length === 0) throw new BadRequestError('No cases match config.case_ids');

    const code = await this.deps.repository.nextRunCode();
    const modelInfo = this.deps.predictor.info();
    const trigger: TriggerType = req.trigger_type ?? 'manual';

    let run = await this.deps.repository.createRun({
      code,
      test_set_id: testSet.id,
      test_type: testSet.test_type,
      model_code: modelInfo.code,
      model_version: modelInfo.version,
      predictor_mode: modelInfo.mode,
      config,
      trigger_type: trigger,
      triggered_by: ctx.user_id,
      trace_id: ctx.trace_id,
      metadata: req.metadata ?? {},
    });

    const envelope: Omit<
      ReportEnvelopeBase,
      'totals' | 'generated_at' | 'completed_at' | 'duration_ms' | 'status'
    > = {
      run_id: run.id,
      code: run.code,
      test_set_id: testSet.id,
      test_type: testSet.test_type,
      model: { code: modelInfo.code, version: modelInfo.version, mode: modelInfo.mode },
      started_at: run.started_at,
      trace_id: ctx.trace_id,
    };

    try {
      let report: AcceptanceReport;
      let perCase: Array<{
        case_id: string;
        case_index: number;
        category: string | null;
        passed: boolean;
        metrics: Record<string, unknown>;
        expected: unknown;
        predicted: unknown;
        failure_reason: string | null;
        duration_ms: number;
      }>;

      if (testSet.test_type === 'forward') {
        const tolerance: Tolerance = {
          ...(testSet.default_tolerance as Tolerance),
          ...(config.tolerance ?? {}),
        };
        const result = await runForward({
          cases: cases as ForwardCase[],
          tolerance,
          envelope,
          predictor: this.deps.predictor,
          trace_id: ctx.trace_id ?? '',
        });
        report = result.report;
        perCase = result.per_case_results.map((r) => ({
          case_id: r.case_id,
          case_index: r.case_index,
          category: r.category,
          passed: r.passed,
          metrics: r.metrics as unknown as Record<string, unknown>,
          expected: r.expected,
          predicted: r.predicted,
          failure_reason: r.failure_reason,
          duration_ms: r.duration_ms,
        }));
      } else if (testSet.test_type === 'inverse') {
        const result = await runInverse({
          cases: cases as InverseCase[],
          envelope,
          pipeline: this.deps.pipeline,
          trace_id: ctx.trace_id ?? '',
        });
        report = result.report;
        perCase = result.per_case_results.map((r) => ({
          case_id: r.case_id,
          case_index: r.case_index,
          category: r.category,
          passed: r.passed,
          metrics: r.metrics as unknown as Record<string, unknown>,
          expected: r.expectations as unknown,
          predicted: null,
          failure_reason: r.failure_reason,
          duration_ms: r.duration_ms,
        }));
      } else {
        const tolerance: StabilityTolerance = {
          ...(testSet.default_tolerance as StabilityTolerance),
          ...(config.stability_tolerance ?? {}),
        };
        const result = await runStability({
          cases: cases as StabilityCase[],
          tolerance,
          default_runs: config.default_runs ?? 5,
          envelope,
          predictor: this.deps.predictor,
          pipeline: this.deps.pipeline,
          trace_id: ctx.trace_id ?? '',
        });
        report = result.report;
        perCase = result.per_case_results.map((r) => ({
          case_id: r.case_id,
          case_index: r.case_index,
          category: r.category,
          passed: r.passed,
          metrics: r.metrics as unknown as Record<string, unknown>,
          expected: null,
          predicted: null,
          failure_reason: r.failure_reason,
          duration_ms: r.duration_ms,
        }));
      }

      run =
        (await this.deps.repository.finaliseRun(run.id, {
          status: report.status as RunStatus,
          summary: report,
          cases_total: report.totals.cases_total,
          cases_passed: report.totals.cases_passed,
          cases_failed: report.totals.cases_failed,
          duration_ms: report.duration_ms,
        })) ?? run;

      try {
        await this.deps.repository.insertResults(
          run.id,
          perCase.map((p) => ({
            case_id: p.case_id,
            case_index: p.case_index,
            category: p.category,
            passed: p.passed,
            metrics: p.metrics,
            expected: p.expected,
            predicted: p.predicted,
            raw_payload: null,
            failure_reason: p.failure_reason,
            duration_ms: p.duration_ms,
          }))
        );
      } catch (err) {
        this.deps.logger.warn({ err, runId: run.id }, 'failed to persist acceptance_results');
      }
      const results = await this.deps.repository.listResults(run.id);
      return { run, results };
    } catch (err) {
      const e = err as Error;
      await this.deps.repository.finaliseRun(run.id, {
        status: 'failed',
        summary: {
          ...envelope,
          status: 'failed',
          completed_at: new Date().toISOString(),
          duration_ms: 0,
          totals: {
            cases_total: cases.length,
            cases_passed: 0,
            cases_failed: cases.length,
            pass_rate: 0,
          },
          overall_metrics: {},
          generated_at: new Date().toISOString(),
          empty: true,
        } as AcceptanceReport,
        cases_total: cases.length,
        cases_passed: 0,
        cases_failed: cases.length,
        duration_ms: 0,
        error_class: e.name,
        error_message: e.message,
      });
      throw new BadRequestError(`Acceptance run failed: ${e.message}`);
    }
  }

  async getRun(id: string): Promise<{ run: RunRow; results: ResultRow[] }> {
    const run = await this.deps.repository.findRun(id);
    if (!run) throw new NotFoundError('Acceptance run');
    const results = await this.deps.repository.listResults(id);
    return { run, results };
  }

  async listRuns(filter: {
    test_set_id?: string;
    test_type?: TestType;
    status?: RunStatus;
    page: number;
    pageSize: number;
  }) {
    return this.deps.repository.listRuns(filter);
  }

  async exportRun(id: string, format: 'json' | 'markdown'): Promise<ExportResponse> {
    const run = await this.deps.repository.findRun(id);
    if (!run) throw new NotFoundError('Acceptance run');
    return format === 'markdown' ? renderMarkdown(run) : renderJson(run);
  }
}
