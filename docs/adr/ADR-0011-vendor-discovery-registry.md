# ADR-0011: Vendor-Discovery Registry and Disabled Provider Skeletons

## Status

**Accepted** — 2026-07-19 (founder implementation order #15–#16: Experian disabled adapter skeleton + vendor-discovery registry)

## Context

The founder's strategic direction is unambiguous: ΛFLO owns the intelligence, readiness, relationship, and verification layers; every regulated capability — bureau data, investing, deposits, lending, card issuance, custody, execution — stays with a licensed provider, and **every external provider remains a mock or discovery adapter behind a provider-neutral interface until a contract, sandbox credentials, and compliance gates exist.** ADR-0007 set that boundary; the roadmap names concrete candidates (Experian Partner Solutions, CreditStrong, Ava, Acorns, Marqeta, Highnote).

Two risks needed closing in code, not prose:

1. **Silent activation** — a regulated code path could construct or call a real external adapter with no gate, implying access AFLO does not have.
2. **Implied partnership** — naming prospective vendors anywhere client-facing could read as an endorsement or a live partnership, violating the "never imply nonexistent partnerships / never use trademarks unauthorized" rule.

`@aflo/credit-data` already defines the provider-neutral bureau seam and a synthetic mock. What was missing was (a) a machine-checkable statement of *which* vendors exist and their exact contract status, and (b) a concrete disabled adapter proving the seam works without any live access.

## Decision

**1. Activate `@aflo/integrations` (`integrations.v1.0.0`) with a vendor-discovery registry.** A frozen, deterministic list of prospective vendors, each carrying a `VendorLifecycleStatus` (`discovery → contract_pending → sandbox → production`), `isEnabled`, `requiresAgreement`, `domain`, and `trademarkOwner`. Every seeded vendor is at `discovery`, `isEnabled: false`, `requiresAgreement: true`.

**2. The registry fails safe.** `isVendorEnabled(id)` returns true only for a `production` + enabled vendor; an unknown vendor is not enabled. `assertVendorEnabled(id)` throws `VendorNotEnabledError` otherwise and is the guard regulated paths call before touching any external adapter. `validateVendorRegistry()` returns violations for any enabled vendor, any non-production vendor that is somehow enabled, any agreement-free vendor, or duplicate ids — and the test suite asserts it is empty, so enabling a vendor without moving it to `production` under a reviewed change fails CI.

**3. Disabled provider skeletons implement the real seam.** `ExperianCreditDataProvider` implements `@aflo/credit-data`'s `CreditDataProvider`. It holds no credentials, makes no network call, reports `isProduction: false` (driven by the registry), and rejects every `fetchReport` with `ProviderNotContractedError`. A real implementation drops in behind the same interface once contracted, with no change to the readiness engine.

**4. Vendor names are nominative internal-planning data only.** The registry records `trademarkOwner` for attribution and is documented (package README, this ADR, code header) as engineering scaffolding that MUST NOT be surfaced to clients or marketed as a partner list. No compensation figures, no invented API capabilities, no scraped data.

## Consequences

Positive: the "no external vendor until contracted" rule is now mechanical and tested, not just documented; a bureau seam demonstrably exists with zero live bureau access; advancing any vendor is a visible, reviewed status change that CI guards; the readiness engine imports none of this — the boundary is structural.

Negative / accepted: the registry duplicates a fact (candidate vendor list) that also lives in the roadmap prose; the two must be kept in sync, but the registry is the machine-checked copy. The disabled adapter's `supportedScoreModels` is declared for interface conformance only and is not authoritative until a real integration replaces it. Advancing a vendor to `sandbox`/`production` will require a follow-up ADR covering permissible-purpose, data-retention, and credential-handling controls per that vendor's domain.

## Alternatives Considered

1. **Leave the boundary as prose in ADR-0007 / the roadmap** — rejected: prose cannot fail a build. A regulated path could be added with no gate. The registry + `assertVendorEnabled` make the boundary executable.
2. **A boolean env flag per provider (e.g. `EXPERIAN_ENABLED`)** — rejected: env flags are ungoverned, easy to flip, and carry no lifecycle, agreement, or compliance context. The registry encodes the full lifecycle and fails safe by default.
3. **Omit prospective vendor names entirely until contracts exist** — rejected: the founder explicitly directed preparing named skeletons, and honest internal planning data (clearly marked discovery/disabled, never client-facing) is nominative use, not an implied partnership. The safeguard is the documented no-surface rule plus the tested "nothing enabled" invariant.
4. **Put the Experian adapter in `@aflo/credit-data`** — rejected: credit-data owns the *interface* and the synthetic mock; concrete external adapters are *integrations*. Keeping them in `@aflo/integrations` preserves a clean seam and lets the registry govern all domains uniformly.
