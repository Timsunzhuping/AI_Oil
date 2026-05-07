import { Skeleton } from '@/components/ui/skeleton';

/** Generic loading skeleton: 1 wide bar + 4 list rows. Used as a default. */
export function LoadingState({ rows = 4 }: { rows?: number }) {
  return (
    <div className="space-y-4 rounded-lg border bg-card p-6" role="status" aria-busy="true" aria-live="polite">
      <Skeleton className="h-6 w-1/3" />
      <Skeleton className="h-4 w-2/3" />
      <div className="space-y-2 pt-2">
        {Array.from({ length: rows }).map((_, i) => (
          <Skeleton key={i} className="h-10 w-full" />
        ))}
      </div>
      <span className="sr-only">Loading…</span>
    </div>
  );
}

/** Inline, smaller loader for cards/sections. */
export function InlineLoading({ label = '加载中…' }: { label?: string }) {
  return (
    <div className="flex items-center gap-2 text-sm text-muted-foreground" role="status" aria-busy="true">
      <span className="h-3 w-3 animate-pulse rounded-full bg-primary" />
      <span>{label}</span>
    </div>
  );
}
