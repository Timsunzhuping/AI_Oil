import { Badge } from '@/components/ui/badge';
import type { TaskStatus } from '@/lib/api/types';

const STATUS_LABELS: Record<TaskStatus, string> = {
  draft: '草稿',
  submitted: '已提交',
  processing: '处理中',
  completed: '已完成',
  failed: '失败',
  cancelled: '已取消',
  archived: '已归档',
};

const STATUS_VARIANT: Record<TaskStatus, 'default' | 'secondary' | 'destructive' | 'success' | 'warning' | 'info' | 'outline'> = {
  draft: 'outline',
  submitted: 'info',
  processing: 'warning',
  completed: 'success',
  failed: 'destructive',
  cancelled: 'secondary',
  archived: 'secondary',
};

export function TaskStatusBadge({ status }: { status: TaskStatus }) {
  return <Badge variant={STATUS_VARIANT[status]}>{STATUS_LABELS[status]}</Badge>;
}

export const TASK_TYPE_LABELS: Record<string, string> = {
  forward_prediction: '正向预测',
  batch_prediction: '批量预测',
  cost_optimization: '成本优化',
  material_replacement: '原料替代',
  new_product_generation: '新品生成',
  knowledge_qa: '知识问答',
};
