import { expect, test, type Page } from "@playwright/test";

/**
 * Critical flow: staff runs a recorded readiness assessment. James Whitaker
 * is seeded with an assessment history ending at Capital Readiness while his
 * current verified facts assess to Acquisition — re-running records the
 * single-step advance without flagging review.
 *
 * Assertions are scoped to the "Readiness stage" card: the client-detail page
 * also carries a "Resolution readout" card that echoes the same recorded
 * assessment (stage, proposed next action), so page-global text locators would
 * match both. Scoping keeps this spec about the readiness card specifically.
 *
 * Serial: stateful workflow over the shared server-process store. Mutates
 * only James Whitaker (c-whitaker); other specs use different records.
 */
test.describe.configure({ mode: "serial" });

/** The "Readiness stage" SectionCard (a <section> with that heading). */
function readinessCard(page: Page) {
  return page
    .locator("section")
    .filter({ has: page.getByRole("heading", { name: "Readiness stage" }) });
}

test("client detail shows the seeded recorded assessment and offers a re-run", async ({ page }) => {
  await page.goto("/clients/c-whitaker");
  const card = readinessCard(page);
  await expect(card.getByText(/Recorded:/)).toBeVisible();
  await expect(card.getByText(/Recorded:.*Capital Readiness/)).toBeVisible();
  await expect(card.getByText(/Proposed next action:/)).toBeVisible();
  await expect(card.getByRole("button", { name: "Re-run assessment" })).toBeVisible();
});

test("re-running records the deterministic result with the proposed next action", async ({ page }) => {
  await page.goto("/clients/c-whitaker");
  const card = readinessCard(page);
  await card.getByRole("button", { name: "Re-run assessment" }).click();
  await page.waitForLoadState("networkidle");

  await expect(card.getByText(/Recorded:.*Acquisition.*previously Capital Readiness/)).toBeVisible();
  await expect(
    card.getByText(/Begin acquisition planning against the client's primary goal/),
  ).toBeVisible();
  // A one-step advance needs no human review (page-wide: neither card flags it).
  await expect(page.getByText("Review required", { exact: true })).toHaveCount(0);
});
