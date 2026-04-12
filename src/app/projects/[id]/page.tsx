"use client";

import { use } from "react";
import { usePolling } from "@/hooks/use-polling";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { Badge } from "@/components/ui/badge";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { formatTokens, formatRelativeTime } from "@/lib/utils";
import type { ProjectDetail } from "@/lib/types";
import { TokenChart } from "@/components/token-chart";
import { BarChart3, FileText, Bot, Brain } from "lucide-react";

export default function ProjectDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = use(params);
  const { data: project, isLoading } = usePolling<ProjectDetail>(
    `/api/projects/${encodeURIComponent(id)}`,
    10000
  );

  if (isLoading || !project) {
    return (
      <div className="space-y-6" role="status" aria-label="Loading project details">
        <Skeleton className="h-8 w-64" />
        <Skeleton className="h-96" />
        <span className="sr-only">Loading project details...</span>
      </div>
    );
  }

  const totalTokens =
    project.totalTokens.input_tokens + project.totalTokens.output_tokens;

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold">{project.name}</h1>
        <p className="text-sm text-muted-foreground font-mono">{project.path}</p>
      </div>

      <div className="grid gap-4 md:grid-cols-4">
        <Card>
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium">Sessions</CardTitle>
            <FileText className="h-4 w-4 text-muted-foreground" aria-hidden="true" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">{project.sessionCount}</div>
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium">Total Tokens</CardTitle>
            <BarChart3 className="h-4 w-4 text-muted-foreground" aria-hidden="true" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">{formatTokens(totalTokens)}</div>
            <p className="text-xs text-muted-foreground">
              {formatTokens(project.totalTokens.input_tokens)} in /{" "}
              {formatTokens(project.totalTokens.output_tokens)} out
            </p>
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium">Subagents</CardTitle>
            <Bot className="h-4 w-4 text-muted-foreground" aria-hidden="true" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">{project.subagents.length}</div>
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium">Memory Files</CardTitle>
            <Brain className="h-4 w-4 text-muted-foreground" aria-hidden="true" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">{project.memoryFiles.length}</div>
          </CardContent>
        </Card>
      </div>

      <Tabs defaultValue="tokens">
        <TabsList>
          <TabsTrigger value="tokens">Token Usage</TabsTrigger>
          <TabsTrigger value="sessions">Sessions</TabsTrigger>
          <TabsTrigger value="subagents">Subagents</TabsTrigger>
          <TabsTrigger value="memory">Memory</TabsTrigger>
        </TabsList>

        <TabsContent value="tokens" className="mt-4">
          <Card>
            <CardHeader>
              <CardTitle className="text-lg">Token Usage Over Time</CardTitle>
            </CardHeader>
            <CardContent>
              {project.tokenTimeSeries.length === 0 ? (
                <p className="text-sm text-muted-foreground py-8 text-center">
                  No token data available
                </p>
              ) : (
                <TokenChart data={project.tokenTimeSeries} />
              )}
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="sessions" className="mt-4">
          <Card>
            <CardContent className="pt-6">
              <Table aria-label="Project sessions">
                <TableHeader>
                  <TableRow>
                    <TableHead>Session ID</TableHead>
                    <TableHead>Messages</TableHead>
                    <TableHead>Input Tokens</TableHead>
                    <TableHead>Output Tokens</TableHead>
                    <TableHead>Last Activity</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {project.sessions.map((session) => (
                    <TableRow key={session.sessionId}>
                      <TableCell className="font-mono text-xs">
                        {session.sessionId.slice(0, 8)}...
                      </TableCell>
                      <TableCell>{session.messageCount}</TableCell>
                      <TableCell>
                        {formatTokens(session.totalTokens.input_tokens)}
                      </TableCell>
                      <TableCell>
                        {formatTokens(session.totalTokens.output_tokens)}
                      </TableCell>
                      <TableCell className="text-muted-foreground">
                        {session.lastMessage
                          ? formatRelativeTime(session.lastMessage)
                          : "-"}
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="subagents" className="mt-4">
          <Card>
            <CardContent className="pt-6">
              {project.subagents.length === 0 ? (
                <p className="text-sm text-muted-foreground py-8 text-center">
                  No subagents used
                </p>
              ) : (
                <div className="space-y-3">
                  {project.subagents.map((agent, i) => (
                    <div
                      key={i}
                      className="flex items-center gap-3 rounded-lg border p-3"
                    >
                      <Badge variant="secondary">{agent.agentType}</Badge>
                      <span className="text-sm">{agent.description}</span>
                    </div>
                  ))}
                </div>
              )}
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="memory" className="mt-4">
          <Card>
            <CardContent className="pt-6">
              {project.memoryFiles.length === 0 ? (
                <p className="text-sm text-muted-foreground py-8 text-center">
                  No memory files
                </p>
              ) : (
                <div className="space-y-2">
                  {project.memoryFiles.map((file) => (
                    <div
                      key={file}
                      className="flex items-center gap-2 rounded-lg border p-3"
                    >
                      <FileText className="h-4 w-4 text-muted-foreground" aria-hidden="true" />
                      <span className="text-sm font-mono">{file}</span>
                    </div>
                  ))}
                </div>
              )}
            </CardContent>
          </Card>
        </TabsContent>
      </Tabs>
    </div>
  );
}
