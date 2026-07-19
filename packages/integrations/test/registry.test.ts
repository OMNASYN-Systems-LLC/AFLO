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
  validateVendorRegistry,
} from "../src";

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
