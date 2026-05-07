import * as React from 'react';
import { Card, CardContent } from '@/components/ui/card';
import { cn } from '@/lib/utils';

interface StatCardProps {
  title: string;
  value: React.ReactNode;
  delta?: React.ReactNode;
  icon?: React.ReactNode;
  tone?: 'neutral' | 'success' | 'warning' | 'danger';
  hint?: string;
}

const TONE_BG: Record<NonNullable<StatCardProps['tone']>, string> = {
  neutral: 'bg-muted text-muted-foreground',
  success: 'bg-emerald-100 text-emerald-700',
  warning: 'bg-amber-100 text-amber-700',
  danger: 'bg-rose-100 text-rose-700',
};

export function StatCard({ title, value, delta, icon, tone = 'neutral', hint }: StatCardProps) {
  return (
    <Card>
      <CardContent className="flex items-start justify-between gap-4 p-5">
        <div className="min-w-0">
          <div className="text-sm text-muted-foreground">{title}</div>
          <div className="mt-1.5 text-2xl font-semibold tracking-tight">{value}</div>
          {delta ? <div className="mt-1 text-xs text-muted-foreground">{delta}</div> : null}
          {hint ? <div className="mt-2 text-xs text-muted-foreground/80">{hint}</div> : null}
        </div>
        {icon ? (
          <div className={cn('flex h-10 w-10 shrink-0 items-center justify-center rounded-md', TONE_BG[tone])}>
            {icon}
          </div>
        ) : null}
      </CardContent>
    </Card>
  );
}
