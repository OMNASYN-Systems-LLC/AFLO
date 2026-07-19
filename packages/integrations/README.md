# @aflo/integrations

External-provider adapters behind AFLO-owned interfaces so no provider schema leaks into domain logic (ADR-0004, ADR-0007). This package is the home of the **vendor-discovery registry** and **disabled provider skeletons**.

## Vendor-discovery registry (`integrations.v1.0.0`)

A single, deterministic source of truth for which external vendors AFLO may one day integrate and — critically — the exact contract-lifecycle status of each. It makes the platform's central commercial-safety rule mechanical and testable:

> **No external vendor may be used until a reviewed agreement, sandbox credentials, and compliance sign-off exist.**

Lifecycle: `discovery → contract_pending → sandbox → production`. Every seeded vendor is at `discovery`, `isEnabled: false`, `requiresAgreement: true`. `isVendorEnabled` returns true only for a `production` + enabled vendor; `assertVendorEnabled` throws otherwise and is the guard every regulated code path calls first. `validateVendorRegistry()` asserts the V1 invariant that nothing is enabled — a test fails CI if that ever regresses.

> **Nominative use only.** Vendor display names identify *prospective* relationships for internal engineering planning. They are **not** partnerships, endorsements, or claims of availability, and this registry **must not** be surfaced to clients or marketed as a partner list.

## Disabled provider skeletons

`ExperianCreditDataProvider` implements the provider-neutral `CreditDataProvider` seam from `@aflo/credit-data` so a real bureau implementation can drop in behind the same interface once contracted. Until then it holds no credentials, makes no network call, reports `isProduction: false`, and rejects every `fetchReport` with `ProviderNotContractedError` — it never fabricates a report and never implies Experian data is available.

## Boundaries

Regulated execution always stays with a contracted provider. AFLO never stores raw card numbers, CVVs, bank-account numbers, or payment credentials. Advancing any vendor past `discovery` is a founder-approved, compliance-reviewed change — never automatic.
