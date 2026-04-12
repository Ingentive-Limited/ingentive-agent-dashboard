"use client";

import { useState, useCallback, useMemo } from "react";
import { usePolling } from "@/hooks/use-polling";
import { useBillingMode } from "@/hooks/use-billing-mode";
import { usePersistedState } from "@/hooks/use-persisted-state";
import { useTheme } from "next-themes";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { formatTokens, formatCost } from "@/lib/utils";
import type { ProjectSummary, DailyTokenUsage } from "@/lib/types";
import {
  BarChart,
  Bar,
  AreaChart,
  Area,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer,
  Legend,
} from "recharts";
import { DollarSign, TrendingUp, TrendingDown, Download } from "lucide-react";
import { exportCSV, exportJSON } from "@/lib/export";

const BAR_SERIES = [
  { dataKey: "input", name: "Input", color: "#3b82f6" },
  { dataKey: "output", name: "Output", color: "#22c55e" },
  { dataKey: "cache_create", name: "Cache Create", color: "#f97316" },
  { dataKey: "cache_read", name: "Cache Read", color: "#a855f7" },
];

const AREA_SERIES = [
  { dataKey: "input_tokens", name: "Input", color: "#3b82f6" },
  { dataKey: "output_tokens", name: "Output", color: "#22c55e" },
  { dataKey: "cache_creation_input_tokens", name: "Cache Create", color: "#f97316" },
  { dataKey: "cache_read_input_tokens", name: "Cache Read", color: "#a855f7" },
];

type DateRange = 7 | 14 | 30 | 90;

function useChartColors() {
  const { resolvedTheme } = useTheme();
  const isDark = resolvedTheme === "dark";
  return {
    grid: isDark ? "#333" : "#e5e7eb",
    axis: isDark ? "#999" : "#6b7280",
    tooltipBg: isDark ? "#1a1a1a" : "#ffffff",
    tooltipBorder: isDark ? "#333" : "#e5e7eb",
    tooltipText: isDark ? "#e5e5e5" : "#1f2937",
    legend: isDark ? "#999" : "#6b7280",
    legendMuted: isDark ? "#555" : "#c4c4c4",
    cursor: isDark ? "rgba(255,255,255,0.05)" : "rgba(0,0,0,0.05)",
  };
}

function InteractiveLegend({
  payload,
  hidden,
  onToggle,
  legendColor,
  legendMuted,
}: {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  payload?: readonly any[];
  hidden: Set<string>;
  onToggle: (dataKey: string) => void;
  legendColor: string;
  legendMuted: string;
}) {
  if (!payload) return null;
  return (
    <div className="flex justify-center gap-4 mt-2" style={{ fontSize: 12 }}>
      {payload.map((entry: { value: string; dataKey?: string; color?: string }) => {
        const isHidden = hidden.has(entry.dataKey || "");
        return (
          <button
            key={entry.dataKey}
            type="button"
            className="flex items-center gap-1.5 cursor-pointer select-none transition-opacity hover:opacity-80"
            style={{ opacity: isHidden ? 0.4 : 1 }}
            onClick={() => onToggle(entry.dataKey || "")}
            aria-label={`${isHidden ? "Show" : "Hide"} ${entry.value} series`}
            aria-pressed={!isHidden}
          >
            <span
              className="inline-block h-2.5 w-2.5 rounded-sm"
              style={{ backgroundColor: isHidden ? legendMuted : entry.color }}
              aria-hidden="true"
            />
            <span style={{ color: isHidden ? legendMuted : legendColor }}>
              {entry.value}
            </span>
          </button>
        );
      })}
    </div>
  );
}

