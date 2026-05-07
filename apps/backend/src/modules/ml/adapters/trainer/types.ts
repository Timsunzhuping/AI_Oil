/**
 * Trainer adapter contract.
 *
 * The platform service runs a training job by handing the input to a
 * `TrainerAdapter`. Concrete implementations:
 *   • MockTrainerAdapter   — deterministic, instant-return; tests + demo
 *   • LocalTrainerAdapter  — in-process simple regressor; no external infra
 *   • (future)             — k8s / sagemaker / databricks / vertex client
 *
 * The contract is intentionally narrow: `train` returns when the run is done
 * (success OR failure). Cloud adapters can implement long-poll / webhook
 * semantics by buffering progress callbacks and resolving the promise on
 * terminal status.
 */
import type { MlTaskType, TrainerMode, TrainingConfig } from '../../types.js';

export interface TrainerIdentity {
  name: string; // 'mock-trainer', 'local-trainer', 'sagemaker', …
  version: string;
  mode: TrainerMode;
}

export interface TrainInput {
  /** Trainer-internal stable id; not the DB row id. */
  job_id: string;
  /** Stable id of the dataset (informational; adapter may load by URL). */
  dataset_id: string | null;
  /** Where to find the data. */
  dataset_url: string | null;
  /** Feature spec (from ml_feature_templates.spec). */
  feature_spec?: Record<string, unknown>;
  task_type: MlTaskType;
  config: TrainingConfig;
  /** Trace id propagated for log correlation. */
  trace_id: string;
  /** Optional progress callback. Each call carries 0..100. */
  onProgress?: (pct: number, note?: string) => void | Promise<void>;
}

export interface TrainOutput {
  /** Where the produced artifact lives. */
  artifact_url: string;
  artifact_hash: string;
  artifact_size_bytes: number;
  framework_version: string;
  hyperparameters: Record<string, unknown>;
  /** Aggregate metrics in {metric: value} shape. */
  metrics: Record<string, number>;
  /** What feature spec was actually used (echoed for the version row). */
  features?: Record<string, unknown>;
  output_schema?: Record<string, unknown>;
  /** Optional textual log line(s) to surface in the UI. */
  notes?: string;
}

export interface TrainerAdapter {
  identity(): TrainerIdentity;
  /** Train and resolve when the run reaches a terminal state. */
  train(input: TrainInput): Promise<TrainOutput>;
  /** Cancel an in-flight run. Default impl can be a no-op. */
  cancel?(jobId: string): Promise<void>;
}
