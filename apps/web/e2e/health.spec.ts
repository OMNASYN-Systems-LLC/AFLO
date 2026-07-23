import { expect, test } from "@playwright/test";

/**
 * Production-readiness endpoint. The e2e server runs with the EXPLICIT demo
 * opt-in (`APP_ENV=demo`, set in playwright.config.ts — ADR-0048), so the
 * runtime resolves to the demo mode and reports "ok" with the demo/mock
 * providers — proving the fail-closed contract does NOT fire under the
 * deliberate opt-in, while remaining non-production.
 */
test("the health endpoint reports non-secret runtime readiness", async ({ request }) => {
  const res = await request.get("/api/health");
  expect(res.ok()).toBe(true);
  const body = await res.json();

  expect(body.status).toBe("ok");
  expect(body.ok).toBe(true);
  // The EXPLICIT demo opt-in (ADR-0048) — never production, never implicit.
  expect(body.mode).toBe("demo");
  // Non-secret readiness surface: booleans + selected provider modes.
  expect(body.readiness.authMode).toBe("demo");
  expect(body.readiness.repositoryMode).toBe("memory");
  expect(typeof body.readiness.databaseConfigured).toBe("boolean");
  expect(body.readiness.databaseConfigured).toBe(false);
});
