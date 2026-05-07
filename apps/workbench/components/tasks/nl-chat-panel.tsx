'use client';

import * as React from 'react';
import { useRouter } from 'next/navigation';
import { useForm, Controller } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { Bot, Send, Sparkles, User } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { Label } from '@/components/ui/label';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { useToast } from '@/components/ui/toast';
import { useCreateTask } from '@/lib/hooks/queries';
import { nlPromptSchema, type NlPromptValues } from '@/lib/schemas/structured-input';

const TASK_TYPE_OPTIONS = [
  { value: 'forward_prediction', label: '正向预测' },
  { value: 'cost_optimization', label: '成本优化' },
  { value: 'material_replacement', label: '原料替代' },
  { value: 'new_product_generation', label: '新品生成' },
  { value: 'knowledge_qa', label: '知识问答' },
] as const;

const PRIORITY_OPTIONS = [
  { value: 'low', label: '低' },
  { value: 'medium', label: '中' },
  { value: 'high', label: '高' },
  { value: 'urgent', label: '紧急' },
] as const;

type ChatLine =
  | { who: 'system'; text: string }
  | { who: 'user'; text: string }
  | { who: 'assistant'; text: string };

const SAMPLE_PROMPTS = [
  '帮我设计一款 5W-30 SP 等级机油，目标 100℃ 黏度 11.0±0.4，磷含量 ≤ 0.08%。',
  '替换现配方中的 PIB 增稠剂，VI 衰减不超过 2%，给出 3 个备选方案。',
  '在保持 KV100 与 VI 不变的前提下，把成本降低 5%。',
  'API SP 标准下硫含量上限是多少？哪些 OEM 的要求更严格？',
];

