"use client";

import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Terminal, Bell, BarChart3, FolderOpen, Clock } from "lucide-react";
import { formatTokens } from "@/lib/utils";
import type { DashboardOverview } from "@/lib/types";

export function OverviewCards({ data }: { data: DashboardOverview }) {
  const totalTokens =
    data.totalTokensToday.input_tokens + data.totalTokensToday.output_tokens;

  return (
    <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-5">
      <Card>
        <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
          <CardTitle className="text-sm font-medium">Active Sessions</CardTitle>
          <Terminal className="h-4 w-4 text-muted-foreground" />
        </CardHeader>
        <CardContent>
          <div className="text-2xl font-bold">{data.activeSessions}</div>
          <p className="text-xs text-muted-foreground">
            {data.activeSessions === 1 ? "session" : "sessions"} running
          </p>
        </CardContent>
      </Card>

      <Card className={data.awaitingInput > 0 ? "border-amber-500/50" : ""}>
        <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
          <CardTitle className="text-sm font-medium">Awaiting Input</CardTitle>
          <Bell
            className={`h-4 w-4 ${
              data.awaitingInput > 0
                ? "text-amber-500 animate-pulse"
                : "text-muted-foreground"
            }`}
          />
        </CardHeader>
        <CardContent>
          <div
            className={`text-2xl font-bold ${
              data.awaitingInput > 0 ? "text-amber-500" : ""
            }`}
          >
            {data.awaitingInput}
          </div>
          <p className="text-xs text-muted-foreground">
            {data.awaitingInput === 1 ? "session needs" : "sessions need"} attention
          </p>
        </CardContent>
      </Card>

      <Card>
        <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
          <CardTitle className="text-sm font-medium">Session Tokens</CardTitle>
          <BarChart3 className="h-4 w-4 text-muted-foreground" />
        </CardHeader>
        <CardContent>
          <div className="text-2xl font-bold">{formatTokens(totalTokens)}</div>
          <p className="text-xs text-muted-foreground">
            {formatTokens(data.totalTokensToday.input_tokens)} in /{" "}
            {formatTokens(data.totalTokensToday.output_tokens)} out
          </p>
          <p className="text-[10px] text-muted-foreground/60 mt-0.5">
            active sessions only
          </p>
        </CardContent>
      </Card>

      <Card>
        <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
          <CardTitle className="text-sm font-medium">Active Projects</CardTitle>
          <FolderOpen className="h-4 w-4 text-muted-foreground" />
        </CardHeader>
        <CardContent>
          <div className="text-2xl font-bold">{data.activeProjects}</div>
          <p className="text-xs text-muted-foreground">in the last 24h</p>
        </CardContent>
      </Card>

      <Card>
        <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
          <CardTitle className="text-sm font-medium">Scheduled Tasks</CardTitle>
          <Clock className="h-4 w-4 text-muted-foreground" />
        </CardHeader>
        <CardContent>
          <div className="text-2xl font-bold">{data.scheduledTasks}</div>
          <p className="text-xs text-muted-foreground">
            {data.scheduledTasks === 0 ? "none configured" : "configured"}
          </p>
        </CardContent>
      </Card>
    </div>
  );
}
