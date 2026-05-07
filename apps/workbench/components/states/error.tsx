import * as React from 'react';
import { AlertCircle, RefreshCw } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import { ApiError } from '@/lib/api/client';

interface ErrorStateProps {
  error: unknown;
  onRetry?: () => void;
  title?: string;
}

function describe(error: unknown): { title: string; message: string; traceId?: string } {
  if (error instanceof ApiError) {
    return { title: `请求失败 (code ${error.code})`, message: error.message, traceId: error.traceId };
  }
  if (error instanceof Error) {
    return { title: '发生错误', message: error.message };
  }
  return { title: '发生错误', message: String(error) };
}

export function ErrorState({ error, onRetry, title }: ErrorStateProps) {
  const d = describe(error);
  return (
    <Alert variant="destructive" role="alert" aria-live="assertive">
      <AlertCircle className="h-4 w-4" />
      <AlertTitle>{title ?? d.title}</AlertTitle>
      <AlertDescription className="mt-2 space-y-2">
        <p>{d.message}</p>
        {d.traceId ? (
          <p className="font-mono text-xs opacity-80">trace: {d.traceId}</p>
        ) : null}
        {onRetry ? (
          <div className="pt-2">
            <Button size="sm" variant="outline" onClick={onRetry}>
              <RefreshCw className="mr-2 h-3 w-3" /> 重试
            </Button>
          </div>
        ) : null}
      </AlertDescription>
    </Alert>
  );
}
