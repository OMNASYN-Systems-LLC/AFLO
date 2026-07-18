import { expect, test } from "@playwright/test";

/**
 * Critical flow: tracked partner referrals + the Partner Neutrality Engine
 * (partner.v1.0.0). Staff create a referral carrying a complete neutrality
 * disclosure, then route it through its lifecycle and record a staff-observed
 * outcome. AFLO routes and records — it never approves or guarantees.
 *
 * Serial: stateful workflow over the shared server-process store. Creates and
 * transitions referrals only for Devon Pryor (c-pryor), who has no seeded
 * referral; other specs use different records and never touch referrals.
 */
test.describe.configure({ mode: "serial" });

function partnerCard(page: import("@playwright/test").Page) {
  return page.locator("section", {
    has: page.getByRole("heading", { name: "Partner referrals", exact: true }),
  });
}

test("staff create a referral with a recorded neutrality disclosure", async ({ page }) => {
  await page.goto("/clients/c-pryor");
  const card = partnerCard(page);
  await card.locator('select[name="partnerId"]').selectOption("pt-cedarline-cu");
  await card.getByPlaceholder("Why this option is being shown").fill("Fits Devon's debt-paydown goal and credit-union membership.");
  await card.getByPlaceholder(/Eligible alternatives/).fill("Solid Ground Nonprofit Credit Counseling");
  await card.getByRole("button", { name: "Create referral" }).click();
  await page.waitForLoadState("networkidle");

  const item = card.getByRole("listitem").first();
  await expect(item.getByText("Cedarline Community Credit Union")).toBeVisible();
  await expect(item.getByText("Suggested", { exact: true })).toBeVisible();
  // The neutrality disclosure is shown, including the compensation line.
  await expect(item.getByText(/AFLO receives no compensation/)).toBeVisible();
});

test("staff route the referral through share → engage → outcome", async ({ page }) => {
  await page.goto("/clients/c-pryor");
  const card = partnerCard(page);
  const item = () => card.getByRole("listitem").first();

  await item().getByRole("button", { name: "Share with client" }).click();
  await page.waitForLoadState("networkidle");
  await expect(item().getByText("Shared with client", { exact: true })).toBeVisible();

  await item().getByRole("button", { name: "Mark engaged" }).click();
  await page.waitForLoadState("networkidle");
  await expect(item().getByText("Client engaged", { exact: true })).toBeVisible();

  await item().locator('select[name="outcome"]').selectOption("engaged_supported_readiness");
  await item().getByPlaceholder(/Outcome note/).fill("Opened a membership and started the paydown plan.");
  await item().getByRole("button", { name: "Record outcome" }).click();
  await page.waitForLoadState("networkidle");

  await expect(item().getByText("Outcome recorded", { exact: true })).toBeVisible();
  await expect(item().getByText(/Engaged — supported readiness/)).toBeVisible();
});
