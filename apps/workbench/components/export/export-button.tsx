'use client';

import * as React from 'react';
import { Download, FileText, FileSpreadsheet, FileType2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { useToast } from '@/components/ui/toast';
import { useRequestExport } from '@/lib/hooks/queries';
import type { ExportRequest } from '@/lib/api/adapters';

interface ExportButtonProps {
  taskId: string;
  /** Whether to default-include source citations in the exported artifact. */
  includeSources?: boolean;
}

/**
 * Export entry — dropdown to pick a format. The actual export endpoint may
 * not yet be wired on the backend; the adapter falls back to a mock blob URL
 * which we simulate-download via an anchor click.
 */
export function ExportButton({ taskId, includeSources = true }: ExportButtonProps) {
  const { mutate, isPending } = useRequestExport();
  const { toast } = useToast();

  const handle = (format: ExportRequest['format']) => {
    mutate(
      { task_id: taskId, format, include_sources: includeSources },
      {
        onSuccess: (res) => {
          // Trigger browser download for the (possibly mock) URL.
          const a = document.createElement('a');
          a.href = res.url;
          a.download = res.filename;
          document.body.appendChild(a);
          a.click();
          a.remove();
          toast({
            title: '导出已开始',
            description: `${res.filename} (${(res.size_bytes / 1024).toFixed(1)} KB)`,
            variant: 'success',
          });
        },
        onError: (e) => {
          toast({
            title: '导出失败',
            description: e instanceof Error ? e.message : String(e),
            variant: 'destructive',
          });
        },
      },
    );
  };

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button variant="outline" size="sm" disabled={isPending} className="gap-1.5">
          <Download className="h-4 w-4" />
          {isPending ? '导出中…' : '导出'}
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-44">
        <DropdownMenuLabel>选择格式</DropdownMenuLabel>
        <DropdownMenuSeparator />
        <DropdownMenuItem onClick={() => handle('pdf')}>
          <FileType2 className="mr-2 h-4 w-4" /> PDF 报告
        </DropdownMenuItem>
        <DropdownMenuItem onClick={() => handle('xlsx')}>
          <FileSpreadsheet className="mr-2 h-4 w-4" /> Excel 数据
        </DropdownMenuItem>
        <DropdownMenuItem onClick={() => handle('csv')}>
          <FileText className="mr-2 h-4 w-4" /> CSV 表格
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
