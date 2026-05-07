/**
 * LIMS business adapter contract.
 *
 *   • createTask  — push semantics: register a new test request with the lab
 *   • pullResult  — pull semantics: fetch the latest status / metric values
 *   • listTasks   — optional sweep used by background reconciliation jobs
 *
 * Real adapters wrap a vendor-specific REST/SOAP API; the mock returns
 * deterministic state per call.
 */
import type {
  AdapterIdentity,
  LimsCreateTaskInput,
  LimsCreateTaskOutput,
  LimsPullResultOutput,
  LimsTaskStatus,
} from '../../types.js';

export interface LimsAdapter {
  identity(): AdapterIdentity;
  testConnection(): Promise<{ ok: boolean; latency_ms: number; details?: Record<string, unknown> }>;

  /** Push a new test request to the lab. */
  createTask(input: LimsCreateTaskInput, ctx: { trace_id: string }): Promise<LimsCreateTaskOutput>;

  /** Pull the current status + result for a previously-created task. */
  pullResult(externalLimsTaskId: string, ctx: { trace_id: string }): Promise<LimsPullResultOutput>;

  /** List tasks the adapter knows about; used by reconciliation. */
  listTasks(
    filter: { status?: LimsTaskStatus; limit?: number },
    ctx: { trace_id: string }
  ): Promise<LimsPullResultOutput[]>;
}
