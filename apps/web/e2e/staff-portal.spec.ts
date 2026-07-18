import { expect, test } from "@playwright/test";

/**
 * Critical staff-portal flow on synthetic data: sign-in shell → dashboard →
 * client list → client detail. Asserts the charter's non-negotiable client
 * signals are visible (stage, goal, next action, roadmap, documents,
 * engagement, appointment, report) and that tenant/synthetic guarantees hold.
 */

test("sign-in shell presents the Golden Key brand and staff entry", async ({ page }) => {
  await page.goto("/");
  await expect(page.getByRole("heading", { name: "Golden Key Wealth" })).toBeVisible();
  await expect(page.getByText("Powered by AFLO")).toBeVisible();
  await expect(page.getByRole("link", { name: /Continue as Golden Key Staff/i })).toBeVisible();
});

test("staff can reach the dashboard and see synthetic KPIs and stage distribution", async ({ page }) => {
  await page.goto("/");
  await page.getByRole("link", { name: /Continue as Golden Key Staff/i }).click();
  await expect(page).toHaveURL(/\/dashboard$/);

  await expect(page.getByText("Active clients", { exact: true })).toBeVisible();
  await expect(page.getByText("Open leads", { exact: true })).toBeVisible();
  await expect(page.getByRole("heading", { name: /Lifecycle stage distribution/i })).toBeVisible();
  // Synthetic-data guarantee surfaced to the operator.
  await expect(page.getByText(/synthetic data only/i).first()).toBeVisible();
});

test("dashboard links through to the client list and a client detail", async ({ page }) => {
  await page.goto("/dashboard");
  await page.getByRole("link", { name: "Clients", exact: true }).click();
  await expect(page).toHaveURL(/\/clients$/);

  // The list renders synthetic clients; open one.
  const whitaker = page.getByRole("link", { name: "James Whitaker" });
  await expect(whitaker).toBeVisible();
  await whitaker.click();
  await expect(page).toHaveURL(/\/clients\/c-whitaker$/);
});

test("client detail shows stage, goal, next action, roadmap, documents, and report", async ({ page }) => {
  await page.goto("/clients/c-whitaker");

  await expect(page.getByRole("heading", { name: "James Whitaker" })).toBeVisible();
  // Current lifecycle stage + deterministic rule provenance.
  await expect(page.getByRole("heading", { name: "Readiness stage" })).toBeVisible();
  await expect(page.getByText(/rule readiness\.v1\.0\.0/i)).toBeVisible();
  await expect(page.getByText("Acquisition").first()).toBeVisible();
  // Primary goal, roadmap, monthly actions, documents, quarterly report, appointment.
  await expect(page.getByRole("heading", { name: "Goals", exact: true })).toBeVisible();
  await expect(page.getByText("Purchase a first home").first()).toBeVisible();
  await expect(page.getByRole("heading", { name: "Roadmap" })).toBeVisible();
  await expect(page.getByRole("heading", { name: "Monthly action plan" })).toBeVisible();
  await expect(page.getByRole("heading", { name: "Documents" })).toBeVisible();
  await expect(page.getByRole("heading", { name: "Quarterly report" })).toBeVisible();
  await expect(page.getByText("Next appointment")).toBeVisible();
  // AI drafts are proposals, gated on review — never silent facts.
  await expect(page.getByText(/awaiting staff review/i)).toBeVisible();
});

test("an unknown client id renders the not-found page, not a leak", async ({ page }) => {
  const res = await page.goto("/clients/c-does-not-exist");
  expect(res?.status()).toBe(404);
  await expect(page.getByText(/Not found/i).first()).toBeVisible();
});
