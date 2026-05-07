import { describe, it, expect } from 'vitest';
import { buildMenu } from '../../../src/modules/security/menu.js';

describe('buildMenu', () => {
  it('marks entries hidden when permissions are missing', () => {
    const menu = buildMenu(new Set(['task:read']), new Set(['viewer']));
    const dashboard = menu.find((e) => e.key === 'dashboard');
    expect(dashboard?.visible).toBe(true);
    const trainJobs = menu.find((e) => e.key === 'ml_jobs');
    expect(trainJobs?.visible).toBe(false);
  });

  it('researcher gets the R&D tool entries', () => {
    const perms = new Set([
      'task:read',
      'task:write',
      'formula:read',
      'formula:write',
      'predict:execute',
      'recommend:execute',
      'qa:ask',
      'knowledge:read',
    ]);
    const menu = buildMenu(perms, new Set(['researcher']));
    const visibleKeys = menu.filter((e) => e.visible).map((e) => e.key);
    expect(visibleKeys).toEqual(
      expect.arrayContaining(['dashboard', 'tasks', 'tasks_new', 'predict', 'recommend', 'qa'])
    );
  });

  it('viewer only gets a small read-only subset', () => {
    const perms = new Set([
      'task:read',
      'formula:read',
      'qa:ask',
      'knowledge:read',
      'ml:model_read',
      'master_data:read',
    ]);
    const menu = buildMenu(perms, new Set(['viewer']));
    const visibleKeys = menu.filter((e) => e.visible).map((e) => e.key);
    expect(visibleKeys).not.toContain('exports');
    expect(visibleKeys).not.toContain('audit');
  });
});
