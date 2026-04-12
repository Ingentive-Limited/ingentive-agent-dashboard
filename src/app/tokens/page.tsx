"use client";

import { useState, useCallback } from "react";
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

const BAR_SERIES = [
  { dataKey: "input", name: "Input", color: "#3b82f6" },
  { dataKey: "output", name: "Output", color: "#22c55e" },
  { dataKey: "cache_create", name: "Cache Create", color: "#f97316" },
  { dataKey: "cache_read", name: "Cache Read", color: "#a855f7" },
];

export default function TokensPage() {
  const { data: projects, isLoading } = usePolling<ProjectSummary[]>(
    "/api/projects",
    10000
  );
  const { resolvedTheme } = useTheme();
  const isDark = resolvedTheme === "dark";

  const [hidden, setHidden] = useState<Set<string>>(new Set());

  const handleLegendClick = useCallback((entry: { dataKey?: string }) => {
    if (!entry.dataKey) return;
    setHidden((prev) => {
      const next = new Set(prev);
      if (next.has(entry.dataKey!)) {
        next.delete(entry.dataKey!);
      } else {
        next.add(entry.dataKey!);
      }
      return next;
    });
  }, []);

  const gridColor = isDark ? "#333" : "#e5e7eb";
  const axisColor = isDark ? "#999" : "#6b7280";
  const tooltipBg = isDark ? "#1a1a1a" : "#ffffff";
  const tooltipBorder = isDark ? "#333" : "#e5e7eb";
  const tooltipText = isDark ? "#e5e5e5" : "#1f2937";
  const legendColor = isDark ? "#999" : "#6b7280";
  const legendColorMuted = isDark ? "#555" : "#c4c4c4";
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

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const renderLegend = useCallback(
    (props: any) => {
      const payload = props?.payload as Array<{ value: string; dataKey?: string; color?: string }> | undefined;
      if (!payload) return null;
      return (
        <div className="flex justify-center gap-4 mt-2" style={{ fontSize: 12 }}>
          {payload.map((entry) => {
            const isHidden = hidden.has(entry.dataKey || "");
            return (
              <button
                key={entry.dataKey}
                type="button"
                className="flex items-center gap-1.5 cursor-pointer select-none transition-opacity hover:opacity-80"
                style={{ opacity: isHidden ? 0.4 : 1 }}
                onClick={() => handleLegendClick({ dataKey: entry.dataKey })}
                aria-label={`${isHidden ? "Show" : "Hide"} ${entry.value} series`}
                aria-pressed={!isHidden}
              >
                <span
                  className="inline-block h-2.5 w-2.5 rounded-sm"
                  style={{
                    backgroundColor: isHidden ? legendColorMuted : entry.color,
                  }}
                  aria-hidden="true"
                />
                <span style={{ color: isHidden ? legendColorMuted : legendColor }}>
                  {entry.value}
                </span>
              </button>
            );
          })}
        </div>
      );
    },
    [hidden, handleLegendClick, legendColor, legendColorMuted]
  );

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
                  <Legend content={renderLegend} />
                  {BAR_SERIES.map((s) => (
                    <Bar
                      key={s.dataKey}
                      dataKey={s.dataKey}
                      name={s.name}
                      fill={s.color}
                      hide={hidden.has(s.dataKey)}
                    />
                  ))}
                </BarChart>
              </ResponsiveContainer>
            </figure>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
