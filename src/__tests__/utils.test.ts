import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { cn, formatDuration, formatTokens, formatCost, formatRelativeTime, formatEntrypoint } from "@/lib/utils";

describe("cn", () => {
  it("merges class names", () => {
    expect(cn("foo", "bar")).toBe("foo bar");
  });

  it("handles conditional classes", () => {
    expect(cn("base", false && "hidden", "visible")).toBe("base visible");
  });

  it("merges tailwind conflicts", () => {
    expect(cn("p-4", "p-2")).toBe("p-2");
  });

  it("handles empty inputs", () => {
    expect(cn()).toBe("");
  });
});

describe("formatDuration", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-04-12T12:00:00Z"));
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("formats minutes only", () => {
    const thirtyMinAgo = Date.now() - 30 * 60 * 1000;
    expect(formatDuration(thirtyMinAgo)).toBe("30m");
  });

  it("formats hours and minutes", () => {
    const twoHoursAgo = Date.now() - 2 * 60 * 60 * 1000 - 15 * 60 * 1000;
    expect(formatDuration(twoHoursAgo)).toBe("2h 15m");
  });

  it("returns 0m for current time", () => {
    expect(formatDuration(Date.now())).toBe("0m");
  });
});

describe("formatTokens", () => {
  it("formats millions", () => {
    expect(formatTokens(1_500_000)).toBe("1.5M");
  });

  it("formats thousands", () => {
    expect(formatTokens(45_000)).toBe("45.0K");
  });

  it("formats small numbers as-is", () => {
    expect(formatTokens(500)).toBe("500");
  });

  it("handles zero", () => {
    expect(formatTokens(0)).toBe("0");
  });

  it("formats exactly 1M", () => {
    expect(formatTokens(1_000_000)).toBe("1.0M");
  });

  it("formats exactly 1K", () => {
    expect(formatTokens(1_000)).toBe("1.0K");
  });
});

describe("formatCost", () => {
  it("formats costs >= $1", () => {
    expect(formatCost(12.345)).toBe("$12.35");
  });

  it("formats costs >= $0.01", () => {
    expect(formatCost(0.05)).toBe("$0.050");
  });

  it("formats costs >= $0.001", () => {
    expect(formatCost(0.005)).toBe("$0.0050");
  });

  it("returns $0.00 for zero", () => {
    expect(formatCost(0)).toBe("$0.00");
  });

  it("returns <$0.001 for very small costs", () => {
    expect(formatCost(0.0001)).toBe("<$0.001");
  });
});

describe("formatRelativeTime", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-04-12T12:00:00Z"));
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("returns 'just now' for recent times", () => {
    expect(formatRelativeTime("2026-04-12T12:00:00Z")).toBe("just now");
  });

  it("formats minutes ago", () => {
    expect(formatRelativeTime("2026-04-12T11:45:00Z")).toBe("15m ago");
  });

  it("formats hours ago", () => {
    expect(formatRelativeTime("2026-04-12T09:00:00Z")).toBe("3h ago");
  });

  it("formats days ago", () => {
    expect(formatRelativeTime("2026-04-10T12:00:00Z")).toBe("2d ago");
  });
});

describe("formatEntrypoint", () => {
  it("maps claude-desktop to Desktop", () => {
    expect(formatEntrypoint("claude-desktop")).toBe("Desktop");
  });

  it("maps vscode to VSCode (Codex VSCode extension)", () => {
    expect(formatEntrypoint("vscode")).toBe("VSCode");
  });

  it("maps codex_desktop to Desktop (Codex Desktop app)", () => {
    expect(formatEntrypoint("codex_desktop")).toBe("Desktop");
  });

  it("maps desktop to Desktop", () => {
    expect(formatEntrypoint("desktop")).toBe("Desktop");
  });

  it("maps cli to CLI", () => {
    expect(formatEntrypoint("cli")).toBe("CLI");
  });

  it("maps undefined to CLI as a safe default", () => {
    expect(formatEntrypoint(undefined)).toBe("CLI");
  });

  it("maps empty string to CLI", () => {
    expect(formatEntrypoint("")).toBe("CLI");
  });

  it("capitalizes unknown entrypoints rather than hiding them", () => {
    expect(formatEntrypoint("jetbrains")).toBe("Jetbrains");
  });

  it("is case-insensitive for known values", () => {
    expect(formatEntrypoint("VSCODE")).toBe("VSCode");
    expect(formatEntrypoint("Claude-Desktop")).toBe("Desktop");
  });
});
