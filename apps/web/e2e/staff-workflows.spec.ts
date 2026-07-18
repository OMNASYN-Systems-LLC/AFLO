import { expect, test } from "@playwright/test";

/**
 * Critical flow: the remaining staff workflows — document review states,
 * document requests, appointment scheduling, and internal notes — on Tanya
 * Okafor's file.
 *
 * Serial: stateful workflow over the shared server-process store. Mutates
 * only Tanya Okafor (c-okafor); other specs use different records.
 */
test.describe.configure({ mode: "serial" });

function docRow(page: import("@playwright/test").Page, name: string) {
  return page.locator("li", { has: page.getByText(name, { exact: true }) }).first();
}

test("documents show only rule-legal review actions", async ({ page }) => {
  await page.goto("/clients/c-okafor");
  // Approved documents are terminal — no actions.
  const approved = docRow(page, "Credit report — July 2026");
  await expect(approved.getByRole("button")).toHaveCount(0);
  // An uploaded document can only enter review.
  const uploaded = docRow(page, "Business bank statements — Q2");
  await expect(uploaded.getByRole("button", { name: "Start review" })).toBeVisible();
  await expect(uploaded.getByRole("button", { name: "Approve" })).toHaveCount(0);
});

test("staff reviews and approves an uploaded document", async ({ page }) => {
  await page.goto("/clients/c-okafor");
  const row = docRow(page, "Business bank statements — Q2");
  await row.getByRole("button", { name: "Start review" }).click();
  await page.waitForLoadState("networkidle");
  await row.getByRole("button", { name: "Approve" }).click();
  await page.waitForLoadState("networkidle");
  await expect(
    docRow(page, "Business bank statements — Q2").getByText("Approved", { exact: true }),
  ).toBeVisible();
});

test("staff requests a new document", async ({ page }) => {
  await page.goto("/clients/c-okafor");
  await page.getByPlaceholder("Document name").fill("2026 personal tax return");
  await page.locator('select[name="docType"]').selectOption("income_verification");
  await page.getByRole("button", { name: "Request", exact: true }).click();
  await page.waitForLoadState("networkidle");
  const row = docRow(page, "2026 personal tax return");
  await expect(row.getByText("Requested", { exact: true })).toBeVisible();
  await expect(row.getByRole("button", { name: "Mark uploaded" })).toBeVisible();
});

test("staff schedules an appointment and records a note", async ({ page }) => {
  await page.goto("/clients/c-okafor");

  // Future time relative to the real clock so the store's validation passes.
  const future = new Date(Date.now() + 2 * 24 * 60 * 60 * 1000);
  const local = `${future.getFullYear()}-${String(future.getMonth() + 1).padStart(2, "0")}-${String(
    future.getDate(),
  ).padStart(2, "0")}T15:00`;
  await page.getByPlaceholder("Purpose").fill("Capital application review");
  await page.locator('input[name="scheduledAt"]').fill(local);
  await page.getByRole("button", { name: "Schedule" }).click();
  await page.waitForLoadState("networkidle");
  await expect(page.getByText("Capital application review").first()).toBeVisible();

  await page.getByPlaceholder("Add an internal note…").fill("Confirmed lender checklist received.");
  await page.getByRole("button", { name: "Add note" }).click();
  await page.waitForLoadState("networkidle");
  await expect(page.getByText("Confirmed lender checklist received.")).toBeVisible();
});
