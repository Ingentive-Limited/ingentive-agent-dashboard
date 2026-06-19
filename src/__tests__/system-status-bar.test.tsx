import { describe, it, expect, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { SystemStatusBar } from "@/components/system-status-bar";

vi.mock("@/hooks/use-polling", () => ({
  usePolling: vi.fn().mockReturnValue({
    data: {
      claude: {
        cliVersion: "2.1.104 (Claude Code)",
        apiStatus: "operational",
      },
      activeSessions: 3,
    },
  }),
}));

vi.mock("@/hooks/use-billing-mode", () => ({
  useBillingMode: vi.fn().mockReturnValue({ isApi: true, toggle: vi.fn() }),
}));

vi.mock("@/hooks/use-provider", () => ({
  useProvider: vi.fn().mockReturnValue({ provider: "all", setProvider: vi.fn(), isClaude: false, isCodex: false, isScout: false, isCopilot: false, isAll: true }),
  ProviderProvider: ({ children }: { children: React.ReactNode }) => children,
}));
import React from "react";

describe("SystemStatusBar — collapsed (default)", () => {
  it("shows active session count in the summary line", () => {
    render(<SystemStatusBar />);
    expect(screen.getByText("3 active")).toBeTruthy();
  });

  it("shows billing mode in the summary line", () => {
    render(<SystemStatusBar />);
    expect(screen.getByText("API")).toBeTruthy();
  });

  it("does not show CLI version details when collapsed", () => {
    render(<SystemStatusBar />);
    expect(screen.queryByText("2.1.104 (Claude Code)")).toBeNull();
  });

  it("does not show per-provider rows when collapsed", () => {
    render(<SystemStatusBar />);
    expect(screen.queryByText("Claude")).toBeNull();
  });

  it("rolls up provider health into a single overall status", () => {
    render(<SystemStatusBar />);
    // aria-label communicates the rollup; "operational" since the only
    // provider is operational
    const trigger = screen.getByRole("button");
    expect(trigger.getAttribute("aria-label")).toMatch(/operational/i);
    expect(trigger.getAttribute("aria-expanded")).toBe("false");
  });

  it("has accessible aria-label on container", () => {
    const { container } = render(<SystemStatusBar />);
    const statusDiv = container.querySelector('[aria-label="System status"]');
    expect(statusDiv).toBeTruthy();
  });
});

describe("SystemStatusBar — expanding", () => {
  it("reveals per-provider rows after clicking the summary", async () => {
    const user = userEvent.setup();
    render(<SystemStatusBar />);
    expect(screen.queryByText("Claude")).toBeNull();
    await user.click(screen.getByRole("button"));
    expect(screen.getByText("Claude")).toBeTruthy();
    expect(screen.getByText("OK")).toBeTruthy();
    expect(screen.getByText("2.1.104 (Claude Code)")).toBeTruthy();
  });
});

describe("SystemStatusBar — degraded rollup", () => {
  it("flags overall status as degraded when a provider is degraded", async () => {
    const { usePolling } = await import("@/hooks/use-polling");
    (usePolling as ReturnType<typeof vi.fn>).mockReturnValue({
      data: {
        claude: { cliVersion: "2.1.104", apiStatus: "degraded" },
        activeSessions: 0,
      },
    });
    render(<SystemStatusBar />);
    const trigger = screen.getByRole("button");
    expect(trigger.getAttribute("aria-label")).toMatch(/degraded/i);
  });

  it("shows per-provider degraded text only after expanding", async () => {
    const { usePolling } = await import("@/hooks/use-polling");
    (usePolling as ReturnType<typeof vi.fn>).mockReturnValue({
      data: {
        claude: { cliVersion: "2.1.104", apiStatus: "degraded" },
        activeSessions: 0,
      },
    });
    const user = userEvent.setup();
    render(<SystemStatusBar />);
    expect(screen.queryByText("Degraded")).toBeNull();
    await user.click(screen.getByRole("button"));
    expect(screen.getByText("Degraded")).toBeTruthy();
  });
});

describe("SystemStatusBar — null data", () => {
  it("renders nothing when data is null", async () => {
    const { usePolling } = await import("@/hooks/use-polling");
    (usePolling as ReturnType<typeof vi.fn>).mockReturnValue({ data: null });
    const { container } = render(<SystemStatusBar />);
    expect(container.innerHTML).toBe("");
  });
});
