/**
 * Disabled Experian credit-data adapter (integrations.v1.0.0).
 *
 * A DISCOVERY SKELETON. It implements AFLO's provider-neutral
 * `CreditDataProvider` interface (from @aflo/credit-data) so that, when an
 * Experian Partner Solutions agreement and compliance review eventually exist,
 * a real implementation can drop in behind the same seam with no change to the
 * readiness engine. Until then it:
 *   - holds NO credentials and makes NO network call;
 *   - reports `isProduction: false`;
 *   - REJECTS every `fetchReport` with `ProviderNotContractedError` — it never
 *     fabricates a report and never implies Experian data is available.
 *
 * The adapter's contract status is driven by the vendor-discovery registry
 * (single source of truth). It refuses to operate unless its registry entry is
 * `production` + enabled, which is never the case in V1.
 */

import type {
  CreditDataProvider,
  CreditDataProviderInfo,
  CreditReportRequest,
  NormalizedCreditReport,
} from "@aflo/credit-data";
import { ProviderNotContractedError } from "./errors";
import { getVendor, isVendorEnabled } from "./registry";

/** Registry id this adapter is bound to. */
export const EXPERIAN_VENDOR_ID = "experian-partner-solutions" as const;

export class ExperianCreditDataProvider implements CreditDataProvider {
  info(): CreditDataProviderInfo {
    const vendor = getVendor(EXPERIAN_VENDOR_ID);
    return {
      id: EXPERIAN_VENDOR_ID,
      displayName: vendor?.displayName ?? "Experian Partner Solutions (disabled)",
      // Declared for interface conformance only — no report is ever served.
      supportedScoreModels: ["vantagescore_3", "vantagescore_4", "fico_8", "fico_9"],
      // Mirrors the registry: false unless the vendor is production + enabled.
      isProduction: isVendorEnabled(EXPERIAN_VENDOR_ID),
    };
  }

  // eslint-disable-next-line @typescript-eslint/no-unused-vars -- signature conformance; request is intentionally unused while disabled.
  fetchReport(_request: CreditReportRequest): Promise<NormalizedCreditReport> {
    // Fail closed. Even if the argument is well-formed, this adapter is not
    // contracted, so it must not return data.
    return Promise.reject(new ProviderNotContractedError(EXPERIAN_VENDOR_ID, "fetchReport"));
  }
}
