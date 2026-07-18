import { expect, test } from "@playwright/test";

/**
 * Critical flow: the goals workflow — staff create a goal, update progress,
 * and change the primary. Operates on Renee Solomon (c-solomon); the
 * reports spec also uses her but does not touch her goals.
 */
test.describe.configure({ mode: "serial" });

function goalsCard(page: import("@playwright/test").Page) {
  return page.locator("section", {
    has: page.getByRole("heading", { name: "Goals", exact: true }),
  });
}

test("staff add a goal to a client", async ({ page }) => {
  await page.goto("/clients/c-solomon");
  const card = goalsCard(page);
  await card.getByPlaceholder("New goal").fill("Build a 3-month emergency fund");
  await card.locator('select[name="category"]').selectOption("savings");
  await card.locator('input[name="targetDate"]').fill("2027-02-01");
  await card.getByRole("button", { name: "Add goal" }).click();
  await page.waitForLoadState("networkidle");
  await expect(card.getByText("Build a 3-month emergency fund")).toBeVisible();
});

test("staff make the new goal primary, then update its progress", async ({ page }) => {
  await page.goto("/clients/c-solomon");
  const card = goalsCard(page);
  // The new goal is a non-primary "other goal" with a Make primary control.
  const row = card.locator("li", { has: page.getByText("Build a 3-month emergency fund") });
  await row.getByRole("button", { name: "Make primary" }).click();
  await page.waitForLoadState("networkidle");

  // Now primary — its title heads the card and progress is editable.
  await expect(card.getByText("Build a 3-month emergency fund").first()).toBeVisible();
  await card.locator('input[name="progressPct"]').fill("40");
  await card.getByRole("button", { name: "Update %" }).click();
  await page.waitForLoadState("networkidle");
  await expect(card.getByText("40%")).toBeVisible();
});
