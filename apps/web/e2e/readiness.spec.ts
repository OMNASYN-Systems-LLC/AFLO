import { expect, test } from "@playwright/test";

/**
 * Critical flow: staff runs a recorded readiness assessment. James Whitaker
 * is seeded with an assessment history ending at Capital Readiness while his
 * current verified facts assess to Acquisition — re-running records the
 * single-step advance without flagging review.
 *
 * Serial: stateful workflow over the shared server-process store. Mutates
 * only James Whitaker (c-whitaker); other specs use different records.
 */
test.describe.configure({ mode: "serial" });

test("client detail shows the seeded recorded assessment and offers a re-run", async ({ page }) => {
  await page.goto("/clients/c-whitaker");
  await expect(page.getByText(/Recorded:/)).toBeVisible();
  await expect(page.getByText(/Recorded:.*Capital Readiness/)).toBeVisible();
  await expect(page.getByText(/Proposed next action:/)).toBeVisible();
  await expect(page.getByRole("button", { name: "Re-run assessment" })).toBeVisible();
});

test("re-running records the deterministic result with the proposed next action", async ({ page }) => {
  await page.goto("/clients/c-whitaker");
  await page.getByRole("button", { name: "Re-run assessment" }).click();
  await page.waitForLoadState("networkidle");

  await expect(page.getByText(/Recorded:.*Acquisition.*previously Capital Readiness/)).toBeVisible();
  await expect(
    page.getByText(/Begin acquisition planning against the client's primary goal/),
  ).toBeVisible();
  // A one-step advance needs no human review.
  await expect(page.getByText("Review required", { exact: true })).toHaveCount(0);
});
