import { expect, test } from "@playwright/test";

/**
 * Critical flow: the Human Review Center — queue index with seeded counts,
 * item provenance, a structured approve decision, publication (including the
 * founder's stale-artifact denial), and the client-safe projection boundary.
 *
 * Serial: stateful workflow over the shared server-process store. Mutates
 * only review items (rvi-bell-concierge); no other spec touches the Review
 * Center, and the count/metric assertions run before any mutation.
 */
test.describe.configure({ mode: "serial" });

test("queue index renders seeded queues, counts, and honest metrics", async ({ page }) => {
  await page.goto("/reviews");
  await expect(page.getByRole("heading", { name: "Review Center" })).toBeVisible();

  // Analytics strip from reviewMetrics: 2 awaiting; median 1440 min = 24 h;
  // approval rate 2 of 4 seeded decisions — honest denominator shown.
  const tiles = page.getByTestId("review-metrics").locator("> div");
  await expect(tiles.nth(0)).toContainText("Awaiting review");
  await expect(tiles.nth(0)).toContainText("2");
  await expect(tiles.nth(1)).toContainText("24 h");
  await expect(tiles.nth(2)).toContainText("50%");
  await expect(tiles.nth(2)).toContainText("of 4 decisions");

  // Per-queue card: the concierge queue holds one awaiting high-risk item.
  const conciergeCard = page
    .locator("li")
    .filter({ has: page.getByRole("link", { name: "Concierge recommendation", exact: true }) });
  await expect(conciergeCard).toContainText("Awaiting review 1");
  await expect(conciergeCard).toContainText("High risk 1");

  // All six seeded items in the table; the escalated item shows its raised
  // reviewer floor.
  await expect(page.locator("tbody tr")).toHaveCount(6);
  const escalatedRow = page.locator("tbody tr").filter({ hasText: "fs-c-okafor-2026-07" });
  await expect(escalatedRow).toContainText("Organization Admin");

  // State filter narrows to the two awaiting items.
  await page.goto("/reviews?state=awaiting_review");
  await expect(page.locator("tbody tr")).toHaveCount(2);
});

test("item detail shows full provenance and the client-safe boundary", async ({ page }) => {
  await page.goto("/reviews/rvi-bell-concierge");
  await expect(page.getByRole("heading", { name: "Concierge recommendation" })).toBeVisible();
  await expect(page.getByText("Awaiting review", { exact: true })).toBeVisible();

  // Provenance: AI run, model confidence, source facts + freshness, rule
  // versions, and the reviewed digest (truncated).
  await expect(page.getByText("airun-bell-concierge-1")).toBeVisible();
  await expect(page.getByText("0.840")).toBeVisible();
  await expect(page.getByText("credit_profiles.past_due_accounts")).toBeVisible();
  await expect(page.getByText("review_center.v1.0.0")).toBeVisible();
  await expect(page.getByText("18d2089b98e11abb", { exact: false }).first()).toBeVisible();
  await expect(page.getByText("Unchanged since review")).toBeVisible();

  // Not published yet — the client projection is empty, and says so.
  await expect(page.getByTestId("client-preview")).toContainText("Not visible to the client");
});

test("a deterministic item renders 'deterministic' instead of a confidence", async ({ page }) => {
  await page.goto("/reviews/rvi-pryor-roadmap");
  await expect(page.getByText("Deterministic — no model confidence")).toBeVisible();
  await expect(page.getByText("Manually authored — no AI run")).toBeVisible();
});

test("recording an approve decision moves the item to approved", async ({ page }) => {
  await page.goto("/reviews/rvi-bell-concierge");
  await page.getByLabel("Decision").selectOption("approved_unchanged");
  await page.getByLabel("Structured reason code").selectOption("RVD_ACCURATE");
  await page.getByRole("button", { name: "Record decision" }).click();
  await page.waitForLoadState("networkidle");

  // The store moved the state; the page re-rendered from it.
  await expect(page.getByText("Approved", { exact: true }).first()).toBeVisible();
  await expect(page.getByRole("button", { name: "Publish to client" })).toBeVisible();
  // The append-only decision history carries the structured reason code.
  await expect(page.getByText("RVD_ACCURATE").first()).toBeVisible();
});

test("publishing the approved item succeeds and fills the client projection", async ({ page }) => {
  await page.goto("/reviews/rvi-bell-concierge");
  await page.getByRole("button", { name: "Publish to client" }).click();
  await page.waitForLoadState("networkidle");

  await expect(page.getByText("Published", { exact: true }).first()).toBeVisible();
  await expect(page.getByTestId("client-preview")).toContainText(
    "concierge_recommendation/concierge-c-bell-2026-07",
  );
});

test("publishing a stale item renders the distinct stale-artifact denial", async ({ page }) => {
  // rvi-solomon-report was approved at artifact v2, but the demo artifact
  // source records the artifact as since revised to v3 — the founder's
  // stale-artifact invariant must deny publication.
  await page.goto("/reviews/rvi-solomon-report");
  await expect(page.getByText(/The artifact has changed since this review/)).toBeVisible();

  await page.getByRole("button", { name: "Publish to client" }).click();
  // Scoped by text: Next's route announcer also carries role="alert".
  const alert = page.getByRole("alert").filter({ hasText: "RVC_STALE_ARTIFACT" });
  await expect(alert).toContainText("Artifact changed since approval — new review required.");
  await expect(alert).toContainText("RVC_STALE_ARTIFACT");

  // The denial never mutates: the item stays approved, not published.
  await expect(page.getByText("Approved", { exact: true }).first()).toBeVisible();
  await expect(page.getByTestId("client-preview")).toContainText("Not visible to the client");
});

test("the client projection preview hides every internal review field", async ({ page }) => {
  // Published seed with a recorded outcome — the full client-safe view.
  await page.goto("/reviews/rvi-solomon-education");
  const preview = page.getByTestId("client-preview");
  await expect(preview).toContainText("Educational assignment");
  await expect(preview).toContainText("education_assignments/edu-solomon-1");
  await expect(preview).toContainText("completed");
  await expect(preview).toContainText("achieved");

  // Structurally excluded from the projection: reviewer identity, structured
  // reason codes, and risk class…
  await expect(preview).not.toContainText("Andre Boyd");
  await expect(preview).not.toContainText("RVD_");
  await expect(preview).not.toContainText("Medium risk");

  // …while staff still see all of it elsewhere on the same page.
  await expect(page.getByText("RVD_ACCURATE").first()).toBeVisible();
  await expect(page.getByText("Andre Boyd").first()).toBeVisible();
  await expect(page.getByText("Medium risk").first()).toBeVisible();
});
