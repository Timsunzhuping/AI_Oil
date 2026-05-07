/**
 * React Query hooks wrapping `lib/api/adapters.ts`. Centralised here so query
 * keys are consistent across the app and invalidations target a single
 * source of truth.
 */
import { useMutation, useQuery, useQueryClient, type UseQueryOptions } from '@tanstack/react-query';
import {
  askKnowledge,
  createTask,
  getComparison,
  getForwardResult,
  getFormulaDiff,
  getInverseResult,
  getTask,
  listTasks,
  listTemplates,
  requestExport,
  type ExportRequest,
  type ExportResult,
} from '../api/adapters';
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
} from '../api/types';

export const queryKeys = {
  tasks: (filters: { status?: TaskStatus; task_type?: TaskType; page?: number } = {}) =>
    ['tasks', filters] as const,
  task: (id: string) => ['tasks', id] as const,
  forward: (id: string) => ['tasks', id, 'forward'] as const,
  inverse: (id: string) => ['tasks', id, 'inverse'] as const,
  comparison: (scenarioIds: string[]) => ['comparison', [...scenarioIds].sort()] as const,
  diff: (base: string, target: string) => ['diff', base, target] as const,
  templates: (q?: string) => ['templates', q ?? ''] as const,
  knowledge: (question: string) => ['knowledge', question] as const,
};

// ────────────────────────────────────────────────────────────────────────────
export function useTasks(
  filters: { status?: TaskStatus; task_type?: TaskType; page?: number } = {},
  options?: Partial<UseQueryOptions<PaginatedData<TaskSummary>>>,
) {
  return useQuery({
    queryKey: queryKeys.tasks(filters),
    queryFn: () => listTasks(filters),
    staleTime: 15_000,
    ...options,
  });
}

export function useTask(id: string | undefined) {
  return useQuery({
    queryKey: id ? queryKeys.task(id) : ['tasks', 'noop'],
    queryFn: () => getTask(id!),
    enabled: Boolean(id),
  });
}

export function useCreateTask() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (input: CreateTaskInput): Promise<TaskDetail> => createTask(input),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['tasks'] });
    },
  });
}

// ────────────────────────────────────────────────────────────────────────────
export function useForwardResult(id: string | undefined) {
  return useQuery({
    queryKey: id ? queryKeys.forward(id) : ['forward', 'noop'],
    queryFn: () => getForwardResult(id!),
    enabled: Boolean(id),
  }) as ReturnType<typeof useQuery<ForwardPredictionPayload>>;
}

export function useInverseResult(id: string | undefined) {
  return useQuery({
    queryKey: id ? queryKeys.inverse(id) : ['inverse', 'noop'],
    queryFn: () => getInverseResult(id!),
    enabled: Boolean(id),
  }) as ReturnType<typeof useQuery<InverseRecommendationPayload>>;
}

export function useComparison(scenarioIds: string[]) {
  return useQuery({
    queryKey: queryKeys.comparison(scenarioIds),
    queryFn: () => getComparison(scenarioIds),
    enabled: scenarioIds.length > 0,
  }) as ReturnType<typeof useQuery<ComparisonPayload>>;
}

export function useFormulaDiff(base: string | undefined, target: string | undefined) {
  return useQuery({
    queryKey: base && target ? queryKeys.diff(base, target) : ['diff', 'noop'],
    queryFn: () => getFormulaDiff(base!, target!),
    enabled: Boolean(base && target),
  }) as ReturnType<typeof useQuery<FormulaVersionDiffPayload>>;
}

export function useTemplates(query: string) {
  return useQuery({
    queryKey: queryKeys.templates(query),
    queryFn: () => listTemplates(query),
    staleTime: 60_000,
  }) as ReturnType<typeof useQuery<FormulaTemplate[]>>;
}

export function useAskKnowledge() {
  return useMutation({
    mutationFn: (question: string): Promise<KnowledgeQaPayload> => askKnowledge(question),
  });
}

export function useRequestExport() {
  return useMutation({
    mutationFn: (req: ExportRequest): Promise<ExportResult> => requestExport(req),
  });
}
