"use client";

import { useState, useCallback, useMemo } from "react";
import {
  AreaChart,
  Area,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer,
  Legend,
  ReferenceLine,
} from "recharts";
import { useTheme } from "next-themes";
import type { TokenDataPoint } from "@/lib/types";
import { formatTokens } from "@/lib/utils";

const HOUR_MS = 60 * 60 * 1000;
const DAY_MS = 24 * HOUR_MS;

/**
 * Choose a sensible stride (in hours) for the hour-boundary ticks so the
 * axis stays readable regardless of whether the series covers an hour or
 * several days. Targets ~6–12 ticks across the visible range.
 *
 * Exported for unit testing — not part of the public component API.
 */
export function pickHourStride(spanMs: number): number {
  if (spanMs <= 6 * HOUR_MS) return 1;
  if (spanMs <= 12 * HOUR_MS) return 2;
  if (spanMs <= DAY_MS) return 3;
  if (spanMs <= 3 * DAY_MS) return 6;
  if (spanMs <= 7 * DAY_MS) return 12;
  return 24;
}

/**
 * Build the array of millisecond ticks for hour boundaries between [minTs, maxTs].
 * Ticks land on the wall-clock hour (e.g. 14:00, 16:00) in the user's local
 * timezone, with stride chosen by `pickHourStride`.
 *
 * Exported for unit testing — not part of the public component API.
 */
export function buildHourTicks(minTs: number, maxTs: number): number[] {
  if (!Number.isFinite(minTs) || !Number.isFinite(maxTs) || maxTs <= minTs) {
    return [];
  }
  const stride = pickHourStride(maxTs - minTs);
  const start = new Date(minTs);
  start.setMinutes(0, 0, 0);
  // Align the first tick to the chosen stride so e.g. with stride=6 we get
  // 00:00, 06:00, 12:00, 18:00 instead of arbitrary offsets.
  start.setHours(Math.ceil(start.getHours() / stride) * stride);
  // If we rounded up past the data start, that's fine — we want the first
  // boundary inside the range. If we rounded down (shouldn't happen) advance.
  let t = start.getTime();
  if (t < minTs) t += stride * HOUR_MS;
  const ticks: number[] = [];
  while (t <= maxTs && ticks.length < 24) {
    ticks.push(t);
    t += stride * HOUR_MS;
  }
  return ticks;
}

/**
 * Format a tick label. Single-day spans show "HH:00"; multi-day spans
 * include a short date so users can see day boundaries.
 */
