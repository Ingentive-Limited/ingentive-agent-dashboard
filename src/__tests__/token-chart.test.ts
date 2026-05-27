import { describe, it, expect } from "vitest";
import { pickHourStride, buildHourTicks } from "@/components/token-chart";

const HOUR = 60 * 60 * 1000;
const DAY = 24 * HOUR;

describe("pickHourStride", () => {
  it("uses an hourly stride for short ranges", () => {
    expect(pickHourStride(HOUR)).toBe(1);
    expect(pickHourStride(5 * HOUR)).toBe(1);
    expect(pickHourStride(6 * HOUR)).toBe(1);
  });

  it("uses 2-hour stride between 6h and 12h", () => {
    expect(pickHourStride(7 * HOUR)).toBe(2);
    expect(pickHourStride(12 * HOUR)).toBe(2);
  });

  it("uses 3-hour stride between 12h and 24h", () => {
    expect(pickHourStride(13 * HOUR)).toBe(3);
    expect(pickHourStride(DAY)).toBe(3);
  });

  it("uses 6-hour stride between 1 and 3 days", () => {
    expect(pickHourStride(DAY + HOUR)).toBe(6);
    expect(pickHourStride(3 * DAY)).toBe(6);
  });

  it("uses 12-hour stride between 3 and 7 days", () => {
    expect(pickHourStride(4 * DAY)).toBe(12);
    expect(pickHourStride(7 * DAY)).toBe(12);
  });

  it("uses 24-hour stride beyond a week", () => {
    expect(pickHourStride(8 * DAY)).toBe(24);
    expect(pickHourStride(30 * DAY)).toBe(24);
  });
});

describe("buildHourTicks", () => {
  it("returns empty array for invalid ranges", () => {
    expect(buildHourTicks(NaN, 0)).toEqual([]);
    expect(buildHourTicks(100, 100)).toEqual([]);
    expect(buildHourTicks(200, 100)).toEqual([]);
  });

  it("emits ticks on whole-hour boundaries inside the range", () => {
    // 09:15 to 12:45 local on 2026-04-18 — should emit ticks at 10:00,
    // 11:00, and 12:00 (stride = 1 because span < 6h).
    const start = new Date(2026, 3, 18, 9, 15).getTime();
    const end = new Date(2026, 3, 18, 12, 45).getTime();
    const ticks = buildHourTicks(start, end);
    const hours = ticks.map((t) => {
      const d = new Date(t);
      // All ticks must land on the minute 0 / second 0 of the hour.
      expect(d.getMinutes()).toBe(0);
      expect(d.getSeconds()).toBe(0);
      return d.getHours();
    });
    expect(hours).toEqual([10, 11, 12]);
  });

  it("aligns ticks to the stride (e.g. multiples of 6 at 00:00/06:00/12:00/18:00)", () => {
    // 2-day span → stride should be 6
    const start = new Date(2026, 3, 18, 1, 0).getTime();
    const end = new Date(2026, 3, 20, 1, 0).getTime();
    const ticks = buildHourTicks(start, end);
    expect(ticks.length).toBeGreaterThan(0);
    for (const t of ticks) {
      const h = new Date(t).getHours();
      expect(h % 6).toBe(0);
    }
  });

  it("never produces ticks outside the requested range", () => {
    const start = new Date(2026, 3, 18, 10, 30).getTime();
    const end = new Date(2026, 3, 18, 14, 30).getTime();
    const ticks = buildHourTicks(start, end);
    for (const t of ticks) {
      expect(t).toBeGreaterThanOrEqual(start);
      expect(t).toBeLessThanOrEqual(end);
    }
  });

  it("caps at 24 ticks even for very long ranges", () => {
    const start = new Date(2026, 0, 1).getTime();
    const end = new Date(2026, 11, 31).getTime();
    const ticks = buildHourTicks(start, end);
    expect(ticks.length).toBeLessThanOrEqual(24);
  });
});