/** 自然语言输入面板 — Chat 风格录入需求，提交后转 dispatcher。 */
export function NLChatPanel() {
  const router = useRouter();
  const { toast } = useToast();
  const createTask = useCreateTask();

  const form = useForm<NlPromptValues>({
    resolver: zodResolver(nlPromptSchema),
    defaultValues: { title: '', prompt: '', task_type: 'forward_prediction', priority: 'medium' },
  });

  const [history, setHistory] = React.useState<ChatLine[]>([
    {
      who: 'system',
      text: '你可以用一句话描述需求，例如：「帮我设计一款 5W-30 全合成机油，目标 KV100 11.0」。',
    },
  ]);
  const scrollRef = React.useRef<HTMLDivElement>(null);

  React.useEffect(() => {
    const el = scrollRef.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [history]);

  const onSubmit = (v: NlPromptValues) => {
    setHistory((prev) => [
      ...prev,
      { who: 'user', text: v.prompt },
      { who: 'assistant', text: '已捕获需求，正在派发到 AI 工作流…' },
    ]);

    createTask.mutate(
      {
        task_type: v.task_type,
        title: v.title,
        priority: v.priority,
        raw_text: v.prompt,
      },
      {
        onSuccess: (task) => {
          toast({ title: '任务已提交', description: task.code, variant: 'success' });
          setHistory((prev) => [
            ...prev,
            {
              who: 'assistant',
              text: `已创建任务 ${task.code}，正在跳转到结果页…`,
            },
          ]);
          const path =
            v.task_type === 'forward_prediction'
              ? `/results/forward/${task.id}`
              : v.task_type === 'knowledge_qa'
              ? `/tasks/${task.id}`
              : `/results/inverse/${task.id}`;
          setTimeout(() => router.push(path), 600);
        },
        onError: (e) => {
          toast({
            title: '提交失败',
            description: e instanceof Error ? e.message : String(e),
            variant: 'destructive',
          });
          setHistory((prev) => [...prev, { who: 'assistant', text: '提交失败，请稍后重试。' }]);
        },
      },
    );
  };

  return (
    <div className="grid gap-4 lg:grid-cols-3">
      <div className="lg:col-span-2">
        <Card className="flex h-[560px] flex-col">
          <div ref={scrollRef} className="flex-1 overflow-y-auto px-4 py-4">
            <div className="space-y-3">
              {history.map((line, i) => (
                <ChatBubble key={i} line={line} />
              ))}
            </div>
          </div>
          <div className="border-t bg-muted/30 p-3">
            <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-2">
              <Controller
                control={form.control}
                name="prompt"
                render={({ field }) => (
                  <Textarea
                    rows={3}
                    {...field}
                    placeholder="按 Cmd/Ctrl + Enter 提交"
                    onKeyDown={(e) => {
                      if ((e.metaKey || e.ctrlKey) && e.key === 'Enter') {
                        e.preventDefault();
                        form.handleSubmit(onSubmit)();
                      }
                    }}
                  />
                )}
              />
              {form.formState.errors.prompt ? (
                <p className="text-xs text-destructive">{form.formState.errors.prompt.message}</p>
              ) : null}
              <div className="flex items-center justify-between">
                <div className="flex flex-wrap gap-1.5">
                  {SAMPLE_PROMPTS.map((p) => (
                    <Button
                      key={p}
                      type="button"
                      variant="outline"
                      size="sm"
                      className="h-7 text-xs"
                      onClick={() => {
                        form.setValue('prompt', p);
                        if (!form.getValues('title')) form.setValue('title', p.slice(0, 24));
                      }}
                    >
                      <Sparkles className="mr-1.5 h-3 w-3" />
                      示例
                    </Button>
                  ))}
                </div>
                <Button type="submit" disabled={createTask.isPending} className="gap-1.5">
                  <Send className="h-4 w-4" />
                  {createTask.isPending ? '提交中…' : '发送'}
                </Button>
              </div>
            </form>
          </div>
        </Card>
      </div>

      {/* Side panel — additional metadata to attach to the task */}
      <Card>
        <CardContent className="space-y-4 p-5">
          <div>
            <Label className="text-xs">任务标题</Label>
            <Input
              className="mt-1"
              placeholder="一句话总结"
              {...form.register('title')}
            />
            {form.formState.errors.title ? (
              <p className="mt-1 text-xs text-destructive">{form.formState.errors.title.message}</p>
            ) : null}
          </div>
          <div>
            <Label className="text-xs">任务类型</Label>
            <Controller
              control={form.control}
              name="task_type"
              render={({ field }) => (
                <Select value={field.value} onValueChange={field.onChange}>
                  <SelectTrigger className="mt-1"><SelectValue /></SelectTrigger>
                  <SelectContent>
                    {TASK_TYPE_OPTIONS.map((o) => (
                      <SelectItem key={o.value} value={o.value}>{o.label}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              )}
            />
          </div>
          <div>
            <Label className="text-xs">优先级</Label>
            <Controller
              control={form.control}
              name="priority"
              render={({ field }) => (
                <Select value={field.value} onValueChange={field.onChange}>
                  <SelectTrigger className="mt-1"><SelectValue /></SelectTrigger>
                  <SelectContent>
                    {PRIORITY_OPTIONS.map((o) => (
                      <SelectItem key={o.value} value={o.value}>{o.label}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              )}
            />
          </div>
          <p className="rounded-md bg-muted/40 p-3 text-xs text-muted-foreground">
            自然语言输入会被发送给 dispatcher，由智能体抽取结构化字段后再执行。
            如果需要严格控制，请改用「结构化录入」。
          </p>
        </CardContent>
      </Card>
    </div>
  );
}

function ChatBubble({ line }: { line: ChatLine }) {
  if (line.who === 'system') {
    return (
      <div className="rounded-md border border-dashed bg-muted/30 p-3 text-center text-xs text-muted-foreground">
        {line.text}
      </div>
    );
  }
  const isUser = line.who === 'user';
  return (
    <div className={'flex items-start gap-2 ' + (isUser ? 'flex-row-reverse' : '')}>
      <div
        className={
          'flex h-8 w-8 shrink-0 items-center justify-center rounded-full ' +
          (isUser ? 'bg-primary text-primary-foreground' : 'bg-muted text-muted-foreground')
        }
      >
        {isUser ? <User className="h-4 w-4" /> : <Bot className="h-4 w-4" />}
      </div>
      <div
        className={
          'max-w-[80%] whitespace-pre-wrap rounded-lg px-3 py-2 text-sm ' +
          (isUser ? 'bg-primary text-primary-foreground' : 'border bg-card')
        }
      >
        {line.text}
      </div>
    </div>
  );
}
