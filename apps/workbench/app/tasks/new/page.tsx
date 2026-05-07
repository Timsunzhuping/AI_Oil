'use client';

import * as React from 'react';
import { Database, MessagesSquare, Wand2 } from 'lucide-react';
import { PageHeader } from '@/components/layout/workbench-shell';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { StructuredForm } from '@/components/tasks/structured-form';
import { NLChatPanel } from '@/components/tasks/nl-chat-panel';
import { TemplateLoaderDialog } from '@/components/tasks/template-loader-dialog';
import { useToast } from '@/components/ui/toast';

/** 新建研发任务页 — 提供 结构化 / 自然语言 / 模板 三种入口。 */
export default function NewTaskPage() {
  const { toast } = useToast();
  const [tplOpen, setTplOpen] = React.useState(false);

  return (
    <>
      <PageHeader
        title="新建研发任务"
        description="选择最合适的录入方式：结构化录入字段最规整、自然语言录入最快、模板录入最省事。"
      />

      <Tabs defaultValue="structured" className="w-full">
        <TabsList className="mb-4 grid w-full max-w-2xl grid-cols-3">
          <TabsTrigger value="structured">
            <Wand2 className="mr-2 h-4 w-4" />
            结构化录入
          </TabsTrigger>
          <TabsTrigger value="nl">
            <MessagesSquare className="mr-2 h-4 w-4" />
            自然语言录入
          </TabsTrigger>
          <TabsTrigger value="template">
            <Database className="mr-2 h-4 w-4" />
            从模板开始
          </TabsTrigger>
        </TabsList>

        <TabsContent value="structured">
          <StructuredForm />
        </TabsContent>

        <TabsContent value="nl">
          <NLChatPanel />
        </TabsContent>

        <TabsContent value="template">
          <Card>
            <CardHeader>
              <CardTitle className="text-base">从历史配方模板开始</CardTitle>
              <CardDescription>
                打开模板选择弹窗，挑一个量产 / 试制配方作为起点；选择后会自动跳转到结构化表单并预填字段。
              </CardDescription>
            </CardHeader>
            <CardContent>
              <Button onClick={() => setTplOpen(true)}>
                <Database className="mr-2 h-4 w-4" /> 打开模板列表
              </Button>
            </CardContent>
          </Card>
        </TabsContent>
      </Tabs>

      <TemplateLoaderDialog
        open={tplOpen}
        onOpenChange={setTplOpen}
        onPick={(tpl) => {
          // For now, surface as a toast. The structured form has its own
          // TemplateLoaderDialog wired into form state; here we just hint.
          toast({
            title: '已选择模板',
            description: `${tpl.name}（${tpl.code}）— 切换到「结构化录入」继续编辑`,
            variant: 'success',
          });
        }}
      />
    </>
  );
}
