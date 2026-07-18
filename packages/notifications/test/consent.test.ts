import { describe, expect, it } from "vitest";
import { hasActiveConsent, type ConsentRecord } from "../src";

const R = (
  userId: string,
  consentType: ConsentRecord["consentType"],
  granted: boolean,
  recordedAt: string,
): ConsentRecord => ({ userId, consentType, granted, recordedAt });

describe("hasActiveConsent", () => {
  it("is true only when the latest record for the pair is a grant", () => {
    const records = [
      R("u1", "communication", true, "2026-01-01T00:00:00.000Z"),
      R("u1", "communication", false, "2026-03-01T00:00:00.000Z"),
      R("u1", "communication", true, "2026-05-01T00:00:00.000Z"),
    ];
    expect(hasActiveConsent(records, "u1", "communication")).toBe(true);
  });

  it("honors a revocation as the latest record", () => {
    const records = [
      R("u1", "communication", true, "2026-01-01T00:00:00.000Z"),
      R("u1", "communication", false, "2026-06-01T00:00:00.000Z"),
    ];
    expect(hasActiveConsent(records, "u1", "communication")).toBe(false);
  });

  it("fails closed when no record exists for the pair", () => {
    expect(hasActiveConsent([], "u1", "communication")).toBe(false);
    const other = [R("u2", "communication", true, "2026-01-01T00:00:00.000Z")];
    expect(hasActiveConsent(other, "u1", "communication")).toBe(false);
  });

  it("scopes to the requested consent type", () => {
    const records = [
      R("u1", "data_processing", true, "2026-05-01T00:00:00.000Z"),
      R("u1", "communication", false, "2026-05-01T00:00:00.000Z"),
    ];
    expect(hasActiveConsent(records, "u1", "data_processing")).toBe(true);
    expect(hasActiveConsent(records, "u1", "communication")).toBe(false);
  });

  it("rejects invalid timestamps (fail closed via throw)", () => {
    expect(() => hasActiveConsent([R("u1", "communication", true, "whenever")], "u1", "communication")).toThrow(
      /invalid timestamp/,
    );
  });
});
