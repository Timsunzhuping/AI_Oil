'use client';

import * as React from 'react';
import { useRouter } from 'next/navigation';
import { useForm, Controller, type FieldErrors } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { Database, FlaskConical, Leaf, PackageSearch, Settings2, Target, Wallet, X } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { Label } from '@/components/ui/label';
import { Badge } from '@/components/ui/badge';
import { Separator } from '@/components/ui/separator';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { useToast } from '@/components/ui/toast';
import { useCreateTask } from '@/lib/hooks/queries';
import {
  structuredInputSchema,
  structuredInputDefaults,
  type StructuredInputValues,
} from '@/lib/schemas/structured-input';
import type { FormulaTemplate } from '@/lib/api/types';
import { TemplateLoaderDialog } from './template-loader-dialog';

const PRODUCT_CATEGORY_OPTIONS = [
  { value: 'engine_oil_pcmo', label: '乘用车机油' },
  { value: 'engine_oil_hdeo', label: '商用车机油' },
  { value: 'industrial_gear', label: '工业齿轮油' },
  { value: 'turbine', label: '汽轮机油' },
  { value: 'hydraulic', label: '液压油' },
  { value: 'compressor', label: '压缩机油' },
  { value: 'metalworking', label: '金属加工液' },
  { value: 'grease', label: '润滑脂' },
  { value: 'specialty', label: '特种润滑油' },
] as const;

const TASK_TYPE_OPTIONS = [
  { value: 'forward_prediction', label: '正向预测（已知配方推性能）' },
  { value: 'cost_optimization', label: '成本优化' },
  { value: 'material_replacement', label: '原料替代' },
  { value: 'new_product_generation', label: '新品生成' },
] as const;

const PRIORITY_OPTIONS = [
  { value: 'low', label: '低' },
  { value: 'medium', label: '中' },
  { value: 'high', label: '高' },
  { value: 'urgent', label: '紧急' },
] as const;

const BASE_OIL_GROUPS = ['I', 'II', 'III', 'IV', 'V'] as const;

/**
 * 结构化需求输入表单 — 6 个分组：
 *   1. 产品场景  2. 目标性能  3. 成本约束
 *   4. 原料约束  5. 环保 / 法规  6. 工艺约束
 */
