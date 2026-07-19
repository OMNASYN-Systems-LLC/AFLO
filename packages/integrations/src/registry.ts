/**
 * Vendor-discovery registry (integrations.v1.0.0).
 *
 * A single, deterministic source of truth for which EXTERNAL vendors AFLO may
 * one day integrate, and — far more importantly — the exact contract lifecycle
 * status of each. It exists to make the platform's central commercial-safety
 * rule mechanical and testable: **no external vendor may be used until a
 * reviewed agreement, sandbox credentials, and compliance sign-off exist.**
 *
 * Fail-safe by construction:
 *   - Every vendor starts at `discovery`, `isEnabled: false`, `requiresAgreement: true`.
 *   - `isVendorEnabled` returns true ONLY for a `production` + enabled vendor.
 *   - `assertVendorEnabled` THROWS otherwise; regulated code paths call it first.
 *   - `validateVendorRegistry` asserts the V1 invariant that NOTHING is enabled.
 *
 * IMPORTANT — nominative use only. Vendor display names below identify
 * PROSPECTIVE relationships for internal engineering planning. They are NOT
 * partnerships, endorsements, or claims of availability, and this registry
 * MUST NOT be surfaced to clients or marketed as a partner list. Presenting a
 * `discovery`/`contract_pending`/`sandbox` vendor as an active partner would
 * violate the "never imply nonexistent partnerships" rule.
 */

import { VendorNotEnabledError } from "./errors";

export const INTEGRATIONS_RULES_VERSION = "integrations.v1.0.0" as const;

/**
 * Contract lifecycle, ordered from least to most access. A vendor advances
 * only through founder-approved, compliance-reviewed transitions; nothing
 * advances automatically.
 *   - discovery         — identified as a candidate; no contact/agreement.
 *   - contract_pending  — commercial/legal discussions underway; not usable.
 *   - sandbox           — executed agreement + test credentials; NON-production only.
 *   - production        — live, contracted, compliance-signed-off; the ONLY
 *                         status at which real consumer data/execution is permitted.
 */
export const VENDOR_LIFECYCLE_STATUSES = [
  "discovery",
  "contract_pending",
  "sandbox",
  "production",
] as const;

export type VendorLifecycleStatus = (typeof VENDOR_LIFECYCLE_STATUSES)[number];

/**
 * The regulated capability domains an external vendor might supply. AFLO owns
 * the intelligence/readiness/relationship layer; each of these domains is a
 * licensed activity that stays with a contracted provider (ADR-0007).
 */
export const VENDOR_CAPABILITY_DOMAINS = [
  "credit_data", // bureau data / credit reports & scores
  "credit_builder", // secured credit-builder / alternative-data reporting
  "investing", // brokerage / round-up investing
  "deposits", // bank deposit accounts
  "lending", // loans / credit products
  "card_issuance", // issuer-processor / card programs (sponsor bank required)
  "rewards", // rewards / cashback marketplace
] as const;

export type VendorCapabilityDomain = (typeof VENDOR_CAPABILITY_DOMAINS)[number];

export interface VendorRecord {
  /** Stable internal id (kebab-case); never a marketing string. */
  readonly id: string;
  /** Human-readable prospective-vendor name (nominative use; see file header). */
  readonly displayName: string;
  /** The regulated domain this vendor would supply. */
  readonly domain: VendorCapabilityDomain;
  /** Current contract lifecycle status. */
  readonly status: VendorLifecycleStatus;
  /**
   * Whether this vendor is switched on. INVARIANT: may only be true when
   * `status === "production"`. False for every V1 vendor.
   */
  readonly isEnabled: boolean;
  /** Whether an executed agreement is required before any use. Always true. */
  readonly requiresAgreement: boolean;
  /** Trademark owner, recorded so nominative use is explicit and attributable. */
  readonly trademarkOwner: string;
  /** Short, factual note on scope and why it is not active. */
  readonly notes: string;
}

/**
 * The seeded registry. Every entry is a CANDIDATE at `discovery`, disabled,
 * agreement-required — an honest statement that no integration is live. The
 * business-development track (executing agreements) is the founder's; when an
 * agreement and compliance review land, that vendor's record advances under a
 * reviewed change, never silently.
 */
