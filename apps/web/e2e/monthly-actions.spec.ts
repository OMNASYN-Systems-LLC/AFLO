import { expect, test } from "@playwright/test";

/**
 * Critical flow: staff works a client's monthly action plan — completing an
 * in-progress action and adding a manual one. Alicia Grant's July plan is
 * seeded with one done, one in-progress, and one todo action.
 *
 * Serial: stateful workflow over the shared server-process store. Mutates
 * only Alicia Grant (c-grant); other specs use different records.
 */
test.describe.configure({ mode: "serial" });

function actionRow(page: import("@playwright/test").Page, title: string) {
  return page.locator("li", { has: page.getByText(title, { exact: true }) }).first();
}

test("the plan shows seeded actions with only rule-legal moves", async ({ page }) => {
  await page.goto("/clients/c-grant");
  await expect(page.getByRole("heading", { name: "Monthly action plan" })).toBeVisible();
  const doneRow = actionRow(page, "Transfer $250 from each paycheck to reserves");
  await expect(doneRow.getByRole("button", { name: "Reopen" })).toBeVisible();
  await expect(doneRow.getByRole("button", { name: "Complete" })).toHaveCount(0);
  const inProgressRow = actionRow(page, "Gather payoff quote for the car loan");
  await expect(inProgressRow.getByRole("button", { name: "Complete" })).toBeVisible();
  await expect(inProgressRow.getByRole("button", { name: "Start" })).toHaveCount(0);
});

test("staff completes an in-progress action", async ({ page }) => {
  await page.goto("/clients/c-grant");
  const row = actionRow(page, "Gather payoff quote for the car loan");
  await row.getByRole("button", { name: "Complete" }).click();
  await page.waitForLoadState("networkidle");
  await expect(
    actionRow(page, "Gather payoff quote for the car loan").getByText("Done", { exact: true }),
  ).toBeVisible();
});

test("staff adds a manual action to this month's plan", async ({ page }) => {
  await page.goto("/clients/c-grant");
  // Scope to the action-plan form: other cards (goals) also have a category select.
  const addForm = page.locator("form", {
    has: page.getByPlaceholder("What should happen this month?"),
  });
  await addForm.getByPlaceholder("What should happen this month?").fill("Confirm autopay on the car loan");
  await addForm.locator('select[name="category"]').selectOption("payment");
  await addForm.locator('input[name="dueDate"]').fill("2026-07-30");
  await addForm.getByRole("button", { name: "Add action" }).click();
  await page.waitForLoadState("networkidle");

  const newRow = actionRow(page, "Confirm autopay on the car loan");
  await expect(newRow).toBeVisible();
  await expect(newRow.getByText("To do", { exact: true })).toBeVisible();
  await expect(newRow.getByRole("button", { name: "Start" })).toBeVisible();
});
