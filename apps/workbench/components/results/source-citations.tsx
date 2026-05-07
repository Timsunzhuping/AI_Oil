import { ExternalLink, BookOpen, FlaskConical, Cpu, Scale } from 'lucide-react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { EmptyState } from '@/components/states/empty';
import { fmtPct01 } from '@/lib/utils';
import type { SourceCitation } from '@/lib/api/types';

const ICONS = {
  literature: BookOpen,
  experiment: FlaskConical,
  model: Cpu,
  standard: Scale,
} as const;

const LABELS = {
  literature: '文献',
  experiment: '试验',
  model: '模型',
  standard: '标准',
} as const;

/** 来源说明区 — always rendered on result pages. */
export function SourceCitations({ sources }: { sources: SourceCitation[] }) {
  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base">来源说明</CardTitle>
      </CardHeader>
      <CardContent>
        {sources.length === 0 ? (
          <EmptyState title="暂无引用来源" description="此次结果未携带可追溯的引用来源。" />
        ) : (
          <ul className="space-y-3">
            {sources.map((s) => {
              const Icon = ICONS[s.source_type] ?? BookOpen;
              return (
                <li
                  key={s.id}
                  className="flex items-start gap-3 rounded-md border bg-card/50 p-3"
                >
                  <span className="mt-0.5 flex h-8 w-8 shrink-0 items-center justify-center rounded-md bg-muted text-muted-foreground">
                    <Icon className="h-4 w-4" />
                  </span>
                  <div className="min-w-0 flex-1">
                    <div className="flex flex-wrap items-center gap-2">
                      <span className="font-medium">{s.title}</span>
                      <Badge variant="outline" className="text-xs font-normal">
                        {LABELS[s.source_type] ?? s.source_type}
                      </Badge>
                      <Badge variant="secondary" className="text-xs font-normal">
                        相关性 {fmtPct01(s.relevance, 0)}
                      </Badge>
                    </div>
                    <p className="mt-1 break-all font-mono text-xs text-muted-foreground">{s.reference}</p>
                  </div>
                  {s.url ? (
                    <a
                      href={s.url}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="text-muted-foreground hover:text-foreground"
                      aria-label="打开来源链接"
                    >
                      <ExternalLink className="h-4 w-4" />
                    </a>
                  ) : null}
                </li>
              );
            })}
          </ul>
        )}
      </CardContent>
    </Card>
  );
}
