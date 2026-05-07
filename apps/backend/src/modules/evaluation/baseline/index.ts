/**
 * Baseline test sets — bundled with the platform so a fresh deployment
 * can run an end-to-end acceptance loop without hand-crafting test data.
 *
 * Use them programmatically:
 *
 *   import { BASELINE_TEST_SETS } from '@/modules/evaluation';
 *   for (const set of BASELINE_TEST_SETS) {
 *     await service.createTestSet(set, { trace_id: 'seed', user_id: null });
 *   }
 *
 * Or via a CLI / migration / startup-time seed script.
 */
import { FORWARD_BASELINE, FORWARD_BASELINE_CASES } from './forward-baseline.js';
import {
  INVERSE_BASELINE,
  INVERSE_BASELINE_CASES,
  STABILITY_BASELINE,
  STABILITY_BASELINE_CASES,
} from './inverse-baseline.js';
import type { TestSetInput } from '../types.js';

export const BASELINE_TEST_SETS: TestSetInput[] = [
  FORWARD_BASELINE,
  INVERSE_BASELINE,
  STABILITY_BASELINE,
];

export {
  FORWARD_BASELINE,
  FORWARD_BASELINE_CASES,
  INVERSE_BASELINE,
  INVERSE_BASELINE_CASES,
  STABILITY_BASELINE,
  STABILITY_BASELINE_CASES,
};
