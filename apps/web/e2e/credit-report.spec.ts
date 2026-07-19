import { expect, test, type Page } from "@playwright/test";

/**
 * The staff "Credit report (synthetic)" card is a read-only, consent-gated
 * display of the mock provider's summarized report. Assertions are scoped to
 * the card's <section>. c-solomon has data-processing consent + a seeded
 * synthetic report (populated); c-grant has neither (consent-gated state).
 * Neither client is mutated by other specs' workflows.
 */

function creditCard(page: Page) {
  return page
    .locator("section")
    .filter({ has: page.getByRole("heading", { name: "Credit report (synthetic)" }) });
}

test("shows the synthetic, clearly-labeled credit-report summary for a consented client", async ({ page }) => {
  await page.goto("/clients/c-solomon");
  const card = creditCard(page);
  await expect(card.getByRole("heading", { name: "Credit report (synthetic)" })).toBeVisible();
  await expect(card.getByText(/Reported score/)).toBeVisible();
  await expect(card.getByText(/not a bureau report/)).toBeVisible();
  await expect(
    card.getByText(/never auto-update the credit profile or the readiness assessment/),
  ).toBeVisible();
});

test("the summary is consent-gated: no data-processing consent means no facts", async ({ page }) => {
  await page.goto("/clients/c-grant");
  const card = creditCard(page);
  await expect(card.getByText(/consent required/i)).toBeVisible();
  await expect(card.getByText(/Reported score/)).toHaveCount(0);
});
