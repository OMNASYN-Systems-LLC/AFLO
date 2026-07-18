import { expect, test } from "@playwright/test";

/**
 * Critical flow: the virtual round-up simulator (SIMULATION ONLY). Alicia
 * Grant is seeded with round-up settings and sample transactions; staff can
 * add a hypothetical transaction and see the deterministic round-up.
 *
 * Serial: stateful over the shared store. Mutates only Alicia Grant
 * (c-grant) — no other spec touches her simulator.
 */
test.describe.configure({ mode: "serial" });

function simCard(page: import("@playwright/test").Page) {
  return page.locator("section", {
    has: page.getByRole("heading", { name: "Round-up simulator", exact: true }),
  });
}

test("the simulator shows seeded settings, a projection, and samples", async ({ page }) => {
  await page.goto("/clients/c-grant");
  const card = simCard(page);
  await expect(card.getByText(/Simulation only/)).toBeVisible();
  await expect(card.getByText(/\/mo/)).toBeVisible();
  await expect(card.getByText("Groceries").first()).toBeVisible();
  await expect(card.getByText(/toward/)).toBeVisible();
});

test("staff adds a hypothetical transaction and it appears with its round-up", async ({ page }) => {
  await page.goto("/clients/c-grant");
  const card = simCard(page);
  await card.getByPlaceholder("Label (e.g. Coffee)").fill("Bookstore");
  await card.locator('input[name="amount"]').fill("17.23");
  await card.locator('input[name="occurredOn"]').fill("2026-07-15");
  await card.getByRole("button", { name: "Add", exact: true }).click();
  await page.waitForLoadState("networkidle");

  // $17.23 rounds up to $18.00 → +$0.77 at ×1.
  await expect(card.getByText("Bookstore").first()).toBeVisible();
  await expect(card.getByText(/\+\$0\.77/).first()).toBeVisible();
});
