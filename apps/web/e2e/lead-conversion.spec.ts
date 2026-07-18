import { expect, test } from "@playwright/test";

/**
 * Critical flow: staff converts a lead to a client through the full
 * required pipeline, with the audit trail recording every move.
 *
 * Serial: these tests share the server-process store state deliberately —
 * the conversion is a stateful workflow.
 */
test.describe.configure({ mode: "serial" });

test("lead pipeline shows leads at their stages with only rule-legal actions", async ({ page }) => {
  await page.goto("/leads");
  await expect(page.getByRole("heading", { name: "Lead Pipeline" })).toBeVisible();
  // Terrence starts at New lead; the only forward action is the next REQUIRED stage.
  await expect(page.getByRole("link", { name: "Terrence Cole" })).toBeVisible();
  await expect(
    page.getByRole("button", { name: /Advance to Consultation scheduled/i }).first(),
  ).toBeVisible();
});

test("staff advances Terrence Cole through the required path to activation", async ({ page }) => {
  await page.goto("/leads");

  const advance = async (label: RegExp) => {
    const row = page.locator("li", { has: page.getByRole("link", { name: "Terrence Cole" }) }).first();
    await row.getByRole("button", { name: label }).click();
    await page.waitForLoadState("networkidle");
  };

  await advance(/Advance to Consultation scheduled/i);
  await expect(page.getByText("lead.stage_advanced", { exact: true }).first()).toBeVisible();

  await advance(/Advance to Intake started/i);
  await advance(/Advance to Intake completed/i);
  await advance(/Activate as client/i);

  // Audit trail records the activation.
  await expect(page.getByText("lead.activated", { exact: true }).first()).toBeVisible();
  // Terrence no longer appears as an open lead.
  await expect(page.getByRole("link", { name: "Terrence Cole" })).toHaveCount(0);
});

test("activated lead appears as a client with the terminal stage", async ({ page }) => {
  await page.goto("/clients/l-cole");
  await expect(page.getByRole("heading", { name: "Terrence Cole" })).toBeVisible();
  await expect(page.getByText("Client", { exact: true }).first()).toBeVisible();
  await expect(page.getByText("Client activated", { exact: true }).first()).toBeVisible();
  await expect(page.getByText("Active", { exact: true }).first()).toBeVisible();
});