export default function TokensPage() {
  const [dateRange, setDateRange] = usePersistedState<DateRange>("tokens-range", 30);
  const { data: projects, isLoading: projectsLoading } = usePolling<ProjectSummary[]>(
    "/api/projects",
    10000
  );
  const { data: dailyData, isLoading: dailyLoading } = usePolling<DailyTokenUsage[]>(
    `/api/tokens/daily?days=${dateRange}`,
    15000
  );
  const { isApi } = useBillingMode();
  const colors = useChartColors();

  const [barHidden, setBarHidden] = useState<Set<string>>(new Set());
  const [areaHidden, setAreaHidden] = useState<Set<string>>(new Set());

  const toggleHidden = useCallback((set: "bar" | "area", dataKey: string) => {
    const setter = set === "bar" ? setBarHidden : setAreaHidden;
    setter((prev) => {
      const next = new Set(prev);
      next.has(dataKey) ? next.delete(dataKey) : next.add(dataKey);
      return next;
    });
  }, []);

  const isLoading = projectsLoading || dailyLoading;

  // Compute summary stats from daily data
  const { totalInput, totalOutput, totalCache, totalCost, trend } = useMemo(() => {
    if (!dailyData || dailyData.length === 0) {
      return { totalInput: 0, totalOutput: 0, totalCache: 0, totalCost: 0, trend: 0 };
    }

    let input = 0, output = 0, cache = 0, cost = 0;
    for (const d of dailyData) {
      input += d.input_tokens;
      output += d.output_tokens;
      cache += d.cache_creation_input_tokens + d.cache_read_input_tokens;
      cost += d.totalCost;
    }

    // Calculate trend: compare last 7 days to previous 7 days
    const now = dailyData.length;
    const recentDays = dailyData.slice(Math.max(0, now - 7));
    const prevDays = dailyData.slice(Math.max(0, now - 14), Math.max(0, now - 7));

    const recentTotal = recentDays.reduce((s, d) => s + d.input_tokens + d.output_tokens, 0);
    const prevTotal = prevDays.reduce((s, d) => s + d.input_tokens + d.output_tokens, 0);
    const trendPct = prevTotal > 0 ? ((recentTotal - prevTotal) / prevTotal) * 100 : 0;

    return { totalInput: input, totalOutput: output, totalCache: cache, totalCost: cost, trend: trendPct };
  }, [dailyData]);

  // Project bar chart data
  const chartData = useMemo(() => {
    if (!projects) return [];
    return projects
      .filter((p) => p.totalTokens.input_tokens + p.totalTokens.output_tokens > 0)
      .map((p) => ({
        name: p.name,
        input: p.totalTokens.input_tokens,
        output: p.totalTokens.output_tokens,
        cache_create: p.totalTokens.cache_creation_input_tokens,
        cache_read: p.totalTokens.cache_read_input_tokens,
      }));
  }, [projects]);

  // Format daily data for chart display
  const formattedDaily = useMemo(() => {
    if (!dailyData) return [];
    return dailyData.map((d) => ({
      ...d,
      label: new Date(d.date + "T00:00:00").toLocaleDateString(undefined, {
        month: "short",
        day: "numeric",
      }),
    }));
  }, [dailyData]);

  if (isLoading || !projects) {
    return (
      <div className="space-y-6" role="status" aria-label="Loading token usage">
        <h1 className="text-2xl font-bold">Token Usage</h1>
        <Skeleton className="h-96" />
        <span className="sr-only">Loading token usage data...</span>
      </div>
    );
  }

  const dateRanges: { value: DateRange; label: string }[] = [
    { value: 7, label: "7 days" },
    { value: 14, label: "14 days" },
    { value: 30, label: "30 days" },
    { value: 90, label: "90 days" },
  ];

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-bold">Token Usage</h1>
        <div className="flex items-center gap-2">
          <div className="flex items-center gap-1">
            {dateRanges.map((r) => (
              <Button
                key={r.value}
                variant={dateRange === r.value ? "secondary" : "ghost"}
                size="sm"
                className="h-7 text-xs"
                onClick={() => setDateRange(r.value)}
              >
                {r.label}
              </Button>
            ))}
          </div>
          {dailyData && dailyData.length > 0 && (
            <>
              <div className="h-4 w-px bg-border" />
              <Button
                variant="ghost"
                size="sm"
                className="h-7 text-xs gap-1"
                onClick={() =>
                  exportCSV(
                    dailyData.map((d) => ({
                      date: d.date,
                      input_tokens: d.input_tokens,
                      output_tokens: d.output_tokens,
                      cache_create: d.cache_creation_input_tokens,
                      cache_read: d.cache_read_input_tokens,
                      cost: d.totalCost.toFixed(4),
                      sessions: d.sessionCount,
                    })),
                    `token-usage-${dateRange}d.csv`,
                    [
                      { key: "date", label: "Date" },
                      { key: "input_tokens", label: "Input Tokens" },
                      { key: "output_tokens", label: "Output Tokens" },
                      { key: "cache_create", label: "Cache Create" },
                      { key: "cache_read", label: "Cache Read" },
                      { key: "cost", label: "Cost (USD)" },
                      { key: "sessions", label: "Sessions" },
                    ]
                  )
                }
                aria-label="Export token data as CSV"
                title="Export as CSV"
              >
                <Download className="h-3 w-3" aria-hidden="true" />
                CSV
              </Button>
              <Button
                variant="ghost"
                size="sm"
                className="h-7 text-xs gap-1"
                onClick={() =>
                  exportJSON(dailyData, `token-usage-${dateRange}d.json`)
                }
                aria-label="Export token data as JSON"
                title="Export as JSON"
              >
                <Download className="h-3 w-3" aria-hidden="true" />
                JSON
              </Button>
            </>
          )}
        </div>
      </div>

      {/* Summary cards */}
      <div className={`grid gap-4 ${isApi ? "md:grid-cols-4" : "md:grid-cols-3"}`}>
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-medium">Input Tokens</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">{formatTokens(totalInput)}</div>
            <p className="text-xs text-muted-foreground">Last {dateRange} days</p>
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-medium">Output Tokens</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">{formatTokens(totalOutput)}</div>
            <p className="text-xs text-muted-foreground">Last {dateRange} days</p>
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="pb-2">
            <div className="flex items-center justify-between">
              <CardTitle className="text-sm font-medium">Cache Tokens</CardTitle>
              {trend !== 0 && (
                <Badge
                  variant={trend > 0 ? "destructive" : "secondary"}
                  className="text-[10px] gap-1"
                >
                  {trend > 0 ? (
                    <TrendingUp className="h-3 w-3" aria-hidden="true" />
                  ) : (
                    <TrendingDown className="h-3 w-3" aria-hidden="true" />
                  )}
                  {Math.abs(Math.round(trend))}%
                </Badge>
              )}
            </div>
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">{formatTokens(totalCache)}</div>
            <p className="text-xs text-muted-foreground">
              {trend > 0 ? "Up" : trend < 0 ? "Down" : "Flat"} vs prior week
            </p>
          </CardContent>
        </Card>
        {isApi && (
          <Card>
            <CardHeader className="pb-2">
              <CardTitle className="text-sm font-medium flex items-center gap-1.5">
                <DollarSign className="h-3.5 w-3.5" aria-hidden="true" />
                Estimated Cost
              </CardTitle>
            </CardHeader>
            <CardContent>
              <div className="text-2xl font-bold">{formatCost(totalCost)}</div>
              <p className="text-xs text-muted-foreground">Last {dateRange} days</p>
            </CardContent>
          </Card>
        )}
      </div>

      {/* Cost estimation for subscription users */}
      {!isApi && totalCost > 0 && (
        <Card className="border-dashed">
          <CardContent className="flex items-center gap-3 py-3">
            <DollarSign className="h-4 w-4 text-muted-foreground shrink-0" aria-hidden="true" />
            <p className="text-sm text-muted-foreground">
              Equivalent API cost for this period would be{" "}
              <span className="font-medium text-foreground">{formatCost(totalCost)}</span>
              {" "}based on current Sonnet pricing.
            </p>
          </CardContent>
        </Card>
      )}

      {/* Daily usage time-series chart */}
      {formattedDaily.length > 0 && (
        <Card>
          <CardHeader>
            <CardTitle className="text-lg">Daily Usage Trend</CardTitle>
          </CardHeader>
          <CardContent>
            <figure
              role="img"
              aria-label={`Daily token usage over the last ${dateRange} days. Total: ${formatTokens(totalInput + totalOutput + totalCache)} tokens.`}
            >
              <ResponsiveContainer width="100%" height={350}>
                <AreaChart data={formattedDaily}>
                  <CartesianGrid strokeDasharray="3 3" stroke={colors.grid} />
                  <XAxis
                    dataKey="label"
                    fontSize={11}
                    tick={{ fill: colors.axis }}
                    axisLine={{ stroke: colors.grid }}
                    tickLine={{ stroke: colors.grid }}
                    interval={dateRange <= 14 ? 0 : "preserveStartEnd"}
                  />
                  <YAxis
                    fontSize={12}
                    tick={{ fill: colors.axis }}
                    axisLine={{ stroke: colors.grid }}
                    tickLine={{ stroke: colors.grid }}
                    tickFormatter={(v) => formatTokens(v)}
                  />
                  <Tooltip
                    contentStyle={{
                      backgroundColor: colors.tooltipBg,
                      border: `1px solid ${colors.tooltipBorder}`,
                      borderRadius: "8px",
                      color: colors.tooltipText,
                      fontSize: 13,
                    }}
                    labelStyle={{ color: colors.tooltipText, marginBottom: 4 }}
                    itemStyle={{ color: colors.tooltipText, padding: "1px 0" }}
                    formatter={(value: unknown, name: unknown) => [
                      formatTokens(Number(value)),
                      String(name),
                    ]}
                  />
                  <Legend
                    content={(props) => (
                      <InteractiveLegend
                        payload={props.payload}
                        hidden={areaHidden}
                        onToggle={(k) => toggleHidden("area", k)}
                        legendColor={colors.legend}
                        legendMuted={colors.legendMuted}
                      />
                    )}
                  />
                  {AREA_SERIES.map((s) => (
                    <Area
                      key={s.dataKey}
                      type="monotone"
                      dataKey={s.dataKey}
                      name={s.name}
                      stackId="1"
                      stroke={s.color}
                      fill={s.color}
                      fillOpacity={areaHidden.has(s.dataKey) ? 0 : 0.3}
                      strokeOpacity={areaHidden.has(s.dataKey) ? 0 : 1}
                      hide={areaHidden.has(s.dataKey)}
                    />
                  ))}
                </AreaChart>
              </ResponsiveContainer>
            </figure>
          </CardContent>
        </Card>
      )}

      {/* Per-project bar chart */}
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
            <figure
              role="img"
              aria-label={`Bar chart showing token usage by project. ${chartData.length} projects.`}
            >
              <ResponsiveContainer width="100%" height={400}>
                <BarChart data={chartData}>
                  <CartesianGrid strokeDasharray="3 3" stroke={colors.grid} />
                  <XAxis
                    dataKey="name"
                    fontSize={12}
                    tick={{ fill: colors.axis }}
                    axisLine={{ stroke: colors.grid }}
                    tickLine={{ stroke: colors.grid }}
                  />
                  <YAxis
                    fontSize={12}
                    tick={{ fill: colors.axis }}
                    axisLine={{ stroke: colors.grid }}
                    tickLine={{ stroke: colors.grid }}
                    tickFormatter={(v) => formatTokens(v)}
                  />
                  <Tooltip
                    contentStyle={{
                      backgroundColor: colors.tooltipBg,
                      border: `1px solid ${colors.tooltipBorder}`,
                      borderRadius: "8px",
                      color: colors.tooltipText,
                      fontSize: 13,
                    }}
                    labelStyle={{ color: colors.tooltipText, marginBottom: 4 }}
                    itemStyle={{ color: colors.tooltipText, padding: "1px 0" }}
                    formatter={(value: unknown, name: unknown) => [
                      formatTokens(Number(value)),
                      String(name),
                    ]}
                    cursor={{ fill: colors.cursor }}
                  />
                  <Legend
                    content={(props) => (
                      <InteractiveLegend
                        payload={props.payload}
                        hidden={barHidden}
                        onToggle={(k) => toggleHidden("bar", k)}
                        legendColor={colors.legend}
                        legendMuted={colors.legendMuted}
                      />
                    )}
                  />
                  {BAR_SERIES.map((s) => (
                    <Bar
                      key={s.dataKey}
                      dataKey={s.dataKey}
                      name={s.name}
                      fill={s.color}
                      hide={barHidden.has(s.dataKey)}
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
