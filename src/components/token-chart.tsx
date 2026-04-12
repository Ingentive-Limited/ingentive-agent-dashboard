"use client";

import { useState, useCallback } from "react";
import {
  AreaChart,
  Area,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer,
  Legend,
} from "recharts";
import { useTheme } from "next-themes";
import type { TokenDataPoint } from "@/lib/types";
import { formatTokens } from "@/lib/utils";

function useChartColors() {
  const { resolvedTheme } = useTheme();
  const isDark = resolvedTheme === "dark";

  return {
    input: "#3b82f6",
    output: "#22c55e",
    cacheCreate: "#f97316",
    cacheRead: "#a855f7",
    grid: isDark ? "#333" : "#e5e7eb",
    axis: isDark ? "#999" : "#6b7280",
    tooltipBg: isDark ? "#1a1a1a" : "#ffffff",
    tooltipBorder: isDark ? "#333" : "#e5e7eb",
    tooltipText: isDark ? "#e5e5e5" : "#1f2937",
    legendText: isDark ? "#999" : "#6b7280",
    legendTextMuted: isDark ? "#555" : "#c4c4c4",
  };
}

const SERIES = [
  { dataKey: "input_tokens", name: "Input", colorKey: "input" as const },
  { dataKey: "output_tokens", name: "Output", colorKey: "output" as const },
  { dataKey: "cache_creation_input_tokens", name: "Cache Create", colorKey: "cacheCreate" as const },
  { dataKey: "cache_read_input_tokens", name: "Cache Read", colorKey: "cacheRead" as const },
];

export function TokenChart({ data }: { data: TokenDataPoint[] }) {
  const colors = useChartColors();
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

  const formatted = data.map((d) => ({
    ...d,
    time: new Date(d.timestamp).toLocaleTimeString([], {
      hour: "2-digit",
      minute: "2-digit",
    }),
  }));

  const totalInput = data.reduce((sum, d) => sum + d.input_tokens, 0);
  const totalOutput = data.reduce((sum, d) => sum + d.output_tokens, 0);
  const summaryText = `Token usage over time chart. ${data.length} data points. Total input: ${formatTokens(totalInput)}, total output: ${formatTokens(totalOutput)}.`;

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const renderLegend = useCallback(
    (props: any) => {
      const payload = props?.payload as Array<{ value: string; dataKey?: string; color?: string }> | undefined;
      if (!payload) return null;
      return (
        <div className="flex justify-center gap-4 mt-2 text-xs">
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
                    backgroundColor: isHidden ? colors.legendTextMuted : entry.color,
                  }}
                  aria-hidden="true"
                />
                <span style={{ color: isHidden ? colors.legendTextMuted : colors.legendText }}>
                  {entry.value}
                </span>
              </button>
            );
          })}
        </div>
      );
    },
    [hidden, handleLegendClick, colors.legendText, colors.legendTextMuted]
  );

  return (
    <figure role="img" aria-label={summaryText}>
      <ResponsiveContainer width="100%" height={350}>
        <AreaChart data={formatted}>
          <CartesianGrid strokeDasharray="3 3" stroke={colors.grid} />
          <XAxis
            dataKey="time"
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
          />
          <Legend content={renderLegend} />
          {SERIES.map((s) => (
            <Area
              key={s.dataKey}
              type="monotone"
              dataKey={s.dataKey}
              name={s.name}
              stackId="1"
              stroke={colors[s.colorKey]}
              fill={colors[s.colorKey]}
              fillOpacity={hidden.has(s.dataKey) ? 0 : 0.3}
              strokeOpacity={hidden.has(s.dataKey) ? 0 : 1}
              hide={hidden.has(s.dataKey)}
            />
          ))}
        </AreaChart>
      </ResponsiveContainer>
    </figure>
  );
}
