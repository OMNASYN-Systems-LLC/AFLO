import { expect, test } from "@playwright/test";

/**
 * Secure messaging surfaces. Staff see the raw thread on client detail; the
 * client sees the same conversation through the client-safe projection —
 * "You"/"Advisor" only, never a staff id or internal metadata. Read-only.
 */

test("staff client detail shows the client's secure message thread", async ({ page }) => {
  await page.goto("/clients/c-solomon");
  const card = page.locator("section").filter({ has: page.getByRole("heading", { name: "Secure messages" }) });
  await expect(card.getByText("Income documents for your refinance")).toBeVisible();
  await expect(card.getByText(/upload your two most recent pay stubs/)).toBeVisible();
});

test("the client portal shows the conversation, client-safe (no staff id leak)", async ({ page }) => {
  await page.goto("/portal");
  const card = page.locator("section").filter({ has: page.getByRole("heading", { name: "Secure messages" }) });
  await expect(card.getByText("Getting started", { exact: true })).toBeVisible();
  await expect(card.getByText(/Welcome to Golden Key, Marcus/)).toBeVisible();
  // The client sees "Advisor" / "You", never the staff member id.
  await expect(card.getByText("Advisor", { exact: true }).first()).toBeVisible();
  await expect(card.getByText("You", { exact: true }).first()).toBeVisible();
  await expect(page.locator("body")).not.toContainText("s-lin");
});
