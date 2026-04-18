import { describe, it, expect, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import { SystemStatusBar } from "@/components/system-status-bar";

// Mock usePolling
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

// Mock useBillingMode
vi.mock("@/hooks/use-billing-mode", () => ({
  useBillingMode: vi.fn().mockReturnValue({ isApi: true, toggle: vi.fn() }),
}));

// Mock useProvider
vi.mock("@/hooks/use-provider", () => ({
  useProvider: vi.fn().mockReturnValue({ provider: "all", setProvider: vi.fn(), isClaude: false, isCodex: false, isAll: true }),
  ProviderProvider: ({ children }: { children: React.ReactNode }) => children,
}));
import React from "react";

describe("SystemStatusBar", () => {
  it("renders CLI version", () => {
    render(<SystemStatusBar />);
    expect(screen.getByText("2.1.104 (Claude Code)")).toBeTruthy();
  });

  it("renders active session count", () => {
    render(<SystemStatusBar />);
    expect(screen.getByText("3 active")).toBeTruthy();
  });

  it("renders Claude API OK status when operational", () => {
    render(<SystemStatusBar />);
    expect(screen.getByText("Claude API OK")).toBeTruthy();
  });

  it("renders billing mode", () => {
    render(<SystemStatusBar />);
    expect(screen.getByText("API")).toBeTruthy();
  });

  it("has accessible aria-label on container", () => {
    const { container } = render(<SystemStatusBar />);
    const statusDiv = container.querySelector('[aria-label="System status"]');
    expect(statusDiv).toBeTruthy();
  });

  it("has accessible status dot with aria-label", () => {
    const { container } = render(<SystemStatusBar />);
    const dot = container.querySelector('[aria-label="API operational"]');
    expect(dot).toBeTruthy();
  });
});

describe("SystemStatusBar - degraded", () => {
  it("shows degraded status", async () => {
    const { usePolling } = await import("@/hooks/use-polling");
    (usePolling as ReturnType<typeof vi.fn>).mockReturnValue({
      data: {
        claude: {
          cliVersion: "2.1.104",
          apiStatus: "degraded",
        },
        activeSessions: 0,
      },
    });

    render(<SystemStatusBar />);
    expect(screen.getByText("Claude API Degraded")).toBeTruthy();
  });
});

describe("SystemStatusBar - null data", () => {
  it("renders nothing when data is null", async () => {
    const { usePolling } = await import("@/hooks/use-polling");
    (usePolling as ReturnType<typeof vi.fn>).mockReturnValue({ data: null });

    const { container } = render(<SystemStatusBar />);
    expect(container.innerHTML).toBe("");
  });
});