function formatHourTick(ts: number, multiDay: boolean): string {
  const d = new Date(ts);
  const hh = String(d.getHours()).padStart(2, "0");
  if (!multiDay) return `${hh}:00`;
  return `${d.toLocaleDateString([], { month: "short", day: "numeric" })} ${hh}:00`;
}

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
    // Hour-boundary reference lines: a touch more visible than the grid so
    // hour boundaries stand out, but still secondary to the data itself.
    hourMarker: isDark ? "#4a4a4a" : "#cbd5e1",
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

  // Use a categorical x-axis (one slot per data point) so that recharts
  // reliably honors our custom `ticks` prop — recharts v3 has known issues
  // applying custom ticks when the axis is `type="number"` with a dataKey.
  const formatted = useMemo(
    () =>
      data
        .map((d) => {
          const date = new Date(d.timestamp);
          const ts = date.getTime();
          if (!Number.isFinite(ts)) return null;
          return {
            ...d,
            ts,
            time: date.toLocaleTimeString([], {
              hour: "2-digit",
              minute: "2-digit",
            }),
          };
        })
        .filter((d): d is NonNullable<typeof d> => d !== null)
        .sort((a, b) => a.ts - b.ts),
    [data]
  );

  // Identify the indices that are the FIRST data point in each hour — those
  // are the natural hour boundaries to surface as ticks. We then apply a
  // stride so we don't end up with 12 ticks crammed together on a long span.
  const { hourTickValues, hourTickByValue, multiDay } = useMemo(() => {
    if (formatted.length === 0) {
      return {
        hourTickValues: [] as string[],
        hourTickByValue: new Map<string, number>(),
        multiDay: false,
      };
    }
    const minTs = formatted[0].ts;
    const maxTs = formatted[formatted.length - 1].ts;
    const stride = pickHourStride(maxTs - minTs);

    // For each data point, what hour-key does it belong to (e.g. "2026-05-26-14")?
    const seen = new Set<string>();
    // Track which `time` string maps to which hour boundary (ms) — used by
    // the tickFormatter so a tick at e.g. 14:23 renders as "14:00".
    const boundaryByTime = new Map<string, number>();
    const boundaries: string[] = [];
    for (const point of formatted) {
      const d = new Date(point.ts);
      const hour = d.getHours();
      // Bucket into stride-aligned hour groups
      const bucketHour = Math.floor(hour / stride) * stride;
      const key = `${d.getFullYear()}-${d.getMonth()}-${d.getDate()}-${bucketHour}`;
      if (seen.has(key)) continue;
      seen.add(key);
      // Use this data point's `time` as the tick value, but remember the
      // bucket's hour boundary so we can render it as e.g. "14:00".
      const boundary = new Date(d);
      boundary.setHours(bucketHour, 0, 0, 0);
      boundaries.push(point.time);
      boundaryByTime.set(point.time, boundary.getTime());
    }
    return {
      hourTickValues: boundaries,
      hourTickByValue: boundaryByTime,
      multiDay: maxTs - minTs > DAY_MS,
    };
  }, [formatted]);

  const totalInput = data.reduce((sum, d) => sum + d.input_tokens, 0);
  const totalOutput = data.reduce((sum, d) => sum + d.output_tokens, 0);
  const summaryText = `Token usage over time chart. ${data.length} data points. Total input: ${formatTokens(totalInput)}, total output: ${formatTokens(totalOutput)}.`;

  const renderLegend = useCallback(
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (props: any) => {
      const { payload } = props;
      if (!payload) return null;
      return (
        <div className="flex justify-center gap-4 mt-2 text-xs">
          {payload.map((entry: { value?: string; dataKey?: string; color?: string }) => {
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
            ticks={hourTickValues.length > 0 ? hourTickValues : undefined}
            // preserveStartEnd lets recharts drop tick labels that would
            // visually overlap (helpful when the data is bunched up at one
            // end of a long span). The first and last tick are always kept.
            interval="preserveStartEnd"
            minTickGap={multiDay ? 40 : 20}
            fontSize={12}
            // Custom tick renderer: full control over which label to show.
            // recharts v3's auto-tickFormatter handling is unreliable when
            // combined with a custom `ticks` array, so we render the labels
            // ourselves here. The label for each tick is the corresponding
            // hour boundary (e.g. "14:00") instead of the raw HH:MM value.
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            tick={(props: any) => {
              const value = String(props?.payload?.value ?? "");
              const boundary = hourTickByValue.get(value);
              const label =
                boundary !== undefined
                  ? formatHourTick(boundary, multiDay)
                  : value;
              return (
                <text
                  x={props.x}
                  y={props.y}
                  dy={16}
                  textAnchor={props.textAnchor ?? "middle"}
                  fill={colors.axis}
                  fontSize={12}
                >
                  {label}
                </text>
              );
            }}
            axisLine={{ stroke: colors.grid }}
            tickLine={{ stroke: colors.grid }}
            type="category"
            allowDuplicatedCategory={false}
          />
          <YAxis
            fontSize={12}
            tick={{ fill: colors.axis }}
            axisLine={{ stroke: colors.grid }}
            tickLine={{ stroke: colors.grid }}
            tickFormatter={(v) => formatTokens(v)}
          />
          {/*
            Hour-boundary reference lines. These give users a clear visual
            anchor for "where the day broke" — much easier to spot a spike
            at e.g. 14:00 than scanning crowded HH:MM tick labels.
          */}
          {hourTickValues.map((tick) => (
            <ReferenceLine
              key={tick}
              x={tick}
              stroke={colors.hourMarker}
              strokeDasharray="2 4"
              strokeWidth={1}
              ifOverflow="hidden"
            />
          ))}
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
            // Tooltip label shows the data point's HH:MM (the `time` field
            // from `formatted`) — that's already the same string the axis
            // uses as a category, so recharts passes it through as-is.
            labelFormatter={(value, payload) => {
              if (multiDay && payload && payload.length > 0) {
                const ts = (payload[0].payload as { ts?: number })?.ts;
                if (typeof ts === "number") {
                  const d = new Date(ts);
                  return `${d.toLocaleDateString([], {
                    month: "short",
                    day: "numeric",
                  })} ${value}`;
                }
              }
              return String(value);
            }}
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
