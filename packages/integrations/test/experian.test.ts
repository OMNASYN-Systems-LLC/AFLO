import { describe, expect, it } from "vitest";
import {
  EXPERIAN_VENDOR_ID,
  ExperianCreditDataProvider,
  ProviderNotContractedError,
  getVendor,
} from "../src";
import type { CreditReportRequest } from "@aflo/credit-data";

/**
 * The disabled Experian adapter conforms to the provider-neutral
 * `CreditDataProvider` seam but must NEVER serve data while uncontracted. It is
 * the concrete proof that a bureau seam exists without any live bureau access.
 */

const provider = new ExperianCreditDataProvider();

const request: CreditReportRequest = {
  subjectRef: "synthetic-client-1",
  purpose: "account_review",
  requestedAt: "2026-07-19T00:00:00.000Z",
};

describe("disabled Experian credit-data adapter", () => {
  it("is bound to the registry's Experian id", () => {
    expect(provider.info().id).toBe(EXPERIAN_VENDOR_ID);
    expect(getVendor(EXPERIAN_VENDOR_ID)).toBeDefined();
  });

  it("reports isProduction: false (mirrors the disabled registry entry)", () => {
    expect(provider.info().isProduction).toBe(false);
  });

  it("declares supported score models for interface conformance", () => {
    expect(provider.info().supportedScoreModels.length).toBeGreaterThan(0);
  });

  it("rejects every fetchReport with ProviderNotContractedError (never fabricates data)", async () => {
    await expect(provider.fetchReport(request)).rejects.toBeInstanceOf(ProviderNotContractedError);
  });

  it("the rejection names the vendor and capability", async () => {
    await expect(provider.fetchReport(request)).rejects.toMatchObject({
      vendorId: EXPERIAN_VENDOR_ID,
      capability: "fetchReport",
    });
  });
});
