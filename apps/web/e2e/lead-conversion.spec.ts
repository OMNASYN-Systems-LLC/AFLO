import { expect, test } from "@playwright/test";

/**
 * Critical flow: staff moves a lead through the early pipeline. Reaching
 * Intake started auto-opens the structured intake, and the forward action
 * becomes the intake workspace — the intake_completed stage is only
 * reachable through the intake rules (see intake.spec.ts for the
 * completion-to-activation path).
 *
 * Serial: these tests share the server-process store state deliberately —
 * the conversion is a stateful workflow. Mutates only Terrence Cole
 * (l-cole); other specs use different records.
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

test("advancing a lead into Intake started auto-opens its structured intake", async ({ page }) => {
  await page.goto("/leads");

  const advance = async (label: RegExp) => {
    const row = page.locator("li", { has: page.getByRole("link", { name: "Terrence Cole" }) }).first();
    await row.getByRole("button", { name: label }).click();
    await page.waitForLoadState("networkidle");
  };

  await advance(/Advance to Consultation scheduled/i);
  await advance(/Advance to Intake started/i);

  // The forward action is now the intake workspace, not a stage button.
  const row = page.locator("li", { has: page.getByRole("link", { name: "Terrence Cole" }) }).first();
  await expect(row.getByRole("link", { name: /Continue intake \(0\/11\)/ })).toBeVisible();

  // The workspace shows the auto-opened intake with its audit trail.
  await page.goto("/clients/l-cole/intake");
  await expect(page.getByText("Intake in progress", { exact: true })).toBeVisible();
  await expect(page.getByText("0 of 11 required")).toBeVisible();
  await expect(page.getByText("intake.started", { exact: true })).toBeVisible();
});

test("intake completion stays blocked by the rules while sections are missing", async ({ page }) => {
  await page.goto("/clients/l-cole/intake");
  await expect(page.getByRole("button", { name: "Complete intake" })).toHaveCount(0);
  await expect(page.getByText(/Blocked by rule intake\.v1\.0\.0/)).toBeVisible();
  // Terrence is still a lead — nothing activated him.
  await expect(page.getByText("Lead", { exact: true }).first()).toBeVisible();
});
