import { expect, test } from "@playwright/test";

/**
 * Critical flow: workflow events produce consent-gated communications that
 * surface in the staff Communications log. A consented client's request is
 * "Sent"; a client who revoked consent gets a recorded "Suppressed" entry —
 * withheld sends are never silently dropped.
 *
 * Operates on Sofia Ramirez (c-ramirez, consented) and Harold Ngo (c-ngo,
 * revoked) — clients no other spec mutates.
 */

function commsCard(page: import("@playwright/test").Page) {
  return page.locator("section", {
    has: page.getByRole("heading", { name: "Communications", exact: true }),
  });
}

test("a consented client's document request is recorded as sent", async ({ page }) => {
  await page.goto("/clients/c-ramirez");
  await page.getByPlaceholder("Document name").fill("Pay stub — July");
  await page.locator('select[name="docType"]').selectOption("income_verification");
  await page.getByRole("button", { name: "Request", exact: true }).click();
  await page.waitForLoadState("networkidle");

  const card = commsCard(page);
  // Consented request now sends on in-app + email — two "Sent" entries.
  await expect(card.getByText("Sent", { exact: true }).first()).toBeVisible();
  await expect(card.getByText(/document/i).first()).toBeVisible();
});

test("a client who revoked consent gets a recorded suppression, not a silent drop", async ({ page }) => {
  await page.goto("/clients/c-ngo");
  await page.getByPlaceholder("Document name").fill("Updated bank statement");
  await page.locator('select[name="docType"]').selectOption("bank_statement");
  await page.getByRole("button", { name: "Request", exact: true }).click();
  await page.waitForLoadState("networkidle");

  const card = commsCard(page);
  await expect(card.getByText("Suppressed — no consent")).toBeVisible();
});
