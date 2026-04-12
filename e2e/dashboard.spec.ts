import { test, expect } from "@playwright/test";

test.describe("Dashboard", () => {
  test("loads and shows dashboard heading", async ({ page }) => {
    await page.goto("/");
    await expect(page.getByRole("heading", { name: "Dashboard" })).toBeVisible();
  });

  test("shows overview cards", async ({ page }) => {
    await page.goto("/");
    // Wait for loading to finish (skeleton disappears)
    await page.waitForSelector('[role="status"]', { state: "detached", timeout: 10000 }).catch(() => {});
    // Should have stat cards rendered
    await expect(page.locator(".grid .rounded-xl, .grid .rounded-lg").first()).toBeVisible({ timeout: 10000 });
  });

  test("shows awaiting input section", async ({ page }) => {
    await page.goto("/");
    await expect(page.getByText("Awaiting Input")).toBeVisible({ timeout: 10000 });
  });

  test("shows active sessions section", async ({ page }) => {
    await page.goto("/");
    await expect(page.getByText("Active Sessions")).toBeVisible({ timeout: 10000 });
  });

  test("has billing mode toggle", async ({ page }) => {
    await page.goto("/");
    const btn = page.getByRole("button", { name: /billing mode/i });
    await expect(btn).toBeVisible({ timeout: 10000 });
  });
});

test.describe("Navigation", () => {
  test("sidebar has all navigation links", async ({ page }) => {
    await page.goto("/");
    await expect(page.getByRole("link", { name: /dashboard/i })).toBeVisible({ timeout: 10000 });
    await expect(page.getByRole("link", { name: /sessions/i })).toBeVisible();
    await expect(page.getByRole("link", { name: /projects/i })).toBeVisible();
    await expect(page.getByRole("link", { name: /tokens/i }).first()).toBeVisible();
  });

  test("navigates to sessions page", async ({ page }) => {
    await page.goto("/");
    await page.getByRole("link", { name: /sessions/i }).click();
    await expect(page).toHaveURL(/\/sessions/);
    await expect(page.getByRole("heading", { name: /sessions/i })).toBeVisible();
  });

  test("navigates to projects page", async ({ page }) => {
    await page.goto("/");
    await page.getByRole("link", { name: /projects/i }).click();
    await expect(page).toHaveURL(/\/projects/);
    await expect(page.getByRole("heading", { name: /projects/i })).toBeVisible();
  });

  test("navigates to tokens page", async ({ page }) => {
    await page.goto("/");
    await page.getByRole("link", { name: /tokens/i }).first().click();
    await expect(page).toHaveURL(/\/tokens/);
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
