"use client";

import { usePolling } from "@/hooks/use-polling";
import { useTheme } from "next-themes";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { formatTokens } from "@/lib/utils";
import type { ProjectSummary } from "@/lib/types";
import {
  BarChart,
  Bar,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer,
  Legend,
} from "recharts";

export default function TokensPage() {
  const { data: projects, isLoading } = usePolling<ProjectSummary[]>(
    "/api/projects",
    10000
  );
  const { resolvedTheme } = useTheme();
  const isDark = resolvedTheme === "dark";

  const gridColor = isDark ? "#333" : "#e5e7eb";
  const axisColor = isDark ? "#999" : "#6b7280";
  const tooltipBg = isDark ? "#1a1a1a" : "#ffffff";
  const tooltipBorder = isDark ? "#333" : "#e5e7eb";
  const tooltipText = isDark ? "#e5e5e5" : "#1f2937";
  const legendColor = isDark ? "#999" : "#6b7280";
  const cursorFill = isDark ? "rgba(255,255,255,0.05)" : "rgba(0,0,0,0.05)";

  if (isLoading || !projects) {
    return (
      <div className="space-y-6" role="status" aria-label="Loading token usage">
        <h1 className="text-2xl font-bold">Token Usage</h1>
        <Skeleton className="h-96" />
        <span className="sr-only">Loading token usage data...</span>
      </div>
    );
  }

  const chartData = projects
    .filter(
      (p) => p.totalTokens.input_tokens + p.totalTokens.output_tokens > 0
    )
    .map((p) => ({
      name: p.name,
      input: p.totalTokens.input_tokens,
      output: p.totalTokens.output_tokens,
      cache_create: p.totalTokens.cache_creation_input_tokens,
      cache_read: p.totalTokens.cache_read_input_tokens,
    }));

  const totalInput = projects.reduce(
    (sum, p) => sum + p.totalTokens.input_tokens,
    0
  );
  const totalOutput = projects.reduce(
    (sum, p) => sum + p.totalTokens.output_tokens,
    0
  );
  const totalCache = projects.reduce(
    (sum, p) =>
      sum +
      p.totalTokens.cache_creation_input_tokens +
      p.totalTokens.cache_read_input_tokens,
    0
  );

  const barChartSummary = `Bar chart showing token usage by project. ${chartData.length} projects. Total input: ${formatTokens(totalInput)}, total output: ${formatTokens(totalOutput)}, total cache: ${formatTokens(totalCache)}.`;

  return (
    <div className="space-y-6">
      <h1 className="text-2xl font-bold">Token Usage</h1>

      <div className="grid gap-4 md:grid-cols-3">
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-medium">Total Input</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">{formatTokens(totalInput)}</div>
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-medium">Total Output</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">{formatTokens(totalOutput)}</div>
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-medium">Cache Tokens</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">{formatTokens(totalCache)}</div>
          </CardContent>
        </Card>
      </div>

      <Card>
        <CardHeader>
          <CardTitle className="text-lg">Tokens by Project</CardTitle>
        </CardHeader>
        <CardContent>
          {chartData.length === 0 ? (
            <p className="text-sm text-muted-foreground py-8 text-center">
              No token data available
            </p>
          ) : (
            <figure role="img" aria-label={barChartSummary}>
              <ResponsiveContainer width="100%" height={400}>
                <BarChart data={chartData}>
                  <CartesianGrid strokeDasharray="3 3" stroke={gridColor} />
                  <XAxis
                    dataKey="name"
                    fontSize={12}
                    tick={{ fill: axisColor }}
                    axisLine={{ stroke: gridColor }}
                    tickLine={{ stroke: gridColor }}
                  />
                  <YAxis
                    fontSize={12}
                    tick={{ fill: axisColor }}
                    axisLine={{ stroke: gridColor }}
                    tickLine={{ stroke: gridColor }}
                    tickFormatter={(v) => formatTokens(v)}
                  />
                  <Tooltip
                    contentStyle={{
                      backgroundColor: tooltipBg,
                      border: `1px solid ${tooltipBorder}`,
                      borderRadius: "8px",
                      color: tooltipText,
                      fontSize: 13,
                    }}
                    labelStyle={{ color: tooltipText, marginBottom: 4 }}
                    itemStyle={{ color: tooltipText, padding: "1px 0" }}
                    formatter={(value: unknown, name: unknown) => [
                      formatTokens(Number(value)),
                      String(name),
                    ]}
                    cursor={{ fill: cursorFill }}
                  />
                  <Legend wrapperStyle={{ color: legendColor, fontSize: 12 }} />
                  <Bar dataKey="input" name="Input" fill="#3b82f6" />
                  <Bar dataKey="output" name="Output" fill="#22c55e" />
                  <Bar
                    dataKey="cache_create"
                    name="Cache Create"
                    fill="#f97316"
                  />
                  <Bar
                    dataKey="cache_read"
                    name="Cache Read"
                    fill="#a855f7"
                  />
                </BarChart>
              </ResponsiveContainer>
            </figure>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
