'use client';

import * as React from 'react';
import { Search, Sparkles } from 'lucide-react';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { ScrollArea } from '@/components/ui/scroll-area';
import { LoadingState } from '@/components/states/loading';
import { EmptyState } from '@/components/states/empty';
import { ErrorState } from '@/components/states/error';
import { useTemplates } from '@/lib/hooks/queries';
import type { FormulaTemplate } from '@/lib/api/types';

interface TemplateLoaderDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onPick: (tpl: FormulaTemplate) => void;
}

/** 历史配方模板加载弹窗 — 按名称、分类、编号搜索，点击选择。 */
export function TemplateLoaderDialog({ open, onOpenChange, onPick }: TemplateLoaderDialogProps) {
  const [q, setQ] = React.useState('');
  const [selectedId, setSelectedId] = React.useState<string | null>(null);
  const { data, isLoading, error, refetch } = useTemplates(q);

  const list = data ?? [];
  const selected = list.find((t) => t.id === selectedId) ?? null;

  // Reset selection when dialog re-opens
  React.useEffect(() => {
    if (!open) {
      setSelectedId(null);
      setQ('');
    }
  }, [open]);

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-2xl">
        <DialogHeader>
          <DialogTitle>加载历史配方模板</DialogTitle>
          <DialogDescription>
            从历史量产 / 试制配方中挑选一个作为起点，所选模板会预填入需求表单。
          </DialogDescription>
        </DialogHeader>

        <div className="relative">
          <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
          <Input
            value={q}
            onChange={(e) => setQ(e.target.value)}
            placeholder="按名称 / 编号 / 类别搜索"
            className="pl-9"
            aria-label="搜索模板"
          />
        </div>

        <div className="min-h-[280px]">
          {isLoading ? (
            <LoadingState rows={5} />
          ) : error ? (
            <ErrorState error={error} onRetry={() => refetch()} />
          ) : list.length === 0 ? (
            <EmptyState
              title="无匹配模板"
              description="换个关键字试试，或者跳过模板直接录入需求。"
              icon={<Sparkles className="h-6 w-6" />}
            />
          ) : (
            <ScrollArea className="h-[320px] rounded-md border">
              <ul className="divide-y">
                {list.map((tpl) => (
                  <li key={tpl.id}>
                    <button
                      type="button"
                      onClick={() => setSelectedId(tpl.id)}
                      className={
                        'block w-full px-4 py-3 text-left transition-colors hover:bg-accent ' +
                        (selectedId === tpl.id ? 'bg-accent' : '')
                      }
                    >
                      <div className="flex items-center justify-between gap-3">
                        <div className="min-w-0">
                          <div className="flex items-center gap-2">
                            <span className="font-medium">{tpl.name}</span>
                            <Badge variant="outline" className="text-xs font-normal">
                              {tpl.product_category}
                            </Badge>
                          </div>
                          <p className="mt-1 truncate text-xs text-muted-foreground">{tpl.description}</p>
                        </div>
                        <div className="shrink-0 text-right text-xs text-muted-foreground">
                          <div className="font-mono">{tpl.code}</div>
                          <div>更新 {tpl.last_revised_year} · 热度 {tpl.popularity}</div>
                        </div>
                      </div>
                    </button>
                  </li>
                ))}
              </ul>
            </ScrollArea>
          )}
        </div>

        <DialogFooter>
          <Button variant="ghost" onClick={() => onOpenChange(false)}>取消</Button>
          <Button
            disabled={!selected}
            onClick={() => {
              if (selected) {
                onPick(selected);
                onOpenChange(false);
              }
            }}
          >
            使用所选模板
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