export const VENDOR_REGISTRY: readonly VendorRecord[] = Object.freeze([
  {
    id: "experian-partner-solutions",
    displayName: "Experian Partner Solutions",
    domain: "credit_data",
    status: "discovery",
    isEnabled: false,
    requiresAgreement: true,
    trademarkOwner: "Experian",
    notes:
      "Prospective bureau-data provider behind the credit-data adapter. Requires an executed agreement, permissible-purpose controls, and compliance review before any use.",
  },
  {
    id: "creditstrong",
    displayName: "CreditStrong",
    domain: "credit_builder",
    status: "discovery",
    isEnabled: false,
    requiresAgreement: true,
    trademarkOwner: "Austin Capital Bank SSB / CreditStrong",
    notes:
      "Prospective secured credit-builder provider. Referral-only until an agreement exists; AFLO never opens accounts or extends credit.",
  },
  {
    id: "ava",
    displayName: "Ava",
    domain: "credit_builder",
    status: "discovery",
    isEnabled: false,
    requiresAgreement: true,
    trademarkOwner: "Ava Finance",
    notes:
      "Prospective alternative-data / credit-builder provider. Discovery only; no data exchange until contracted and reviewed.",
  },
  {
    id: "acorns",
    displayName: "Acorns",
    domain: "investing",
    status: "discovery",
    isEnabled: false,
    requiresAgreement: true,
    trademarkOwner: "Acorns Grow Incorporated",
    notes:
      "Prospective round-up investing provider. AFLO's round-up feature is a SIMULATION; no real investing or fund movement occurs. Investing execution stays with the licensed broker-dealer.",
  },
  {
    id: "marqeta",
    displayName: "Marqeta",
    domain: "card_issuance",
    status: "discovery",
    isEnabled: false,
    requiresAgreement: true,
    trademarkOwner: "Marqeta, Inc.",
    notes:
      "Prospective issuer-processor. A branded card requires a sponsor bank, KYC/CIP, and a full program build — not a frontend integration. Discovery only.",
  },
  {
    id: "highnote",
    displayName: "Highnote",
    domain: "card_issuance",
    status: "discovery",
    isEnabled: false,
    requiresAgreement: true,
    trademarkOwner: "Highnote Inc.",
    notes:
      "Prospective issuer-processor (alternative to Marqeta). Same sponsor-bank/program-build requirements. Discovery only.",
  },
]);

/** Look up a vendor by id, or `undefined` if not registered. */
export function getVendor(vendorId: string): VendorRecord | undefined {
  return VENDOR_REGISTRY.find((v) => v.id === vendorId);
}

/** All vendors, optionally filtered to one capability domain. */
export function listVendors(domain?: VendorCapabilityDomain): readonly VendorRecord[] {
  return domain ? VENDOR_REGISTRY.filter((v) => v.domain === domain) : VENDOR_REGISTRY;
}

/**
 * Whether a vendor may be USED. Fail-safe: an unknown vendor, or any vendor
 * not in a `production` + enabled state, is not usable. This is the single
 * predicate every regulated integration point should consult.
 */
export function isVendorEnabled(vendorId: string): boolean {
  const vendor = getVendor(vendorId);
  return vendor !== undefined && vendor.status === "production" && vendor.isEnabled;
}

/**
 * Guard for regulated code paths. Throws `VendorNotEnabledError` unless the
 * vendor is production + enabled. Call this BEFORE constructing or invoking any
 * real external adapter.
 */
export function assertVendorEnabled(vendorId: string): void {
  if (!isVendorEnabled(vendorId)) {
    const status = getVendor(vendorId)?.status ?? "unregistered";
    throw new VendorNotEnabledError(vendorId, status);
  }
}

/**
 * Deterministic self-check of the registry's safety invariants. Returns the
 * list of violations (empty ⇒ sound). The test suite asserts this is empty, so
 * a future edit that enables a vendor without also flipping it to `production`
 * — or that ships an entry not requiring an agreement — fails CI.
 */
export function validateVendorRegistry(): string[] {
  const violations: string[] = [];
  const seen = new Set<string>();

  for (const v of VENDOR_REGISTRY) {
    if (seen.has(v.id)) violations.push(`duplicate vendor id: ${v.id}`);
    seen.add(v.id);

    if (!v.requiresAgreement) {
      violations.push(`vendor ${v.id} must require an agreement`);
    }
    // The V1 hard invariant: nothing is live.
    if (v.isEnabled) {
      violations.push(`vendor ${v.id} is enabled — no external vendor may be enabled in V1`);
    }
    if (v.status === "production") {
      violations.push(`vendor ${v.id} is production — no external vendor may be production in V1`);
    }
    // Structural invariant that must hold at every status: enabled ⇒ production.
    if (v.isEnabled && v.status !== "production") {
      violations.push(`vendor ${v.id} is enabled without production status`);
    }
  }

  return violations;
}
