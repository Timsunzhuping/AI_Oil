import { ShieldCheck, ShieldAlert, ShieldQuestion } from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { Tooltip, TooltipContent, TooltipTrigger, TooltipProvider } from '@/components/ui/tooltip';
import { confidenceBand, fmtPct01 } from '@/lib/utils';

/**
 * 置信度徽标. Maps a 0..1 score to a coarse band (low/medium/high/unknown)
 * with tooltip showing the raw percentage. Used in every result page.
 */
export function ConfidenceBadge({ score, label = '置信度' }: { score: number | null | undefined; label?: string }) {
  const band = confidenceBand(score);

  const variant =
    band === 'high' ? 'success' : band === 'medium' ? 'info' : band === 'low' ? 'warning' : 'secondary';
  const Icon =
    band === 'high' ? ShieldCheck : band === 'unknown' ? ShieldQuestion : ShieldAlert;
  const text =
    band === 'unknown'
      ? `${label}：未知`
      : `${label}：${band === 'high' ? '高' : band === 'medium' ? '中' : '低'}`;

  return (
    <TooltipProvider delayDuration={200}>
      <Tooltip>
        <TooltipTrigger asChild>
          <Badge variant={variant} className="gap-1">
            <Icon className="h-3 w-3" />
            <span>{text}</span>
          </Badge>
        </TooltipTrigger>
        <TooltipContent>
          <p>原始分数：{fmtPct01(score, 1)}</p>
          <p className="opacity-70">高 ≥ 0.80 / 中 ≥ 0.60 / 低 &lt; 0.60</p>
        </TooltipContent>
      </Tooltip>
    </TooltipProvider>
  );
}
