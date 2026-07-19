import { expect, test } from "@playwright/test";

/**
 * Production-readiness endpoint. In this prototype build APP_ENV is unset, so
 * the runtime resolves to a non-production mode and reports "ok" with the
 * demo/mock providers — proving the fail-closed contract does NOT fire outside
 * an explicit production designation.
 */
test("the health endpoint reports non-secret runtime readiness", async ({ request }) => {
  const res = await request.get("/api/health");
  expect(res.ok()).toBe(true);
  const body = await res.json();

  expect(body.status).toBe("ok");
  expect(body.ok).toBe(true);
  // Never production here (production requires an explicit APP_ENV=production).
  expect(body.mode).not.toBe("production");
  // Non-secret readiness surface: booleans + selected provider modes.
  expect(body.readiness.authMode).toBe("demo");
  expect(body.readiness.repositoryMode).toBe("memory");
  expect(typeof body.readiness.databaseConfigured).toBe("boolean");
  expect(body.readiness.databaseConfigured).toBe(false);
});
