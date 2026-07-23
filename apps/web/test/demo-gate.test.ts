import { afterEach, describe, expect, it } from "vitest";
import { getDemoShellIdentity, store } from "../src/lib/data";

/**
 * ADR-0052 demo-runtime gating — defense-in-depth behind boot enforcement.
 *
 * The gated shell-identity accessor and the `demoGated` store proxy must fail
 * closed outside the explicit `APP_ENV=demo` opt-in. A regression here would
 * re-open the LOW-2 leak (synthetic staff identity streamed into the `(app)`
 * shell of a real-cell 500 response), which the static demo-marker guard cannot
 * catch — `DEMO_STAFF` is not a marker literal. These tests pin the runtime
 * gate directly so the fix cannot silently regress.
 *
 * `assertDemoRuntime` reads `process.env` live, so flipping `APP_ENV` selects
 * the runtime per test; vitest's own `NODE_ENV=test` permits demo by default,
 * so the fail-closed cases select a real mode explicitly.
 */
const ORIGINAL_APP_ENV = process.env.APP_ENV;
afterEach(() => {
  if (ORIGINAL_APP_ENV === undefined) delete process.env.APP_ENV;
  else process.env.APP_ENV = ORIGINAL_APP_ENV;
});

describe("ADR-0052 demo-runtime gating", () => {
  it("getDemoShellIdentity throws outside the explicit demo opt-in", () => {
    process.env.APP_ENV = "production";
    expect(() => getDemoShellIdentity()).toThrow(/demo runtime refused/);
  });

  it("getDemoShellIdentity returns the demo persona under APP_ENV=demo", () => {
    process.env.APP_ENV = "demo";
    const { staff, now } = getDemoShellIdentity();
    expect(staff.name.length).toBeGreaterThan(0);
    expect(now).toBeInstanceOf(Date);
  });

  it("the demoGated store fails closed on a method call outside the opt-in", () => {
    process.env.APP_ENV = "production";
    expect(() => store.database()).toThrow(/demo runtime refused/);
  });

  it("the demoGated store serves under the opt-in", () => {
    process.env.APP_ENV = "demo";
    expect(store.database().organization).toBeDefined();
  });
});
