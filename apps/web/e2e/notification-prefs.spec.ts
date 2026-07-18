import { expect, test } from "@playwright/test";

/**
 * Critical flow: user-controlled notification preferences, enforced before
 * send. Operates on Renee Solomon (c-solomon) — a consented client no other
 * spec's notification state depends on.
 */
test.describe.configure({ mode: "serial" });

function prefsCard(page: import("@playwright/test").Page) {
  return page.locator("section", {
    has: page.getByRole("heading", { name: "Notification preferences", exact: true }),
  });
}

test("preferences show per-channel toggles per notification type", async ({ page }) => {
  await page.goto("/clients/c-solomon");
  const card = prefsCard(page);
  await expect(card.getByText("Appointment scheduled")).toBeVisible();
  // Appointment routes to In-app + Email + SMS by default (all on).
  const apptButtons = card
    .locator("li", { has: page.getByText("Appointment scheduled") })
    .getByRole("button");
  await expect(apptButtons).toHaveCount(3);
});

test("staff toggle a channel off and it reflects immediately", async ({ page }) => {
  await page.goto("/clients/c-solomon");
  const card = prefsCard(page);
  const apptRow = card.locator("li", { has: page.getByText("Appointment scheduled") });
  const sms = apptRow.getByRole("button", { name: "SMS" });
  await expect(sms).toHaveAttribute("aria-pressed", "true");
  await sms.click();
  await page.waitForLoadState("networkidle");
  await expect(
    prefsCard(page)
      .locator("li", { has: page.getByText("Appointment scheduled") })
      .getByRole("button", { name: "SMS" }),
  ).toHaveAttribute("aria-pressed", "false");
});
