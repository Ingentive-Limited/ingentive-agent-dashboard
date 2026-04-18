import { test, expect } from "@playwright/test";

test.describe("Plugins Page", () => {
  test("loads plugins page", async ({ page }) => {
    await page.goto("/plugins");
    await expect(page.getByRole("heading", { name: /plugins/i })).toBeVisible();
  });

  test("shows plugin cards or empty state", async ({ page }) => {
    await page.goto("/plugins");
    await page.waitForTimeout(3000);
    // Should show either plugins or guidance
    const content = await page.textContent("body");
    expect(
      content?.includes("installed") || content?.includes("No plugins")
    ).toBe(true);
  });

  test("navigates to plugins via direct URL", async ({ page }) => {
    await page.goto("/plugins");
    await expect(page).toHaveURL(/\/plugins/);
    await expect(page.getByRole("heading", { name: /plugins/i })).toBeVisible();
  });
});

test.describe("System Status Bar", () => {
  test("shows system status in sidebar", async ({ page }) => {
    await page.goto("/");
    // ~/.claude/ is seeded in CI so /api/status returns data.
    // Sidebar may be collapsed — expand it first.
    const statusBar = page.locator('[aria-label="System status"]');
    if (!(await statusBar.isVisible().catch(() => false))) {
      await page.locator("button[data-sidebar='trigger']").click().catch(() => {});
      await page.waitForTimeout(500);
    }
    await expect(statusBar).toBeVisible({ timeout: 10000 });
    // Should show at least the active sessions count
    await expect(statusBar.getByText(/active/i)).toBeVisible({ timeout: 5000 });
  });

  test("shows API status in sidebar", async ({ page }) => {
    await page.goto("/");
    // ~/.claude/ is seeded in CI so /api/status returns data.
    // Sidebar may be collapsed on narrow viewports — expand it first.
    const statusBar = page.locator('[aria-label="System status"]');
    if (!(await statusBar.isVisible().catch(() => false))) {
      await page.locator("button[data-sidebar='trigger']").click().catch(() => {});
      await page.waitForTimeout(500);
    }
    await expect(statusBar).toBeVisible({ timeout: 10000 });
    // Should show API status (OK, Degraded, or Unknown). The bar may show status
    // for both Claude and Codex in "all" provider mode, so we assert at least
    // one matching row is visible rather than requiring exactly one.
    const statusText = statusBar.getByText(/API (OK|Degraded|Unknown)/).first();
    await expect(statusText).toBeVisible({ timeout: 5000 });
  });
});
