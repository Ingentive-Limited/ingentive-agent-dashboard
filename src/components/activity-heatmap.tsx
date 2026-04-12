"use client";

import { useMemo, useState } from "react";
import { useTheme } from "next-themes";
import type { DailyTokenUsage } from "@/lib/types";

const DAYS_OF_WEEK = ["", "Mon", "", "Wed", "", "Fri", ""];
const WEEKS_TO_SHOW = 20;

function getIntensity(value: number, max: number): number {
  if (value === 0 || max === 0) return 0;
  const ratio = value / max;
  if (ratio < 0.25) return 1;
  if (ratio < 0.5) return 2;
  if (ratio < 0.75) return 3;
  return 4;
}

function formatTokensShort(n: number): string {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
  if (n >= 1_000) return `${(n / 1_000).toFixed(0)}K`;
  return String(n);
}

interface HoverInfo {
  date: string;
  value: number;
  x: number;
  y: number;
}

export function ActivityHeatmap({ data }: { data: DailyTokenUsage[] }) {
  const { resolvedTheme } = useTheme();
  const isDark = resolvedTheme === "dark";
  const [hover, setHover] = useState<HoverInfo | null>(null);

  const colors = isDark
    ? ["#1a1a2e", "#1a3a2e", "#1a5a3e", "#1a7a4e", "#22c55e"]
    : ["#ebedf0", "#9be9a8", "#40c463", "#30a14e", "#216e39"];

  const emptyColor = isDark ? "#1a1a2e" : "#ebedf0";

  const { grid, maxVal, months } = useMemo(() => {
    const dateMap = new Map<string, number>();
    let max = 0;
    for (const d of data) {
      const total = d.input_tokens + d.output_tokens;
      dateMap.set(d.date, total);
      if (total > max) max = total;
    }

    const today = new Date();
    const todayDay = today.getDay();
    const startDate = new Date(today);
    startDate.setDate(today.getDate() - todayDay - (WEEKS_TO_SHOW - 1) * 7);

    const weeks: { date: string; value: number; dateObj: Date }[][] = [];
    const monthLabels: { label: string; weekIndex: number }[] = [];
    let lastMonth = -1;

    const cursor = new Date(startDate);
    let weekIndex = 0;
    let currentWeek: { date: string; value: number; dateObj: Date }[] = [];

    while (cursor <= today) {
      const dateKey = cursor.toISOString().slice(0, 10);
      const dayOfWeek = cursor.getDay();

      if (dayOfWeek === 0 && currentWeek.length > 0) {
        weeks.push(currentWeek);
        currentWeek = [];
        weekIndex++;
      }

      const month = cursor.getMonth();
      if (month !== lastMonth) {
        monthLabels.push({
          label: cursor.toLocaleString("default", { month: "short" }),
          weekIndex,
        });
        lastMonth = month;
      }

      currentWeek.push({
        date: dateKey,
        value: dateMap.get(dateKey) || 0,
        dateObj: new Date(cursor),
      });

      cursor.setDate(cursor.getDate() + 1);
    }

    if (currentWeek.length > 0) {
      weeks.push(currentWeek);
    }

    return { grid: weeks, maxVal: max, months: monthLabels };
  }, [data]);

  const cellSize = 14;
  const cellGap = 3;
  const labelWidth = 32;
  const headerHeight = 18;
  const svgWidth = labelWidth + grid.length * (cellSize + cellGap) + 20;
  const svgHeight = headerHeight + 7 * (cellSize + cellGap) + 10;

  return (
    <div className="space-y-2">
      <div className="relative">
        <svg
          viewBox={`0 0 ${svgWidth} ${svgHeight}`}
          width="100%"
          className="block"
          role="img"
          aria-label={`Activity heatmap showing token usage over the last ${WEEKS_TO_SHOW} weeks`}
          onMouseLeave={() => setHover(null)}
          focusable="false"
        >
          {/* Month labels */}
          {months.map((m, i) => (
            <text
              key={i}
              x={labelWidth + m.weekIndex * (cellSize + cellGap)}
              y={10}
              fontSize={10}
              fill={isDark ? "#666" : "#999"}
            >
              {m.label}
            </text>
          ))}

          {/* Day labels */}
          {DAYS_OF_WEEK.map((label, i) => (
            <text
              key={i}
              x={0}
              y={headerHeight + i * (cellSize + cellGap) + cellSize - 2}
              fontSize={10}
              fill={isDark ? "#666" : "#999"}
            >
              {label}
            </text>
          ))}

          {/* Cells */}
          {grid.map((week, wi) =>
            week.map((day) => {
              const dayOfWeek = day.dateObj.getDay();
              const intensity = getIntensity(day.value, maxVal);
              const x = labelWidth + wi * (cellSize + cellGap);
              const y = headerHeight + dayOfWeek * (cellSize + cellGap);

              const dateLabel = day.dateObj.toLocaleDateString(undefined, {
                weekday: "short",
                month: "short",
                day: "numeric",
              });
              const valueLabel = day.value === 0
                ? "No activity"
                : `${formatTokensShort(day.value)} tokens`;

              return (
                <rect
                  key={day.date}
                  x={x}
                  y={y}
                  width={cellSize}
                  height={cellSize}
                  rx={2}
                  fill={day.value === 0 ? emptyColor : colors[intensity]}
                  className="cursor-pointer transition-opacity hover:opacity-80 focus:outline-none focus-visible:ring-2 focus-visible:ring-primary"
                  tabIndex={0}
                  role="gridcell"
                  aria-label={`${dateLabel}: ${valueLabel}`}
                  onMouseEnter={() =>
                    setHover({
                      date: dateLabel,
                      value: day.value,
                      x: x + cellSize / 2,
                      y,
                    })
                  }
                  onFocus={() =>
                    setHover({
                      date: dateLabel,
                      value: day.value,
                      x: x + cellSize / 2,
                      y,
                    })
                  }
                  onBlur={() => setHover(null)}
                />
              );
            })
          )}
        </svg>

        {/* Custom tooltip — positioned as percentage of SVG viewBox */}
        {hover && (
          <div
            className="absolute pointer-events-none z-10 rounded-md px-2.5 py-1.5 text-xs shadow-md"
            style={{
              left: `${(hover.x / svgWidth) * 100}%`,
              top: `${(hover.y / svgHeight) * 100}%`,
              transform: "translate(-50%, -120%)",
              backgroundColor: isDark ? "#1a1a1a" : "#fff",
              border: `1px solid ${isDark ? "#333" : "#e5e7eb"}`,
              color: isDark ? "#e5e5e5" : "#1f2937",
            }}
          >
            <p className="font-medium">{hover.date}</p>
            <p style={{ color: isDark ? "#999" : "#6b7280" }}>
              {hover.value === 0
                ? "No activity"
                : `${formatTokensShort(hover.value)} tokens`}
            </p>
          </div>
        )}
      </div>

      {/* Legend */}
      <div className="flex items-center justify-end gap-1 text-[10px] text-muted-foreground">
        <span>Less</span>
        {colors.map((color, i) => (
          <div
            key={i}
            className="h-2.5 w-2.5 rounded-sm"
            style={{ backgroundColor: color }}
          />
        ))}
        <span>More</span>
      </div>
    </div>
  );
}
