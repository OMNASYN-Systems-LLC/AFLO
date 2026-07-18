import { expect, test } from "@playwright/test";

/**
 * Critical flow: staff completes a structured intake and activates the
 * client. Omar Haddad is seeded mid-intake (8 of 11 required sections) so
 * the spec exercises the deterministic completeness gate, the linked
 * pipeline advance, and the final activation.
 *
 * Serial: stateful workflow over the shared server-process store. Mutates
 * only Omar Haddad (l-haddad); other specs use different records.
 */
test.describe.configure({ mode: "serial" });

const missingSections = ["Primary goal & target date", "Self-reported credit info", "Debts"];

function sectionRow(page: import("@playwright/test").Page, label: string) {
  return page
    .locator("li")
    .filter({ has: page.getByText(label, { exact: true }) })
    .filter({ has: page.getByRole("button", { name: "Mark complete" }) })
    .first();
}

test("workspace shows seeded progress and withholds completion per the rules", async ({ page }) => {
  await page.goto("/clients/l-haddad/intake");
  await expect(page.getByRole("heading", { name: /Intake — Omar Haddad/ })).toBeVisible();
  await expect(page.getByText("Intake in progress", { exact: true })).toBeVisible();
  await expect(page.getByText("8 of 11 required")).toBeVisible();
  // The completion action is never offered while the rules say no.
  await expect(page.getByRole("button", { name: "Complete intake" })).toHaveCount(0);
  await expect(page.getByText(/Blocked by rule intake\.v1\.0\.0/)).toBeVisible();
});

test("staff completes the missing sections and the rules allow completion", async ({ page }) => {
  await page.goto("/clients/l-haddad/intake");

  for (const label of missingSections) {
    await sectionRow(page, label).getByRole("button", { name: "Mark complete" }).click();
    await page.waitForLoadState("networkidle");
  }

  await expect(page.getByText("11 of 11 required")).toBeVisible();
  await expect(page.getByText("intake.section_completed", { exact: true }).first()).toBeVisible();

  await page.getByRole("button", { name: "Complete intake" }).click();
  await page.waitForLoadState("networkidle");

  await expect(page.getByText("Intake complete", { exact: true })).toBeVisible();
  await expect(page.getByText("Intake completed", { exact: true }).first()).toBeVisible();
  await expect(page.getByText("intake.completed", { exact: true })).toBeVisible();
});

test("the completed lead activates as a client from the pipeline", async ({ page }) => {
  await page.goto("/leads");
  const row = page.locator("li", { has: page.getByRole("link", { name: "Omar Haddad" }) }).first();
  await row.getByRole("button", { name: "Activate as client" }).click();
  await page.waitForLoadState("networkidle");

  // Omar no longer appears as an open lead.
  await expect(page.getByRole("link", { name: "Omar Haddad" })).toHaveCount(0);

  await page.goto("/clients/l-haddad");
  await expect(page.getByRole("heading", { name: "Omar Haddad" })).toBeVisible();
  await expect(page.getByText("Client", { exact: true }).first()).toBeVisible();
  await expect(page.getByText("Client activated", { exact: true }).first()).toBeVisible();
  await expect(page.getByText("Active", { exact: true }).first()).toBeVisible();
});
