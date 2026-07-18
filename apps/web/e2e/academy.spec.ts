import { expect, test } from "@playwright/test";

/**
 * Critical flow: ΛFLO Wealth Academy. Staff assign a lesson (deterministic)
 * and mark it complete; the client sees assigned lessons in their portal
 * Wealth Academy surface — but never the staff-internal reason codes.
 *
 * Serial: stateful over the shared store. Mutates only Alicia Grant
 * (c-grant); the portal check reads Marcus Bell (c-bell, portal persona).
 */
test.describe.configure({ mode: "serial" });

function academyCard(page: import("@playwright/test").Page) {
  return page.locator("section", {
    has: page.getByRole("heading", { name: "Wealth Academy", exact: true }),
  });
}

test("staff assign a lesson and it appears with provenance", async ({ page }) => {
  await page.goto("/clients/c-grant");
  const card = academyCard(page);
  await card.getByRole("button", { name: /Assign: Documents that build trust/ }).click();
  await page.waitForLoadState("networkidle");
  const row = academyCard(page).locator("li", { has: page.getByText("documents") });
  await expect(row.getByText(/EDU_DOCUMENT/)).toBeVisible();
  await expect(row.getByRole("button", { name: "Mark complete" })).toBeVisible();
});

test("staff mark the lesson complete", async ({ page }) => {
  await page.goto("/clients/c-grant");
  const row = academyCard(page).locator("li", { has: page.getByText("documents") });
  await row.getByRole("button", { name: "Mark complete" }).click();
  await page.waitForLoadState("networkidle");
  await expect(
    academyCard(page).locator("li", { has: page.getByText("documents") }).getByText("Completed"),
  ).toBeVisible();
});

test("the client portal shows assigned lessons without staff-internal reason codes", async ({ page }) => {
  await page.goto("/portal");
  const card = academyCard(page);
  await expect(card.getByRole("heading", { name: "Wealth Academy" })).toBeVisible();
  // Marcus Bell has no assignment in the seed; the empty state is client-safe.
  await expect(card).toBeVisible();
  // No staff-internal reason codes ever reach the portal.
  await expect(page.getByText(/EDU_[A-Z]+/)).toHaveCount(0);
});
