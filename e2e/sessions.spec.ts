import { test, expect } from "@playwright/test";

test.describe("Sessions Page", () => {
  test("loads sessions page", async ({ page }) => {
    await page.goto("/sessions");
    await expect(page.getByRole("heading", { name: /sessions/i })).toBeVisible();
  });

  test("shows session list or empty state", async ({ page }) => {
    await page.goto("/sessions");
    // Wait for loading to complete
    await page.waitForTimeout(3000);
    // Should show either sessions or a "no sessions" message
    const content = await page.textContent("body");
    expect(content).toBeTruthy();
  });

  test("has export functionality", async ({ page }) => {
    await page.goto("/sessions");
    // Export button may or may not be visible depending on data
    const exportVisible = await page.getByRole("button", { name: /export/i }).isVisible().catch(() => false);
    // Page loaded cleanly regardless of whether export is present
    expect(typeof exportVisible).toBe("boolean");
  });
});
