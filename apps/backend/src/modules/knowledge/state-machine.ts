/**
 * Document & parse-task state machines.
 *
 * Document lifecycle:
 *
 *   uploaded ── /parse ──▶ parsing ──(succeed)──▶ parsed ── (auto) ──▶ review
 *      │                       │                                          │
 *      │                       └─(fail final)──▶ parsed (with failed task) ──▶ retry /parse
 *      │                                                                  │
 *      │                                                                  ▼
 *      │                                                          confirmed | rejected
 *      └────────────────────── any time ──────────────────────────▶ archived
 *
 * Parse-task lifecycle:
 *
 *   queued ──▶ processing ──▶ succeeded
 *                          └▶ failed (terminal unless retried by enqueueing a NEW task)
 *   queued ──▶ cancelled
 */
import type { DocumentStatus, ParseTaskStatus } from './types.js';

// ─── document_records ──────────────────────────────────────────────────────

const DOC_TRANSITIONS: Record<DocumentStatus, DocumentStatus[]> = {
  uploaded: ['parsing', 'archived'],
  parsing: ['parsed', 'review', 'archived'],
  parsed: ['parsing', 'review', 'archived'],
  review: ['parsing', 'confirmed', 'rejected', 'archived'],
  confirmed: ['archived', 'review'], // re-open for editing
  rejected: ['parsing', 'review', 'archived'],
  archived: [],
};

export function canTransitionDocument(from: DocumentStatus, to: DocumentStatus): boolean {
  return DOC_TRANSITIONS[from]?.includes(to) ?? false;
}

export function assertDocumentTransition(from: DocumentStatus, to: DocumentStatus): void {
  if (!canTransitionDocument(from, to)) {
    throw new Error(`Illegal document transition ${from} → ${to}`);
  }
}

// ─── document_parse_tasks ─────────────────────────────────────────────────

const TASK_TRANSITIONS: Record<ParseTaskStatus, ParseTaskStatus[]> = {
  queued: ['processing', 'cancelled'],
  processing: ['succeeded', 'failed'],
  succeeded: [],
  failed: [],
  cancelled: [],
};

export function canTransitionTask(from: ParseTaskStatus, to: ParseTaskStatus): boolean {
  return TASK_TRANSITIONS[from]?.includes(to) ?? false;
}

export function assertTaskTransition(from: ParseTaskStatus, to: ParseTaskStatus): void {
  if (!canTransitionTask(from, to)) {
    throw new Error(`Illegal parse-task transition ${from} → ${to}`);
  }
}
