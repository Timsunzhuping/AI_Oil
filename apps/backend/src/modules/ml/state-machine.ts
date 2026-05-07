/**
 * State machines for the MLOps platform.
 *
 *   training_job:    queued ─▶ provisioning ─▶ running ─▶ succeeded
 *                                                        │
 *                                                        ├─▶ failed
 *                                                        ├─▶ cancelled
 *                                                        └─▶ timeout
 *
 *   model_version:   staged ─▶ active ─▶ retired
 *                       │       │       └─▶ rolled_back
 *                       │       └─▶ shadow ─▶ retired
 *                       └─▶ retired
 */
import type { ModelVersionDeploymentStatus, TrainingJobStatus } from './types.js';

const TRAINING_TRANSITIONS: Record<TrainingJobStatus, TrainingJobStatus[]> = {
  queued: ['provisioning', 'running', 'cancelled'],
  provisioning: ['running', 'failed', 'cancelled', 'timeout'],
  running: ['succeeded', 'failed', 'cancelled', 'timeout'],
  succeeded: [],
  failed: [],
  cancelled: [],
  timeout: [],
};

export function canTransitionTrainingJob(from: TrainingJobStatus, to: TrainingJobStatus): boolean {
  return TRAINING_TRANSITIONS[from]?.includes(to) ?? false;
}

export function assertTrainingJobTransition(from: TrainingJobStatus, to: TrainingJobStatus): void {
  if (!canTransitionTrainingJob(from, to)) {
    throw new Error(`Illegal training job transition ${from} → ${to}`);
  }
}

export function isTerminalTrainingStatus(s: TrainingJobStatus): boolean {
  return s === 'succeeded' || s === 'failed' || s === 'cancelled' || s === 'timeout';
}

const VERSION_TRANSITIONS: Record<ModelVersionDeploymentStatus, ModelVersionDeploymentStatus[]> = {
  staged: ['active', 'shadow', 'retired'],
  active: ['shadow', 'retired', 'rolled_back'],
  shadow: ['active', 'retired'],
  retired: ['active', 'shadow'], // un-retire is allowed for emergencies
  rolled_back: ['active', 'staged', 'retired'],
};

export function canTransitionVersion(
  from: ModelVersionDeploymentStatus,
  to: ModelVersionDeploymentStatus
): boolean {
  return VERSION_TRANSITIONS[from]?.includes(to) ?? false;
}

export function assertVersionTransition(
  from: ModelVersionDeploymentStatus,
  to: ModelVersionDeploymentStatus
): void {
  if (!canTransitionVersion(from, to)) {
    throw new Error(`Illegal model-version transition ${from} → ${to}`);
  }
}
