import { expect, test } from "@playwright/test";

/**
 * Critical flow: the quarterly-report lifecycle — publishing a reviewed
 * report, then generating the current quarter's draft deterministically
 * from recorded facts (which requires a recorded readiness assessment).
 * Renee Solomon's Q2 report is seeded ready_for_review.
 *
 * Serial: stateful workflow over the shared server-process store. Mutates
 * only Renee Solomon (c-solomon); other specs use different records.
 */
test.describe.configure({ mode: "serial" });

function reportCard(page: import("@playwright/test").Page) {
  return page.locator("section", {
    has: page.getByRole("heading", { name: "Quarterly report", exact: true }),
  });
}

test("staff publishes the reviewed report", async ({ page }) => {
  await page.goto("/clients/c-solomon");
  const card = reportCard(page);
  await expect(card.getByText("Ready for review", { exact: true })).toBeVisible();
  await card.getByRole("button", { name: "Publish" }).click();
  await page.waitForLoadState("networkidle");
  await expect(card.getByText("Published", { exact: true })).toBeVisible();
});

test("generation unlocks only after a recorded assessment, then drafts from facts", async ({ page }) => {
  await page.goto("/clients/c-solomon");
  // No recorded assessment yet — the generate action must not be offered.
  await expect(page.getByRole("button", { name: /Generate 2026-Q\d report/ })).toHaveCount(0);

  await page.getByRole("button", { name: "Run assessment" }).click();
  await page.waitForLoadState("networkidle");
  await expect(page.getByText(/Recorded:.*Credit Readiness/)).toBeVisible();

  await page.getByRole("button", { name: /Generate 2026-Q\d report/ }).click();
  await page.waitForLoadState("networkidle");

  const card = reportCard(page);
  await expect(card.getByText("Draft", { exact: true })).toBeVisible();
  await expect(card.getByText(/2026-Q\d · Credit Readiness/)).toBeVisible();
  await expect(
    card.getByText("Readiness stage: Credit Readiness (rule readiness.v1.0.0)"),
  ).toBeVisible();
});

test("the draft submits for review — publication is never direct", async ({ page }) => {
  await page.goto("/clients/c-solomon");
  const card = reportCard(page);
  await expect(card.getByRole("button", { name: "Publish" })).toHaveCount(0);
  await card.getByRole("button", { name: "Submit for review" }).click();
  await page.waitForLoadState("networkidle");
  await expect(card.getByText("Ready for review", { exact: true })).toBeVisible();
});
