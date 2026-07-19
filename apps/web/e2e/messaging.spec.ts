import { expect, test } from "@playwright/test";

/**
 * Secure messaging surfaces. Staff see the raw thread on client detail; the
 * client sees the same conversation through the client-safe projection —
 * "You"/"Advisor" only, never a staff id or internal metadata. Read-only.
 */

test("staff client detail shows the client's secure message thread", async ({ page }) => {
  await page.goto("/clients/c-solomon");
  const card = page.locator("section").filter({ has: page.getByRole("heading", { name: "Secure messages" }) });
  await expect(card.getByText("Income documents for your refinance", { exact: true })).toBeVisible();
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

/**
 * Interactive send. Each test targets a distinct client (the suite runs fully
 * parallel against one shared prototype store) and a unique message body.
 */

test("staff can reply to an existing thread", async ({ page }) => {
  const body = "Thanks Renee — the pay stubs look good, we're all set on income.";
  await page.goto("/clients/c-solomon");
  const card = page.locator("section").filter({ has: page.getByRole("heading", { name: "Secure messages" }) });
  await card.getByPlaceholder("Reply to the client…").fill(body);
  await card.getByRole("button", { name: "Send reply" }).click();
  await expect(card.getByText(body)).toBeVisible();
});

test("staff can start a new conversation", async ({ page }) => {
  const subject = "Quarterly check-in scheduling";
  const body = "Hi Alicia — let's find a time this month to review your progress.";
  await page.goto("/clients/c-grant");
  const card = page.locator("section").filter({ has: page.getByRole("heading", { name: "Secure messages" }) });
  await card.getByPlaceholder("Subject").fill(subject);
  await card.getByPlaceholder("First message to the client…").fill(body);
  await card.getByRole("button", { name: "Start conversation" }).click();
  await expect(card.getByText(subject, { exact: true })).toBeVisible();
  await expect(card.getByText(body)).toBeVisible();
});

test("the client can reply from the portal and sees it as their own", async ({ page }) => {
  const body = "Great, thank you! I have a question about my next steps.";
  await page.goto("/portal");
  const card = page.locator("section").filter({ has: page.getByRole("heading", { name: "Secure messages" }) });
  await card.getByPlaceholder("Write a reply to your advisory team…").first().fill(body);
  await card.getByRole("button", { name: "Send", exact: true }).first().click();
  await expect(card.getByText(body)).toBeVisible();
  // Boundary still holds after an interactive round-trip: no staff id leaks.
  await expect(page.locator("body")).not.toContainText("s-lin");
});
