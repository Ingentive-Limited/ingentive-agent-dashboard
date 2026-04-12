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

  test("navigates to plugins via sidebar", async ({ page }) => {
    await page.goto("/");
    await page.getByRole("link", { name: /plugins/i }).click();
    await expect(page).toHaveURL(/\/plugins/);
  });
});

test.describe("System Status Bar", () => {
  test("shows CLI version in sidebar", async ({ page }) => {
    await page.goto("/");
    // Wait for status to load
    await page.waitForTimeout(3000);
    const sidebar = page.locator("aside, nav, [data-sidebar]");
    await expect(sidebar.getByText(/Claude Code/i).first()).toBeVisible({
      timeout: 10000,
    });
  });

  test("shows API status in sidebar", async ({ page }) => {
    await page.goto("/");
    await page.waitForTimeout(3000);
    const sidebar = page.locator("aside, nav, [data-sidebar]");
    const apiText = sidebar.getByText(/API/i).first();
    await expect(apiText).toBeVisible({ timeout: 10000 });
  });
});
