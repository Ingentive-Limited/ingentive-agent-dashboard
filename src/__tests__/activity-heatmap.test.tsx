import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen } from "@testing-library/react";
import { ActivityHeatmap } from "@/components/activity-heatmap";
import type { DailyTokenUsage } from "@/lib/types";

// Mock next-themes
vi.mock("next-themes", () => ({
  useTheme: () => ({ resolvedTheme: "light" }),
}));

function makeDailyData(days: number): DailyTokenUsage[] {
  const data: DailyTokenUsage[] = [];
  const today = new Date();
  for (let i = 0; i < days; i++) {
    const d = new Date(today);
    d.setDate(d.getDate() - i);
    const dateStr = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
    data.push({
      date: dateStr,
      input_tokens: Math.floor(Math.random() * 100000),
      output_tokens: Math.floor(Math.random() * 50000),
      cache_creation_input_tokens: 0,
      cache_read_input_tokens: 0,
      totalCost: 0,
      sessionCount: 1,
    });
  }
  return data;
}

describe("ActivityHeatmap", () => {
  it("renders SVG with heatmap cells", () => {
    const data = makeDailyData(30);
    const { container } = render(<ActivityHeatmap data={data} />);
    const svg = container.querySelector("svg");
    expect(svg).toBeTruthy();
    const rects = container.querySelectorAll("rect");
    expect(rects.length).toBeGreaterThan(0);
  });

  it("renders legend", () => {
    const data = makeDailyData(10);
    render(<ActivityHeatmap data={data} />);
    expect(screen.getByText("Less")).toBeTruthy();
    expect(screen.getByText("More")).toBeTruthy();
  });

  it("has accessible aria-label on SVG", () => {
    const data = makeDailyData(10);
    const { container } = render(<ActivityHeatmap data={data} />);
    const svg = container.querySelector("svg");
    expect(svg?.getAttribute("aria-label")).toContain("Activity heatmap");
  });

  it("renders gridcells with aria-labels", () => {
    const data = makeDailyData(5);
    const { container } = render(<ActivityHeatmap data={data} />);
    const cells = container.querySelectorAll('[role="gridcell"]');
    expect(cells.length).toBeGreaterThan(0);
    // Each cell should have an aria-label
    cells.forEach((cell) => {
      expect(cell.getAttribute("aria-label")).toBeTruthy();
    });
  });

  it("handles empty data", () => {
    const { container } = render(<ActivityHeatmap data={[]} />);
    const svg = container.querySelector("svg");
    expect(svg).toBeTruthy();
  });
});
