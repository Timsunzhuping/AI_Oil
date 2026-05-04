import { describe, it, expect } from 'vitest';
import {
  allowedActions,
  canTransition,
  guardAction,
  nextTransition,
  restoreTargetFromEvents,
} from '../../../src/modules/tasks/state-machine.js';

describe('state-machine.canTransition / nextTransition', () => {
  it('allows the canonical happy-path transitions', () => {
    expect(canTransition('submit',  'draft')).toBe(true);
    expect(canTransition('pickup',  'submitted')).toBe(true);
    expect(canTransition('complete','processing')).toBe(true);
  });

  it('disallows nonsensical transitions', () => {
    expect(canTransition('submit',   'completed')).toBe(false);
    expect(canTransition('complete', 'draft')).toBe(false);
    expect(canTransition('archive',  'draft')).toBe(false);
    expect(canTransition('cancel',   'completed')).toBe(false);
  });

  it('allows pickup from failed (retry), and fail from submitted (pre-flight reject)', () => {
    expect(canTransition('pickup', 'failed')).toBe(true);
    expect(canTransition('fail',   'submitted')).toBe(true);
  });

  it('archive only from terminal states', () => {
    for (const s of ['completed','failed','cancelled'] as const) {
      expect(canTransition('archive', s)).toBe(true);
    }
    expect(canTransition('archive', 'processing')).toBe(false);
    expect(canTransition('archive', 'submitted')).toBe(false);
  });

  it('nextTransition returns the (from, to, event) triple', () => {
    expect(nextTransition('submit', 'draft')).toEqual({ from: 'draft', to: 'submitted', event: 'submitted' });
    expect(nextTransition('complete', 'processing')).toEqual({ from: 'processing', to: 'completed', event: 'completed' });
    expect(nextTransition('submit', 'completed')).toBeNull();
  });
});

describe('state-machine.allowedActions', () => {
  it('lists what you can do from each status', () => {
    expect(allowedActions('draft').sort()).toEqual(['cancel','submit'].sort());
    expect(allowedActions('submitted').sort()).toEqual(['cancel','fail','pickup'].sort());
    expect(allowedActions('processing').sort()).toEqual(['complete','fail'].sort());
    expect(allowedActions('completed').sort()).toEqual(['archive']);
    expect(allowedActions('failed').sort()).toEqual(['archive','pickup'].sort()); // pickup = retry
    expect(allowedActions('archived').sort()).toEqual(['restore']);
  });
});

describe('state-machine.guardAction', () => {
  const base = { has_primary_input: true, has_template: false, task_type: 'forward_prediction' };

  it('rejects submit without an input', () => {
    expect(guardAction('submit', { ...base, status: 'draft', has_primary_input: false }))
      .toMatch(/without a primary input/);
  });

  it('accepts submit when input is present and status=draft', () => {
    expect(guardAction('submit', { ...base, status: 'draft' })).toBeNull();
  });

  it('rejects archive when not in a terminal status', () => {
    expect(guardAction('archive', { ...base, status: 'draft' })).toMatch(/Cannot archive/);
  });

  it('accepts archive from completed/failed/cancelled', () => {
    for (const s of ['completed','failed','cancelled'] as const) {
      expect(guardAction('archive', { ...base, status: s })).toBeNull();
    }
  });

  it('rejects cancel when already terminal', () => {
    expect(guardAction('cancel', { ...base, status: 'completed' })).toMatch(/Cannot cancel/);
    expect(guardAction('cancel', { ...base, status: 'archived' })).toMatch(/Cannot cancel/);
  });
});

describe('state-machine.restoreTargetFromEvents', () => {
  it('returns the most recent terminal status from event log', () => {
    const events = [
      { to_status: 'archived' },
      { to_status: 'failed' },
      { to_status: 'processing' },
      { to_status: 'submitted' },
      { to_status: 'draft' },
    ];
    expect(restoreTargetFromEvents(events)).toBe('failed');
  });

  it('falls back to completed when no terminal status in log', () => {
    expect(restoreTargetFromEvents([{ to_status: 'submitted' }, { to_status: null }])).toBe('completed');
    expect(restoreTargetFromEvents([])).toBe('completed');
  });
});
