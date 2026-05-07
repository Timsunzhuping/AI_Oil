/**
 * Zod schemas for the QA endpoints.
 *
 *   POST /qa/ask                — AskSchema
 *   GET  /qa/history/:sessionId — SessionIdParamSchema
 *   POST /qa/feedback           — FeedbackSchema
 *
 * Validation is conservative: questions are 4..2000 chars (so we don't accept
 * empty or implausibly long inputs that would bust the LLM context window),
 * sessions/messages are UUIDs, ratings are constrained to {-1, 0, 1}.
 */
import { z } from 'zod';

export const AskSchema = z.object({
  question: z.string().trim().min(4, 'question must be at least 4 chars').max(2000),
  product_category: z.string().max(64).optional(),
  session_id: z.string().uuid().optional(),
  max_citations: z.number().int().min(1).max(20).optional(),
  metadata: z.record(z.unknown()).optional(),
});

export const SessionIdParamSchema = z.object({
  sessionId: z.string().uuid(),
});

export const FeedbackSchema = z.object({
  message_id: z.string().uuid(),
  rating: z.union([z.literal(-1), z.literal(0), z.literal(1)]),
  category: z.string().max(64).optional(),
  comment: z.string().max(2000).optional(),
  metadata: z.record(z.unknown()).optional(),
});

export type ParsedAskRequest = z.infer<typeof AskSchema>;
export type ParsedFeedbackRequest = z.infer<typeof FeedbackSchema>;
