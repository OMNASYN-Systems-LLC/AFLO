import { expect, test, type Page } from "@playwright/test";

/**
 * The staff "Opportunity notices" card surfaces public programs matched to a
 * client (surface-worthiness, never eligibility), with hedged client-safe text
 * for ordinary notices and a "staff review required" state for legal/claims
 * notices. Asserted on c-grant (a savings goal, US default jurisdiction), which
 * mutating specs don't touch. Assertions are scoped to the card's <section>.
 */

function card(page: Page) {
  return page
    .locator("section")
    .filter({ has: page.getByRole("heading", { name: "Opportunity notices" }) });
}

test("surfaces hedged notices and gates legal/claims notices behind staff review", async ({ page }) => {
  await page.goto("/clients/c-grant");
  const c = card(page);
  await expect(c.getByRole("heading", { name: "Opportunity notices" })).toBeVisible();
  // An ordinary notice renders the hedged, client-safe message.
  await expect(c.getByText(/may relate to your profile/i).first()).toBeVisible();
  await expect(c.getByText("May relate").first()).toBeVisible();
  // A legal/claims notice is gated — shown to staff, not client-projected.
  await expect(c.getByText("Staff review required")).toBeVisible();
  await expect(c.getByText(/not shown to the client until a staff member reviews it/i)).toBeVisible();
});
