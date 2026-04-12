"use client";

import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Terminal, BarChart3, FolderOpen, Clock, DollarSign } from "lucide-react";
import { formatTokens, formatCost } from "@/lib/utils";
import type { DashboardOverview } from "@/lib/types";

interface OverviewCardsProps {
  data: DashboardOverview;
  showCost?: boolean;
}

export function OverviewCards({ data, showCost = true }: OverviewCardsProps) {
  const totalTokens =
    data.totalTokensToday.input_tokens + data.totalTokensToday.output_tokens;

  return (
    <div className={`grid gap-4 md:grid-cols-2 ${showCost ? "lg:grid-cols-5" : "lg:grid-cols-4"}`}>
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
        </CardContent>
      </Card>

      {showCost && (
        <Card>
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium">Estimated Cost</CardTitle>
            <DollarSign className="h-4 w-4 text-muted-foreground" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">
              {formatCost(data.totalCost.totalCost)}
            </div>
            <p className="text-xs text-muted-foreground">
              active sessions only
            </p>
          </CardContent>
        </Card>
      )}

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
