import { describe, expect, it } from "vitest";
import {
  INTEGRATIONS_RULES_VERSION,
  VENDOR_CAPABILITY_DOMAINS,
  VENDOR_LIFECYCLE_STATUSES,
  VENDOR_REGISTRY,
  VendorNotEnabledError,
  assertVendorEnabled,
  getVendor,
  isVendorEnabled,
  listVendors,
  toPublicVendorView,
  validateVendorRegistry,
  validateVendors,
} from "../src";
import type { VendorRecord } from "../src";

/**
 * The registry is the mechanical form of AFLO's central commercial-safety
 * rule: nothing external is live until contracted + compliance-reviewed. These
 * tests assert the fail-safe posture holds for EVERY seeded vendor, so a future
 * edit that flips something on without moving it to `production` fails CI.
 */

describe("vendor-discovery registry invariants (V1: nothing is live)", () => {
  it("passes its own deterministic self-check", () => {
    expect(validateVendorRegistry()).toEqual([]);
  });

  it("has a stable rules version", () => {
    expect(INTEGRATIONS_RULES_VERSION).toBe("integrations.v1.0.0");
  });

  it("has unique vendor ids", () => {
    const ids = VENDOR_REGISTRY.map((v) => v.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it("no vendor is enabled, production, or agreement-free", () => {
    for (const v of VENDOR_REGISTRY) {
      expect(v.isEnabled, `${v.id} isEnabled`).toBe(false);
      expect(v.status, `${v.id} status`).not.toBe("production");
      expect(v.requiresAgreement, `${v.id} requiresAgreement`).toBe(true);
    }
  });

  it("every vendor uses a known status and domain", () => {
    for (const v of VENDOR_REGISTRY) {
      expect(VENDOR_LIFECYCLE_STATUSES).toContain(v.status);
      expect(VENDOR_CAPABILITY_DOMAINS).toContain(v.domain);
    }
  });

  it("records a trademark owner for every vendor (nominative use is attributable)", () => {
    for (const v of VENDOR_REGISTRY) {
      expect(v.trademarkOwner.length, `${v.id} trademarkOwner`).toBeGreaterThan(0);
    }
  });

  it("includes the founder-named credit-data candidate (Experian)", () => {
    const experian = getVendor("experian-partner-solutions");
    expect(experian?.domain).toBe("credit_data");
    expect(experian?.status).toBe("discovery");
  });
});

describe("registry access helpers fail closed", () => {
  it("isVendorEnabled is false for every registered vendor", () => {
    for (const v of VENDOR_REGISTRY) {
      expect(isVendorEnabled(v.id)).toBe(false);
    }
  });

  it("isVendorEnabled is false for an unknown vendor", () => {
    expect(isVendorEnabled("does-not-exist")).toBe(false);
  });

  it("assertVendorEnabled throws for every registered vendor", () => {
    for (const v of VENDOR_REGISTRY) {
      expect(() => assertVendorEnabled(v.id)).toThrow(VendorNotEnabledError);
    }
  });

  it("assertVendorEnabled throws for an unknown vendor (reports 'unregistered')", () => {
    expect(() => assertVendorEnabled("does-not-exist")).toThrow(/unregistered/);
  });

  it("listVendors filters by domain", () => {
    const cardVendors = listVendors("card_issuance").map((v) => v.id);
    expect(cardVendors).toContain("marqeta");
    expect(cardVendors).toContain("highnote");
    expect(cardVendors).not.toContain("acorns");
    expect(listVendors().length).toBe(VENDOR_REGISTRY.length);
  });
});

/**
 * The validator is the linchpin CI guard, so prove it DETECTS the regressions
 * it exists to block — not merely that the clean seed passes. `validateVendors`
 * is pure, so it can be fed deliberately-violating fixtures.
 */
describe("validateVendors detects violations (not just passes the clean seed)", () => {
  const ok: VendorRecord = {
    id: "ok-vendor",
    displayName: "OK",
    domain: "credit_data",
    status: "discovery",
    isEnabled: false,
    requiresAgreement: true,
    trademarkOwner: "OK",
    notes: "n",
  };

  it("passes a clean fixture", () => {
    expect(validateVendors([ok])).toEqual([]);
  });

  it("flags an enabled vendor", () => {
    const v = validateVendors([{ ...ok, isEnabled: true, status: "production" }]);
    expect(v.some((m) => m.includes("is enabled"))).toBe(true);
  });

  it("flags a production vendor", () => {
    const v = validateVendors([{ ...ok, status: "production" }]);
    expect(v.some((m) => m.includes("is production"))).toBe(true);
  });

  it("flags an enabled-without-production vendor", () => {
    const v = validateVendors([{ ...ok, isEnabled: true }]);
    expect(v.some((m) => m.includes("enabled without production status"))).toBe(true);
  });

  it("flags an agreement-free vendor", () => {
    const v = validateVendors([{ ...ok, requiresAgreement: false }]);
    expect(v.some((m) => m.includes("must require an agreement"))).toBe(true);
  });

  it("flags duplicate ids", () => {
    const v = validateVendors([ok, { ...ok }]);
    expect(v.some((m) => m.includes("duplicate vendor id"))).toBe(true);
  });
});

describe("runtime immutability + client-safe projection", () => {
  const first = VENDOR_REGISTRY[0];
  if (!first) throw new Error("registry must not be empty");

  it("registry records are frozen (a runtime write to isEnabled throws)", () => {
    expect(Object.isFrozen(VENDOR_REGISTRY)).toBe(true);
    expect(Object.isFrozen(first)).toBe(true);
    expect(() => {
      // Defeating the boundary at runtime must fail, not silently flip a vendor live.
      (first as { isEnabled: boolean }).isEnabled = true;
    }).toThrow();
    expect(first.isEnabled).toBe(false);
  });

  it("toPublicVendorView drops the name, trademark owner, and notes", () => {
    const view = toPublicVendorView(first);
    expect(Object.keys(view).sort()).toEqual(["domain", "id", "status"]);
    expect(view).not.toHaveProperty("displayName");
    expect(view).not.toHaveProperty("trademarkOwner");
    expect(view).not.toHaveProperty("notes");
  });
});
