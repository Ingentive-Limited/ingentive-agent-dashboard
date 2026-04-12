import { describe, it, expect, vi } from "vitest";
import { render, screen } from "@testing-library/react";

// Mock next/navigation
vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: vi.fn() }),
  usePathname: () => "/plugins",
}));

// Mock next-themes
vi.mock("next-themes", () => ({
  useTheme: () => ({ resolvedTheme: "dark" }),
}));

// Mock SWR/polling
const mockPlugins = [
  {
    name: "playwright",
    marketplace: "claude-plugins-official",
    scope: "user" as const,
    version: "1.0.0",
    installedAt: "2026-04-12T09:00:00Z",
    lastUpdated: "2026-04-12T09:00:00Z",
  },
  {
    name: "copilot-studio",
    marketplace: "skills-for-copilot-studio",
    scope: "user" as const,
    version: "1.0.7",
    installedAt: "2026-04-12T09:00:00Z",
    lastUpdated: "2026-04-12T09:00:00Z",
  },
];

vi.mock("@/hooks/use-polling", () => ({
  usePolling: vi.fn().mockReturnValue({
    data: mockPlugins,
    isLoading: false,
  }),
}));

describe("Plugins Page", () => {
  it("renders plugin cards", async () => {
    const PluginsPage = (await import("@/app/plugins/page")).default;
    render(<PluginsPage />);
    expect(screen.getByText("playwright")).toBeTruthy();
    expect(screen.getByText("copilot-studio")).toBeTruthy();
  });

  it("shows installed count", async () => {
    const PluginsPage = (await import("@/app/plugins/page")).default;
    render(<PluginsPage />);
    expect(screen.getByText("2 installed")).toBeTruthy();
  });

  it("shows page heading", async () => {
    const PluginsPage = (await import("@/app/plugins/page")).default;
    render(<PluginsPage />);
    expect(screen.getByRole("heading", { name: /plugins/i })).toBeTruthy();
  });

  it("shows version and marketplace info", async () => {
    const PluginsPage = (await import("@/app/plugins/page")).default;
    render(<PluginsPage />);
    expect(screen.getByText("v1.0.0")).toBeTruthy();
    expect(screen.getByText("claude-plugins-official")).toBeTruthy();
  });

  it("shows scope badges", async () => {
    const PluginsPage = (await import("@/app/plugins/page")).default;
    render(<PluginsPage />);
    const badges = screen.getAllByText("user");
    expect(badges.length).toBeGreaterThanOrEqual(2);
  });
});

describe("Plugins Page - empty state", () => {
  it("shows empty state when no plugins", async () => {
    const { usePolling } = await import("@/hooks/use-polling");
    (usePolling as ReturnType<typeof vi.fn>).mockReturnValue({
      data: [],
      isLoading: false,
    });

    const PluginsPage = (await import("@/app/plugins/page")).default;
    render(<PluginsPage />);
    expect(screen.getByText("No plugins installed")).toBeTruthy();
    expect(screen.getByText(/install your first plugin/i)).toBeTruthy();
  });
});
