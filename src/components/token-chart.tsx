"use client";

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
import type { TokenDataPoint } from "@/lib/types";
import { formatTokens } from "@/lib/utils";

const COLORS = {
  input: "#3b82f6",
  output: "#22c55e",
  cacheCreate: "#f97316",
  cacheRead: "#a855f7",
  grid: "#333",
  axis: "#999",
  tooltipBg: "#1a1a1a",
  tooltipBorder: "#333",
  tooltipText: "#e5e5e5",
  legendText: "#999",
};

export function TokenChart({ data }: { data: TokenDataPoint[] }) {
  const formatted = data.map((d) => ({
    ...d,
    time: new Date(d.timestamp).toLocaleTimeString([], {
      hour: "2-digit",
      minute: "2-digit",
    }),
  }));

  return (
    <ResponsiveContainer width="100%" height={350}>
      <AreaChart data={formatted}>
        <CartesianGrid strokeDasharray="3 3" stroke={COLORS.grid} />
        <XAxis
          dataKey="time"
          fontSize={12}
          tick={{ fill: COLORS.axis }}
          axisLine={{ stroke: COLORS.grid }}
          tickLine={{ stroke: COLORS.grid }}
        />
        <YAxis
          fontSize={12}
          tick={{ fill: COLORS.axis }}
          axisLine={{ stroke: COLORS.grid }}
          tickLine={{ stroke: COLORS.grid }}
          tickFormatter={(v) => formatTokens(v)}
        />
        <Tooltip
          contentStyle={{
            backgroundColor: COLORS.tooltipBg,
            border: `1px solid ${COLORS.tooltipBorder}`,
            borderRadius: "8px",
            color: COLORS.tooltipText,
            fontSize: 13,
          }}
          labelStyle={{ color: COLORS.tooltipText, marginBottom: 4 }}
          itemStyle={{ color: COLORS.tooltipText, padding: "1px 0" }}
          formatter={(value: unknown, name: unknown) => [
            formatTokens(Number(value)),
            String(name),
          ]}
        />
        <Legend wrapperStyle={{ color: COLORS.legendText, fontSize: 12 }} />
        <Area
          type="monotone"
          dataKey="input_tokens"
          name="Input"
          stackId="1"
          stroke={COLORS.input}
          fill={COLORS.input}
          fillOpacity={0.3}
        />
        <Area
          type="monotone"
          dataKey="output_tokens"
          name="Output"
          stackId="1"
          stroke={COLORS.output}
          fill={COLORS.output}
          fillOpacity={0.3}
        />
        <Area
          type="monotone"
          dataKey="cache_creation_input_tokens"
          name="Cache Create"
          stackId="1"
          stroke={COLORS.cacheCreate}
          fill={COLORS.cacheCreate}
          fillOpacity={0.3}
        />
        <Area
          type="monotone"
          dataKey="cache_read_input_tokens"
          name="Cache Read"
          stackId="1"
          stroke={COLORS.cacheRead}
          fill={COLORS.cacheRead}
          fillOpacity={0.3}
        />
      </AreaChart>
    </ResponsiveContainer>
  );
}
