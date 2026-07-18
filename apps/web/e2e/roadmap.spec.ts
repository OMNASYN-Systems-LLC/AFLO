import { expect, test } from "@playwright/test";

/**
 * Critical flow: staff moves a roadmap through the founder-required approval
 * workflow — Draft → Staff Review → Approved → Published. Devon Pryor's
 * roadmap is seeded as a draft; only rule-legal actions are ever offered.
 *
 * Serial: stateful workflow over the shared server-process store. Mutates
 * only Devon Pryor (c-pryor); other specs use different records.
 */
test.describe.configure({ mode: "serial" });

function roadmapCard(page: import("@playwright/test").Page) {
  return page.locator("section", {
    has: page.getByRole("heading", { name: "Roadmap", exact: true }),
  });
}

test("a draft roadmap offers submission, never approval or publication", async ({ page }) => {
  await page.goto("/clients/c-pryor");
  const card = roadmapCard(page);
  await expect(card.getByText("Draft", { exact: true })).toBeVisible();
  await expect(card.getByRole("button", { name: "Submit for review" })).toBeVisible();
  await expect(card.getByRole("button", { name: "Approve" })).toHaveCount(0);
  await expect(card.getByRole("button", { name: "Publish to client" })).toHaveCount(0);
});

test("staff walks the roadmap to published with recorded provenance", async ({ page }) => {
  await page.goto("/clients/c-pryor");
  const card = roadmapCard(page);

  await card.getByRole("button", { name: "Submit for review" }).click();
  await page.waitForLoadState("networkidle");
  await expect(card.getByText("Staff review", { exact: true })).toBeVisible();

  await card.getByRole("button", { name: "Approve" }).click();
  await page.waitForLoadState("networkidle");
  await expect(card.getByText("Approved", { exact: true })).toBeVisible();
  await expect(card.getByText(/approved by Danielle Mercer/)).toBeVisible();

  await card.getByRole("button", { name: "Publish to client" }).click();
  await page.waitForLoadState("networkidle");
  await expect(card.getByText("Published", { exact: true })).toBeVisible();
  await expect(card.getByText(/published /)).toBeVisible();
  // Published is a resting state in the staff UI — no further workflow buttons.
  await expect(card.getByRole("button")).toHaveCount(0);
});
