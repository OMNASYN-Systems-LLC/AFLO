import { expect, test } from "@playwright/test";

/**
 * Critical flow: signed verification handoff packages (security.v1.0.0). Staff
 * generate a cryptographically signed package of verified facts for a consented
 * client, see it verify as valid, then revoke it. The consent gate is shown for
 * a client without partner-data-sharing consent.
 *
 * Serial: stateful workflow over the shared server-process store. Generates and
 * revokes only for James Whitaker (c-whitaker, who has a seeded assessment and
 * partner-data-sharing consent); other specs use different records.
 */
test.describe.configure({ mode: "serial" });

function handoffCard(page: import("@playwright/test").Page) {
  return page.locator("section", {
    has: page.getByRole("heading", { name: "Verification handoff", exact: true }),
  });
}

test("the consent gate blocks a client without partner-data-sharing consent", async ({ page }) => {
  // c-grant is an activated client but has not granted partner_data_sharing.
  await page.goto("/clients/c-grant");
  const card = handoffCard(page);
  await expect(card.getByText(/has not granted partner-data-sharing consent/)).toBeVisible();
  await expect(card.getByRole("button", { name: "Generate & sign" })).toHaveCount(0);
});

test("staff generate and sign a handoff of verified facts", async ({ page }) => {
  await page.goto("/clients/c-whitaker");
  const card = handoffCard(page);
  await card.getByPlaceholder(/Recipient/).fill("partner-cpa:acme-tax");
  await card.getByRole("button", { name: "Generate & sign" }).click();
  await page.waitForLoadState("networkidle");

  const item = card.getByRole("listitem").first();
  await expect(item.getByText("partner-cpa:acme-tax")).toBeVisible();
  // The signature verifies within the running store.
  await expect(item.getByText("Valid signature")).toBeVisible();
  // Verified facts: the ΛFLO readiness STAGE (never a bureau score).
  await expect(item.getByText("Capital Readiness")).toBeVisible();
  await expect(item.getByText("Purchase a first home")).toBeVisible();
  // The payload digest is shown (integrity), distinct from the signature.
  await expect(item.getByText(/digest [0-9a-f]{24}…/)).toBeVisible();
});

test("staff revoke the handoff and it then verifies as revoked", async ({ page }) => {
  await page.goto("/clients/c-whitaker");
  const card = handoffCard(page);
  const item = card.getByRole("listitem").first();
  await item.getByRole("button", { name: "Revoke" }).click();
  await page.waitForLoadState("networkidle");

  await expect(card.getByRole("listitem").first().getByText("Revoked", { exact: true })).toBeVisible();
  // A revoked package no longer offers a revoke button.
  await expect(card.getByRole("listitem").first().getByRole("button", { name: "Revoke" })).toHaveCount(0);
});
