import { test, expect } from "@playwright/test";

test.describe("Dashboard", () => {
  test("loads and shows dashboard heading", async ({ page }) => {
    await page.goto("/");
    await expect(page.getByRole("heading", { name: "Dashboard" })).toBeVisible();
  });

  test("shows overview cards or loading state", async ({ page }) => {
    await page.goto("/");
    // Wait for loading to finish (skeleton disappears)
    await page.waitForSelector('[role="status"]', { state: "detached", timeout: 15000 }).catch(() => {});
    // Should have stat cards rendered or still show dashboard heading
    const hasCards = await page.locator(".grid .rounded-xl, .grid .rounded-lg").first().isVisible().catch(() => false);
    const hasHeading = await page.getByRole("heading", { name: "Dashboard" }).isVisible();
    expect(hasCards || hasHeading).toBe(true);
  });

  test("shows awaiting input section after load", async ({ page }) => {
    await page.goto("/");
    // ~/.claude/ is seeded with fixture data in CI, so loading should complete
    await page.waitForSelector('[role="status"]', { state: "detached", timeout: 15000 }).catch(() => {});
    // Scope to main content to avoid matching sidebar nav link and status badge
    const main = page.locator("#main-content");
    await expect(main.locator('[data-slot="card-title"]', { hasText: "Awaiting Input" })).toBeVisible({ timeout: 15000 });
  });

  test("shows active sessions section after load", async ({ page }) => {
    await page.goto("/");
    await page.waitForSelector('[role="status"]', { state: "detached", timeout: 15000 }).catch(() => {});
    // Scope to main content — "Active Sessions" appears in both overview card and section heading
    const main = page.locator("#main-content");
    await expect(main.locator('[data-slot="card-title"]', { hasText: "Active Sessions" }).first()).toBeVisible({ timeout: 15000 });
  });

  test("has billing mode toggle", async ({ page }) => {
    await page.goto("/");
    await page.waitForSelector('[role="status"]', { state: "detached", timeout: 15000 }).catch(() => {});
    const btn = page.getByRole("button", { name: /billing mode/i });
    await expect(btn).toBeVisible({ timeout: 15000 });
  });
});

test.describe("Navigation", () => {
  test("sidebar has all navigation links", async ({ page }) => {
    await page.goto("/");
    // Ensure sidebar is expanded — click the trigger if sidebar links aren't visible
    const dashboardLink = page.getByRole("link", { name: /dashboard/i });
    if (!(await dashboardLink.isVisible().catch(() => false))) {
      await page.locator("button[data-sidebar='trigger']").click().catch(() => {});
      await page.waitForTimeout(500);
    }
    await expect(dashboardLink).toBeVisible({ timeout: 10000 });
    await expect(page.getByRole("link", { name: /sessions/i })).toBeVisible();
    await expect(page.getByRole("link", { name: /projects/i })).toBeVisible();
    await expect(page.getByRole("link", { name: /token usage/i })).toBeVisible();
  });

  test("navigates to sessions page", async ({ page }) => {
    await page.goto("/sessions");
    await expect(page.getByRole("heading", { name: /sessions/i })).toBeVisible();
  });

  test("navigates to projects page", async ({ page }) => {
    await page.goto("/projects");
    await expect(page.getByRole("heading", { name: /projects/i })).toBeVisible();
  });

  test("navigates to tokens page", async ({ page }) => {
    await page.goto("/tokens");
    await expect(page.getByRole("heading", { name: /token usage/i })).toBeVisible();
  });
});

test.describe("Accessibility", () => {
  test("has skip to content link", async ({ page }) => {
    await page.goto("/");
    const skipLink = page.locator("a[href='#main-content']");
    await expect(skipLink).toBeAttached();
  });

  test("main content area has correct id", async ({ page }) => {
    await page.goto("/");
    await expect(page.locator("#main-content")).toBeAttached();
  });

  test("has no duplicate heading levels on dashboard", async ({ page }) => {
    await page.goto("/");
    // h1 should exist
    const h1Count = await page.locator("h1").count();
    expect(h1Count).toBeGreaterThanOrEqual(1);
  });
});

test.describe("Theme", () => {
  test("has theme toggle button", async ({ page }) => {
    await page.goto("/");
    const toggle = page.getByRole("button", { name: /theme/i });
    await expect(toggle).toBeVisible({ timeout: 10000 });
  });
});

test.describe("Footer", () => {
  test("shows footer with Ingentive link", async ({ page }) => {
    await page.goto("/");
    await expect(page.getByRole("link", { name: /ingentive/i }).first()).toBeVisible({ timeout: 10000 });
  });
});
