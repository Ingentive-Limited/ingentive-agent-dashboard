import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { EmptyState } from "@/components/empty-state";
import { FolderOpen } from "lucide-react";

// Mock clipboard API
Object.assign(navigator, {
  clipboard: {
    writeText: vi.fn().mockResolvedValue(undefined),
  },
});

describe("EmptyState", () => {
  it("renders title and description", () => {
    render(
      <EmptyState
        icon={FolderOpen}
        title="No projects found"
        description="Start a session to see projects."
      />
    );
    expect(screen.getByText("No projects found")).toBeTruthy();
    expect(screen.getByText("Start a session to see projects.")).toBeTruthy();
  });

  it("renders icon as decorative (aria-hidden)", () => {
    const { container } = render(
      <EmptyState
        icon={FolderOpen}
        title="Test"
        description="Test description"
      />
    );
    const svg = container.querySelector("svg");
    expect(svg?.getAttribute("aria-hidden")).toBe("true");
  });

  it("renders command when provided", () => {
    render(
      <EmptyState
        icon={FolderOpen}
        title="No projects"
        description="Start a session."
        command="cd project && claude"
      />
    );
    expect(screen.getByText("cd project && claude")).toBeTruthy();
  });

  it("does not render command section when not provided", () => {
    const { container } = render(
      <EmptyState
        icon={FolderOpen}
        title="No projects"
        description="Start a session."
      />
    );
    expect(container.querySelector("code")).toBeNull();
  });

  it("copy button has accessible label", () => {
    render(
      <EmptyState
        icon={FolderOpen}
        title="No projects"
        description="Start a session."
        command="claude"
      />
    );
    const copyBtn = screen.getByRole("button", { name: /copy command/i });
    expect(copyBtn).toBeTruthy();
  });

  it("copies command to clipboard on click", async () => {
    render(
      <EmptyState
        icon={FolderOpen}
        title="No projects"
        description="Start a session."
        command="claude"
      />
    );
    const copyBtn = screen.getByRole("button", { name: /copy command/i });
    fireEvent.click(copyBtn);
    expect(navigator.clipboard.writeText).toHaveBeenCalledWith("claude");
  });
});
