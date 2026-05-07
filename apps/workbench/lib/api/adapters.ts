/**
 * Mock-or-real adapter layer.
 *
 * When `NEXT_PUBLIC_USE_MOCK=1` (or when the network fetch throws), each
 * function falls back to in-memory mock fixtures. This lets the workbench
 * be developed and demoed standalone while the backend is being integrated.
 *
 * Each function delays mock resolution by a small artificial latency so loading
 * skeletons can be exercised in dev.
 */
import { apiClient, ApiError } from './client';
import {
  MOCK_COMPARISON,
  MOCK_DIFF,
  MOCK_FORWARD,
  MOCK_INVERSE,
  MOCK_KNOWLEDGE_QA,
  MOCK_TASKS,
  MOCK_TASK_DETAIL,
  MOCK_TEMPLATES,
  paginate,
} from './mocks';
import type {
  ComparisonPayload,
  CreateTaskInput,
  FormulaTemplate,
  FormulaVersionDiffPayload,
  ForwardPredictionPayload,
  InverseRecommendationPayload,
  KnowledgeQaPayload,
  PaginatedData,
  TaskDetail,
  TaskStatus,
  TaskSummary,
  TaskType,
} from './types';

const USE_MOCK = process.env.NEXT_PUBLIC_USE_MOCK === '1';

function delay<T>(value: T, ms = 280): Promise<T> {
  return new Promise((r) => setTimeout(() => r(value), ms));
}

/** Run real API call; if mocks are forced or it fails with a network error, fall back. */
async function withFallback<T>(real: () => Promise<T>, mock: () => Promise<T>): Promise<T> {
  if (USE_MOCK) return mock();
  try {
    return await real();
  } catch (err) {
    // Only swallow network/server outages — bubble explicit business errors.
    if (err instanceof ApiError && err.code !== 0 && err.code < 500) throw err;
    if (typeof window !== 'undefined') console.warn('[api] falling back to mock:', err);
    return mock();
  }
}

// ────────────────────────────────────────────────────────────────────────────
// Tasks
// ────────────────────────────────────────────────────────────────────────────
export async function listTasks(params: {
  status?: TaskStatus;
  task_type?: TaskType;
  page?: number;
  pageSize?: number;
} = {}): Promise<PaginatedData<TaskSummary>> {
  return withFallback(
    () => apiClient.get<PaginatedData<TaskSummary>>('/tasks', { query: params }),
    () => {
      const filtered = MOCK_TASKS.filter(
        (t) =>
          (!params.status || t.status === params.status) &&
          (!params.task_type || t.task_type === params.task_type),
      );
      return delay(paginate(filtered, params.page ?? 1, params.pageSize ?? 20));
    },
  );
}

export async function getTask(id: string): Promise<TaskDetail> {
  return withFallback(
    () => apiClient.get<TaskDetail>(`/tasks/${id}`),
    () => delay({ ...MOCK_TASK_DETAIL, id, code: MOCK_TASK_DETAIL.code }),
  );
}

export async function createTask(input: CreateTaskInput): Promise<TaskDetail> {
  return withFallback(
    () => apiClient.post<TaskDetail>('/tasks', input),
    () =>
      delay({
        ...MOCK_TASK_DETAIL,
        id: `t-mock-${Date.now()}`,
        code: `AI-2026-MOCK-${Math.floor(Math.random() * 9000 + 1000)}`,
        title: input.title,
        description: input.description ?? null,
        task_type: input.task_type,
        status: 'submitted',
        priority: input.priority ?? 'medium',
      }),
  );
}

// ────────────────────────────────────────────────────────────────────────────
// Result payloads (selected by output_type on the backend, mocked statically here)
// ────────────────────────────────────────────────────────────────────────────
export async function getForwardResult(taskId: string): Promise<ForwardPredictionPayload> {
  return withFallback(
    () => apiClient.get<ForwardPredictionPayload>(`/tasks/${taskId}/result/forward`),
    () => delay(MOCK_FORWARD),
  );
}

export async function getInverseResult(taskId: string): Promise<InverseRecommendationPayload> {
  return withFallback(
    () => apiClient.get<InverseRecommendationPayload>(`/tasks/${taskId}/result/inverse`),
    () => delay(MOCK_INVERSE),
  );
}

export async function getComparison(scenarioIds: string[]): Promise<ComparisonPayload> {
  return withFallback(
    () => apiClient.post<ComparisonPayload>('/comparison', { scenarioIds }),
    () => {
      const filtered = scenarioIds.length
        ? MOCK_COMPARISON.scenarios.filter((s) => scenarioIds.includes(s.id))
        : MOCK_COMPARISON.scenarios;
      return delay({ ...MOCK_COMPARISON, scenarios: filtered });
    },
  );
}

export async function getFormulaDiff(
  baseVersionId: string,
  targetVersionId: string,
): Promise<FormulaVersionDiffPayload> {
  return withFallback(
    () =>
      apiClient.get<FormulaVersionDiffPayload>(`/formulas/diff`, {
        query: { base: baseVersionId, target: targetVersionId },
      }),
    () => delay(MOCK_DIFF),
  );
}

export async function listTemplates(query?: string): Promise<FormulaTemplate[]> {
  return withFallback(
    () => apiClient.get<FormulaTemplate[]>('/formulas/templates', { query: { q: query } }),
    () => {
      const q = (query ?? '').trim();
      const items = q
        ? MOCK_TEMPLATES.filter(
            (t) =>
              t.name.includes(q) ||
              t.code.toLowerCase().includes(q.toLowerCase()) ||
              t.product_category.includes(q),
          )
        : MOCK_TEMPLATES;
      return delay(items);
    },
  );
}

export async function askKnowledge(question: string): Promise<KnowledgeQaPayload> {
  return withFallback(
    () => apiClient.post<KnowledgeQaPayload>('/knowledge/qa', { question }),
    () => delay({ ...MOCK_KNOWLEDGE_QA, answer: `${MOCK_KNOWLEDGE_QA.answer}\n\n（针对：${question}）` }, 600),
  );
}

// ────────────────────────────────────────────────────────────────────────────
// Export — mock only for now, returns a pretend Blob URL.
// ────────────────────────────────────────────────────────────────────────────
export interface ExportRequest {
  task_id: string;
  format: 'pdf' | 'xlsx' | 'csv';
  include_sources?: boolean;
}

export interface ExportResult {
  url: string;
  filename: string;
  size_bytes: number;
}

export async function requestExport(req: ExportRequest): Promise<ExportResult> {
  return withFallback(
    () => apiClient.post<ExportResult>(`/tasks/${req.task_id}/export`, req),
    () =>
      delay(
        {
          url: 'data:text/plain;charset=utf-8,FluidMind%20mock%20export',
          filename: `fluidmind-${req.task_id}.${req.format}`,
          size_bytes: 12345,
        },
        650,
      ),
  );
}
