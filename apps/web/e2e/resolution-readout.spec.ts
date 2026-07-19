import { expect, test } from "@playwright/test";

/**
 * The Financial Resolution Concierge "Resolution readout" card is a read-only
 * composition (understand → diagnose → organize) shown on client detail. It is
 * asserted against c-solomon, which the mutating readiness/workflow specs do
 * not touch, so the values it reads stay stable.
 */

test("client detail shows the read-only Resolution readout card with provenance", async ({ page }) => {
  await page.goto("/clients/c-solomon");

  await expect(page.getByRole("heading", { name: "Resolution readout" })).toBeVisible();
  // Understand section + its completeness meter caption.
  await expect(page.getByText("Understand", { exact: true })).toBeVisible();
  await expect(page.getByText(/% of inputs captured/)).toBeVisible();
  // Deterministic provenance is always present (resolution + engagement kernels).
  await expect(page.getByText(/resolution\.v1\.0\.0/)).toBeVisible();
});
