import { describe, it, expect } from 'vitest';
import {
  assertTrainingJobTransition,
  assertVersionTransition,
  canTransitionTrainingJob,
  canTransitionVersion,
  isTerminalTrainingStatus,
} from '../../../src/modules/ml/state-machine.js';

describe('training job state machine', () => {
  it('allows the canonical happy path', () => {
    expect(canTransitionTrainingJob('queued', 'provisioning')).toBe(true);
    expect(canTransitionTrainingJob('queued', 'running')).toBe(true);
    expect(canTransitionTrainingJob('provisioning', 'running')).toBe(true);
    expect(canTransitionTrainingJob('running', 'succeeded')).toBe(true);
  });
  it('allows failure from any working state', () => {
    expect(canTransitionTrainingJob('provisioning', 'failed')).toBe(true);
    expect(canTransitionTrainingJob('running', 'failed')).toBe(true);
    expect(canTransitionTrainingJob('running', 'timeout')).toBe(true);
  });
  it('terminal states do not transition further', () => {
    for (const from of ['succeeded', 'failed', 'cancelled', 'timeout'] as const) {
      for (const to of ['running', 'queued', 'provisioning'] as const) {
        expect(canTransitionTrainingJob(from, to)).toBe(false);
      }
    }
  });
  it('asserts throw on illegal transitions', () => {
    expect(() => assertTrainingJobTransition('queued', 'succeeded')).toThrow();
  });
  it('isTerminalTrainingStatus correctly identifies terminal states', () => {
    for (const s of ['succeeded', 'failed', 'cancelled', 'timeout'] as const) {
      expect(isTerminalTrainingStatus(s)).toBe(true);
    }
    for (const s of ['queued', 'running', 'provisioning'] as const) {
      expect(isTerminalTrainingStatus(s)).toBe(false);
    }
  });
});

describe('model version state machine', () => {
  it('allows staged → active', () => {
    expect(canTransitionVersion('staged', 'active')).toBe(true);
    expect(canTransitionVersion('staged', 'shadow')).toBe(true);
  });
  it('active can be retired or rolled back', () => {
    expect(canTransitionVersion('active', 'retired')).toBe(true);
    expect(canTransitionVersion('active', 'rolled_back')).toBe(true);
    expect(canTransitionVersion('active', 'shadow')).toBe(true);
  });
  it('rolled_back can be re-activated for emergencies', () => {
    expect(canTransitionVersion('rolled_back', 'active')).toBe(true);
  });
  it('rejects nonsensical transitions', () => {
    expect(canTransitionVersion('staged', 'rolled_back')).toBe(false);
    expect(() => assertVersionTransition('staged', 'rolled_back')).toThrow();
  });
});
