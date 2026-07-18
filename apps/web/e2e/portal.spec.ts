import { expect, test } from "@playwright/test";

/**
 * Critical flow: the client portal renders only published, client-safe
 * material for the demo persona (Marcus Bell) — and none of the staff
 * workspace's internals. Read-only: no records are mutated, so this spec
 * is safe alongside the workflow specs.
 */

test("the sign-in shell offers the client portal and it renders the client's view", async ({ page }) => {
  await page.goto("/");
  await page.getByRole("link", { name: /Continue as Sample Client/ }).click();
  await expect(page).toHaveURL(/\/portal$/);
  await expect(page.getByRole("heading", { name: /Welcome back, Marcus/ })).toBeVisible();
  // Stage from the cleared recorded assessment, in plain language.
  await expect(page.getByText("Recovery", { exact: true })).toBeVisible();
  await expect(page.getByText(/Current focus:/)).toBeVisible();
  await expect(page.getByText(/autopay minimums/).first()).toBeVisible();
});

test("the portal shows published roadmap, actions, appointment, and report", async ({ page }) => {
  await page.goto("/portal");
  await expect(page.getByText("Recovery: collections resolved, payments current")).toBeVisible();
  await expect(page.getByText("Bring past-due accounts current")).toBeVisible();
  await expect(page.getByRole("heading", { name: "This month's actions" })).toBeVisible();
  await expect(page.getByText("Confirm payment arrangement with Meridian Collections")).toBeVisible();
  await expect(page.getByRole("heading", { name: "Next appointment" })).toBeVisible();
  await expect(page.getByText("Collections arrangement follow-up").first()).toBeVisible();
  await expect(page.getByText("2026-Q2", { exact: true })).toBeVisible();
  await expect(page.getByText("Hardship budget completed and holding for eight weeks")).toBeVisible();
});

test("staff internals never reach the portal", async ({ page }) => {
  await page.goto("/portal");
  // No rule reason codes, review flags, staff navigation, or synthetic KPI internals.
  await expect(page.getByText(/RC_[A-Z_]+/)).toHaveCount(0);
  await expect(page.getByText(/rule readiness\.v1\.0\.0/)).toHaveCount(0);
  await expect(page.getByText("Review required")).toHaveCount(0);
  await expect(page.getByRole("link", { name: "Lead Pipeline" })).toHaveCount(0);
  await expect(page.getByRole("link", { name: "Dashboard" })).toHaveCount(0);
  // The only way out is the sign-out link back to the shell.
  await expect(page.getByRole("link", { name: "Sign out" })).toBeVisible();
});
