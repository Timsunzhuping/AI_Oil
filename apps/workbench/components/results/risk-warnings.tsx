import { AlertTriangle, Info, OctagonAlert } from 'lucide-react';
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { EmptyState } from '@/components/states/empty';
import type { RiskFlag } from '@/lib/api/types';

/**
 * 风险提示区. Always rendered on result pages — when there are no risks,
 * shows a positive empty state to make the absence of issues explicit.
 */
export function RiskWarnings({ risks }: { risks: RiskFlag[] }) {
  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base">风险提示</CardTitle>
      </CardHeader>
      <CardContent className="space-y-3">
        {risks.length === 0 ? (
          <EmptyState
            title="无显著风险"
            description="所有规格项与模型可信度检查均已通过。"
            icon={<Info className="h-6 w-6" />}
          />
        ) : (
          risks.map((r, idx) => <RiskAlert key={`${r.code}-${idx}`} risk={r} />)
        )}
      </CardContent>
    </Card>
  );
}

function RiskAlert({ risk }: { risk: RiskFlag }) {
  const variant =
    risk.level === 'critical' ? 'destructive' : risk.level === 'warning' ? 'warning' : 'info';
  const Icon = risk.level === 'critical' ? OctagonAlert : risk.level === 'warning' ? AlertTriangle : Info;

  return (
    <Alert variant={variant}>
      <Icon className="h-4 w-4" />
      <AlertTitle className="flex items-center gap-2 text-sm">
        <span>{risk.code}</span>
        {risk.metric ? <span className="font-mono text-xs opacity-70">/ {risk.metric}</span> : null}
      </AlertTitle>
      <AlertDescription>{risk.message}</AlertDescription>
    </Alert>
  );
}
