"use client";

import { usePolling } from "@/hooks/use-polling";
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

  if (isLoading || !projects) {
    return (
      <div className="space-y-6">
        <h1 className="text-2xl font-bold">Token Usage</h1>
        <Skeleton className="h-96" />
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
            <ResponsiveContainer width="100%" height={400}>
              <BarChart data={chartData}>
                <CartesianGrid strokeDasharray="3 3" stroke="#333" />
                <XAxis
                  dataKey="name"
                  fontSize={12}
                  tick={{ fill: "#999" }}
                  axisLine={{ stroke: "#333" }}
                  tickLine={{ stroke: "#333" }}
                />
                <YAxis
                  fontSize={12}
                  tick={{ fill: "#999" }}
                  axisLine={{ stroke: "#333" }}
                  tickLine={{ stroke: "#333" }}
                  tickFormatter={(v) => formatTokens(v)}
                />
                <Tooltip
                  contentStyle={{
                    backgroundColor: "#1a1a1a",
                    border: "1px solid #333",
                    borderRadius: "8px",
                    color: "#e5e5e5",
                    fontSize: 13,
                  }}
                  labelStyle={{ color: "#e5e5e5", marginBottom: 4 }}
                  itemStyle={{ color: "#e5e5e5", padding: "1px 0" }}
                  formatter={(value: unknown, name: unknown) => [
                    formatTokens(Number(value)),
                    String(name),
                  ]}
                  cursor={{ fill: "rgba(255,255,255,0.05)" }}
                />
                <Legend wrapperStyle={{ color: "#999", fontSize: 12 }} />
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
          )}
        </CardContent>
      </Card>
    </div>
  );
}