export function StructuredForm() {
  const router = useRouter();
  const { toast } = useToast();
  const createTask = useCreateTask();
  const [templateOpen, setTemplateOpen] = React.useState(false);

  const form = useForm<StructuredInputValues>({
    resolver: zodResolver(structuredInputSchema),
    defaultValues: structuredInputDefaults,
    mode: 'onBlur',
  });

  const onPickTemplate = (tpl: FormulaTemplate) => {
    form.setValue('template_id', tpl.id);
    form.setValue('title', form.getValues('title') || `基于「${tpl.name}」的需求`);
    form.setValue('product_scenario.application_scenario', tpl.description ?? '');
    toast({ title: '已加载模板', description: `${tpl.name} (${tpl.code})`, variant: 'success' });
  };

  const onSubmit = (values: StructuredInputValues) => {
    createTask.mutate(
      {
        task_type: values.task_type,
        title: values.title,
        description: values.description,
        priority: values.priority,
        template_id: values.template_id ?? null,
        structured_payload: {
          product_scenario: values.product_scenario,
          performance_targets: values.performance_targets,
          cost_constraint: values.cost_constraint,
          raw_material_constraint: values.raw_material_constraint,
          regulatory_constraint: values.regulatory_constraint,
          process_constraint: values.process_constraint,
        },
      },
      {
        onSuccess: (task) => {
          toast({ title: '任务已提交', description: task.code, variant: 'success' });
          // Navigate to the most likely result page based on task type.
          const resultPath =
            values.task_type === 'forward_prediction'
              ? `/results/forward/${task.id}`
              : `/results/inverse/${task.id}`;
          router.push(resultPath);
        },
        onError: (e) =>
          toast({ title: '提交失败', description: e instanceof Error ? e.message : String(e), variant: 'destructive' }),
      },
    );
  };

  const onError = (errors: FieldErrors<StructuredInputValues>) => {
    toast({
      title: '请检查表单',
      description: '表单仍有未通过校验的字段，已用红色提示框标出。',
      variant: 'destructive',
    });
    if (process.env.NODE_ENV === 'development') console.warn(errors);
  };

  return (
    <>
      <form onSubmit={form.handleSubmit(onSubmit, onError)} className="space-y-6">
        {/* Header card: title, type, priority, template */}
        <Card>
          <CardHeader>
            <CardTitle className="text-base">基础信息</CardTitle>
            <CardDescription>定义任务标题、目标类型与优先级。可选择从历史模板加载。</CardDescription>
          </CardHeader>
          <CardContent className="grid gap-4 lg:grid-cols-2">
            <Field label="任务标题" required error={form.formState.errors.title?.message}>
              <Input {...form.register('title')} placeholder="例如：5W-30 全合成机油 — 目标 KV100 11.0 ± 0.4" />
            </Field>
            <Field label="任务类型" required>
              <Controller
                control={form.control}
                name="task_type"
                render={({ field }) => (
                  <Select value={field.value} onValueChange={field.onChange}>
                    <SelectTrigger><SelectValue /></SelectTrigger>
                    <SelectContent>
                      {TASK_TYPE_OPTIONS.map((o) => (
                        <SelectItem key={o.value} value={o.value}>{o.label}</SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                )}
              />
            </Field>
            <Field label="描述（可选）">
              <Textarea {...form.register('description')} placeholder="补充背景、成功标准、参考样品等。" />
            </Field>
            <div className="grid gap-4 sm:grid-cols-2">
              <Field label="优先级">
                <Controller
                  control={form.control}
                  name="priority"
                  render={({ field }) => (
                    <Select value={field.value} onValueChange={field.onChange}>
                      <SelectTrigger><SelectValue /></SelectTrigger>
                      <SelectContent>
                        {PRIORITY_OPTIONS.map((o) => (
                          <SelectItem key={o.value} value={o.value}>{o.label}</SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  )}
                />
              </Field>
              <Field label="基底模板">
                <div className="flex items-center gap-2">
                  <Button type="button" variant="outline" onClick={() => setTemplateOpen(true)}>
                    <Database className="mr-2 h-4 w-4" /> 加载模板
                  </Button>
                  <Controller
                    control={form.control}
                    name="template_id"
                    render={({ field }) =>
                      field.value ? (
                        <Badge variant="secondary" className="gap-1">
                          {field.value}
                          <button
                            type="button"
                            aria-label="清除模板"
                            onClick={() => form.setValue('template_id', undefined)}
                            className="ml-1 rounded-sm hover:bg-background/40"
                          >
                            <X className="h-3 w-3" />
                          </button>
                        </Badge>
                      ) : (
                        <span className="text-xs text-muted-foreground">未选择</span>
                      )
                    }
                  />
                </div>
              </Field>
            </div>
          </CardContent>
        </Card>

        {/* 1. 产品场景 */}
        <SectionCard
          icon={<PackageSearch className="h-4 w-4" />}
          title="1. 产品场景"
          description="目标产品的种类与使用环境，决定后续模型选取与训练样本范围。"
        >
          <div className="grid gap-4 lg:grid-cols-2">
            <Field label="产品类别" required>
              <Controller
                control={form.control}
                name="product_scenario.product_category"
                render={({ field }) => (
                  <Select value={field.value} onValueChange={field.onChange}>
                    <SelectTrigger><SelectValue placeholder="选择产品类别" /></SelectTrigger>
                    <SelectContent>
                      {PRODUCT_CATEGORY_OPTIONS.map((o) => (
                        <SelectItem key={o.value} value={o.value}>{o.label}</SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                )}
              />
            </Field>
            <Field label="销售区域 / 标准市场">
              <Input {...form.register('product_scenario.region')} placeholder="例如：中国 / 北美 / EU" />
            </Field>
            <Field
              label="应用场景描述"
              required
              error={form.formState.errors.product_scenario?.application_scenario?.message}
              className="lg:col-span-2"
            >
              <Textarea
                rows={3}
                {...form.register('product_scenario.application_scenario')}
                placeholder="例如：高速涡轮增压乘用车，长寿命换油周期 ≥ 1.5 万 km，城市拥堵工况占比高。"
              />
            </Field>
            <Field label="使用温度区间（℃）">
              <div className="grid grid-cols-2 gap-2">
                <Input type="number" step="any" placeholder="最低"
                  {...form.register('product_scenario.service_temperature_min_c')} />
                <Input type="number" step="any" placeholder="最高"
                  {...form.register('product_scenario.service_temperature_max_c')} />
              </div>
            </Field>
          </div>
        </SectionCard>

        {/* 2. 目标性能 */}
        <SectionCard
          icon={<Target className="h-4 w-4" />}
          title="2. 目标性能"
          description="物化关键指标的目标值或范围；空白项交由模型按经验值兜底。"
        >
          <div className="grid gap-4 lg:grid-cols-3">
            <Field label="100℃ 运动黏度 (mm²/s)">
              <Input type="number" step="any" {...form.register('performance_targets.kv_100c')} />
            </Field>
            <Field label="40℃ 运动黏度 (mm²/s)">
              <Input type="number" step="any" {...form.register('performance_targets.kv_40c')} />
            </Field>
            <Field label="黏度指数 (≥)">
              <Input type="number" step="any" {...form.register('performance_targets.viscosity_index_min')} />
            </Field>
            <Field label="倾点 (℃，≤)">
              <Input type="number" step="any" {...form.register('performance_targets.pour_point_max_c')} />
            </Field>
            <Field label="闪点 (℃，≥)">
              <Input type="number" step="any" {...form.register('performance_targets.flash_point_min_c')} />
            </Field>
            <Field label="CCS 测试温度 (℃)">
              <Input type="number" step="any" {...form.register('performance_targets.ccs_temperature_c')} />
            </Field>
            <Field label="CCS 上限 (mPa·s)">
              <Input type="number" step="any" {...form.register('performance_targets.ccs_max_mpa_s')} />
            </Field>
            <Field label="Noack 蒸发损失 (%，≤)">
              <Input type="number" step="any" {...form.register('performance_targets.noack_max_pct')} />
            </Field>
            <Field label="备注" className="lg:col-span-3">
              <Textarea rows={2} {...form.register('performance_targets.notes')} />
            </Field>
          </div>
        </SectionCard>

        {/* 3. 成本约束 */}
        <SectionCard
          icon={<Wallet className="h-4 w-4" />}
          title="3. 成本约束"
          description="单位重量的目标成本与可接受偏差。"
        >
          <div className="grid gap-4 lg:grid-cols-3">
            <Field label="目标成本 (CNY/kg)">
              <Input type="number" step="any" {...form.register('cost_constraint.target_cost_cny_per_kg')} />
            </Field>
            <Field label="成本上限 (CNY/kg)">
              <Input type="number" step="any" {...form.register('cost_constraint.max_cost_cny_per_kg')} />
            </Field>
            <Field label="成本容忍度 (%)">
              <Input type="number" step="any" {...form.register('cost_constraint.cost_tolerance_pct')} />
            </Field>
          </div>
        </SectionCard>

        {/* 4. 原料约束 */}
        <SectionCard
          icon={<FlaskConical className="h-4 w-4" />}
          title="4. 原料约束"
          description="必须使用 / 严禁使用的原料，以及偏好基础油族系。"
        >
          <div className="grid gap-4 lg:grid-cols-2">
            <Controller
              control={form.control}
              name="raw_material_constraint.required_materials"
              render={({ field }) => (
                <TagInputField
                  label="必须使用的原料"
                  helper="按 Enter 添加；可输入原料代码或中文名"
                  values={field.value ?? []}
                  onChange={field.onChange}
                />
              )}
            />
            <Controller
              control={form.control}
              name="raw_material_constraint.forbidden_materials"
              render={({ field }) => (
                <TagInputField
                  label="严禁使用的原料"
                  helper="按 Enter 添加"
                  values={field.value ?? []}
                  onChange={field.onChange}
                />
              )}
            />
            <Controller
              control={form.control}
              name="raw_material_constraint.preferred_base_oil_groups"
              render={({ field }) => (
                <Field label="偏好基础油族系" className="lg:col-span-2">
                  <div className="flex flex-wrap gap-2">
                    {BASE_OIL_GROUPS.map((g) => {
                      const checked = (field.value ?? []).includes(g);
                      return (
                        <button
                          key={g}
                          type="button"
                          onClick={() =>
                            field.onChange(
                              checked
                                ? (field.value ?? []).filter((x) => x !== g)
                                : [...(field.value ?? []), g],
                            )
                          }
                          className={
                            'rounded-full border px-3 py-1 text-xs transition-colors ' +
                            (checked
                              ? 'border-primary bg-primary text-primary-foreground'
                              : 'border-input bg-background hover:bg-accent')
                          }
                        >
                          Group {g}
                        </button>
                      );
                    })}
                  </div>
                </Field>
              )}
            />
          </div>
        </SectionCard>

        {/* 5. 环保 / 法规 */}
        <SectionCard
          icon={<Leaf className="h-4 w-4" />}
          title="5. 环保 / 法规约束"
          description="API / ILSAC / ACEA 等级与有害成分限值；REACH / RoHS 默认开启。"
        >
          <div className="grid gap-4 lg:grid-cols-3">
            <Field label="API 等级">
              <Input placeholder="例如：SP / CK-4" {...form.register('regulatory_constraint.api_grade')} />
            </Field>
            <Field label="ILSAC 等级">
              <Input placeholder="例如：GF-6A" {...form.register('regulatory_constraint.ilsac_grade')} />
            </Field>
            <div className="flex items-center justify-between rounded-md border p-3">
              <div>
                <Label className="text-sm">REACH / RoHS</Label>
                <p className="text-xs text-muted-foreground">默认要求合规，关闭仅作为研究探索使用。</p>
              </div>
              <Controller
                control={form.control}
                name="regulatory_constraint.reach_compliant"
                render={({ field }) => (
                  <input
                    type="checkbox"
                    className="h-4 w-4"
                    checked={Boolean(field.value)}
                    onChange={(e) => field.onChange(e.target.checked)}
                  />
                )}
              />
            </div>
            <Field label="磷含量上限 (wt%)">
              <Input type="number" step="any" {...form.register('regulatory_constraint.max_p_pct')} />
            </Field>
            <Field label="硫含量上限 (wt%)">
              <Input type="number" step="any" {...form.register('regulatory_constraint.max_s_pct')} />
            </Field>
            <Field label="硫酸盐灰分上限 (wt%)">
              <Input type="number" step="any" {...form.register('regulatory_constraint.max_sulfated_ash_pct')} />
            </Field>
            <Controller
              control={form.control}
              name="regulatory_constraint.acea_grades"
              render={({ field }) => (
                <TagInputField
                  label="ACEA 等级"
                  helper="如 A3/B4、C3"
                  values={field.value ?? []}
                  onChange={field.onChange}
                />
              )}
            />
            <Controller
              control={form.control}
              name="regulatory_constraint.oem_specs"
              render={({ field }) => (
                <TagInputField
                  label="OEM 规格"
                  helper="如 MB 229.5、VW 504 00"
                  values={field.value ?? []}
                  onChange={field.onChange}
                />
              )}
            />
          </div>
        </SectionCard>

        {/* 6. 工艺约束 */}
        <SectionCard
          icon={<Settings2 className="h-4 w-4" />}
          title="6. 工艺约束"
          description="生产端的可执行性约束 — 调和温度、过滤精度、包装规格等。"
        >
          <div className="grid gap-4 lg:grid-cols-3">
            <Field label="调和温度 (℃)">
              <Input type="number" step="any" {...form.register('process_constraint.blending_temperature_c')} />
            </Field>
            <Field label="调和时长 (分钟)">
              <Input type="number" step="any" {...form.register('process_constraint.blending_time_min')} />
            </Field>
            <Field label="过滤精度 (μm)">
              <Input type="number" step="any" {...form.register('process_constraint.filtration_micron')} />
            </Field>
            <Field label="包装规格 (L)">
              <Input type="number" step="any" {...form.register('process_constraint.package_size_l')} />
            </Field>
            <Field label="储运最高温度 (℃)">
              <Input type="number" step="any" {...form.register('process_constraint.storage_max_temperature_c')} />
            </Field>
            <Field label="备注">
              <Textarea rows={2} {...form.register('process_constraint.notes')} />
            </Field>
          </div>
        </SectionCard>

        {/* Submit bar */}
        <div className="sticky bottom-0 z-10 -mx-1 flex items-center justify-end gap-2 rounded-md border bg-background/95 px-4 py-3 shadow-sm backdrop-blur">
          <Button type="button" variant="outline" onClick={() => form.reset(structuredInputDefaults)}>
            重置
          </Button>
          <Button type="submit" disabled={createTask.isPending}>
            {createTask.isPending ? '提交中…' : '提交需求并发起预测'}
          </Button>
        </div>
      </form>

      <TemplateLoaderDialog open={templateOpen} onOpenChange={setTemplateOpen} onPick={onPickTemplate} />
    </>
  );
}

// ────────────────────────────────────────────────────────────────────────────
// Local helpers
// ────────────────────────────────────────────────────────────────────────────

function SectionCard({
  icon,
  title,
  description,
  children,
}: {
  icon: React.ReactNode;
  title: string;
  description?: string;
  children: React.ReactNode;
}) {
  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2 text-base">
          <span className="flex h-7 w-7 items-center justify-center rounded-md bg-primary/10 text-primary">
            {icon}
          </span>
          {title}
        </CardTitle>
        {description ? <CardDescription>{description}</CardDescription> : null}
      </CardHeader>
      <Separator />
      <CardContent className="pt-6">{children}</CardContent>
    </Card>
  );
}

function Field({
  label,
  required,
  children,
  error,
  className,
}: {
  label: string;
  required?: boolean;
  children: React.ReactNode;
  error?: string;
  className?: string;
}) {
  return (
    <div className={className}>
      <Label className="mb-1.5 block text-xs">
        {label}
        {required ? <span className="ml-0.5 text-destructive">*</span> : null}
      </Label>
      {children}
      {error ? <p className="mt-1 text-xs text-destructive">{error}</p> : null}
    </div>
  );
}

interface TagInputFieldProps {
  label: string;
  helper?: string;
  values: string[];
  onChange: (next: string[]) => void;
}

function TagInputField({ label, helper, values, onChange }: TagInputFieldProps) {
  const [draft, setDraft] = React.useState('');
  const commit = () => {
    const v = draft.trim();
    if (!v) return;
    if (values.includes(v)) { setDraft(''); return; }
    onChange([...values, v]);
    setDraft('');
  };
  return (
    <Field label={label}>
      <div className="rounded-md border p-2">
        <div className="flex flex-wrap gap-1.5">
          {values.map((v) => (
            <Badge key={v} variant="secondary" className="gap-1">
              {v}
              <button
                type="button"
                aria-label={`删除 ${v}`}
                onClick={() => onChange(values.filter((x) => x !== v))}
                className="ml-1 rounded-sm hover:bg-background/30"
              >
                <X className="h-3 w-3" />
              </button>
            </Badge>
          ))}
          <input
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') {
                e.preventDefault();
                commit();
              }
            }}
            onBlur={commit}
            placeholder={values.length === 0 ? '输入后回车添加' : ''}
            className="min-w-[120px] flex-1 bg-transparent text-sm outline-none"
          />
        </div>
      </div>
      {helper ? <p className="mt-1 text-xs text-muted-foreground">{helper}</p> : null}
    </Field>
  );
}
