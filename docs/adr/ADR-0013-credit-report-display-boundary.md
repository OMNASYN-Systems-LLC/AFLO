# ADR-0013: Credit-Report Summary — Display-Only, Consent-Gated, Mock-Only

## Status

**Accepted** — 2026-07-19 (wiring the provider-neutral credit-data interfaces from Slice V / ADR-0007 §5 into the app)

## Context

`@aflo/credit-data` (Slice V, PR #41) defined the provider-neutral bureau seam (`CreditDataProvider`), a normalized model, deterministic `summarizeCreditReport`, and a synthetic `MockCreditDataProvider` — but left store/UI wiring as a follow-up. The founder's standing direction is emphatic that credit is the most sensitive domain: **no bureau access, everything mock/disabled behind interfaces until a reviewed contract exists, and AFLO never presents a report as authoritative or lets it silently drive decisions.** Two hazards had to be closed in code:

1. A report summary could be mistaken for, or silently merge into, the staff-maintained `CreditProfile` or the deterministic readiness inputs.
2. Sensitive data could be shown without consent, or a real bureau could be reached before it is contracted.

## Decision

**1. `store.creditReportSummaryFor(orgId, clientId, now)` — an async, display-only read.** It routes through the provider-neutral seam (`this.creditProvider`, the synthetic `MockCreditDataProvider` in V1), then `summarizeCreditReport`. It:

- **fails closed on org scope** via `findRecord` (unknown / foreign-org → `null`);
- is **consent-gated** on `data_processing` — absent consent returns `{ available: false, reason: "consent_required" }`, never the data (a `UnknownSubjectError` from the provider maps to `reason: "no_report"`);
- is a **pure read** — no mutation, no event, no audit, and it **never** writes the `CreditProfile` or the readiness assessment;
- returns `isProduction: false` (mirrors the provider) and `staffVerified: false` — the figures are **unverified reported data**.

**2. The `CreditReportSummary` type is deliberately separate** from `CreditProfile` and from `ReadinessFacts`. The readiness engine continues to read only the manual `CreditProfile` via `toReadinessFacts`; nothing in this path feeds it. The seam is the same async interface a real bureau adapter would implement — so a contracted Experian adapter (ADR-0011, disabled today) drops in with no readiness-engine change.

**3. The staff card labels the data honestly.** "Credit report (synthetic)", a "Synthetic" badge, and the standing note: *mock provider, not a bureau report, staff must verify, never auto-updates the credit profile or the readiness assessment.* Synthetic reports live in the demo dataset (`source: "mock"`, `subjectRef` is a client id — never an SSN); only `c-whitaker` and `c-solomon` carry `data_processing` consent, so the gate is demonstrably enforced.

## Consequences

Positive: the credit-report display exercises the real provider seam end-to-end with zero bureau access; the "report never drives readiness" and "consent-gated" rules are structural and tested, not conventions; a real bureau adapter is a drop-in behind the same interface under a future reviewed contract.

Negative / accepted: gating on the existing `data_processing` consent is a pragmatic choice — a dedicated `credit_data_access` consent type (a schema/enum change) is deferred until real bureau integration is contemplated (itself gated). The summary is recomputed per request rather than cached (fine at demo scale). Tradeline-level detail is intentionally not surfaced — only aggregate facts — to avoid presenting granular reported data as verified.

## Alternatives Considered

1. **Merge the report facts into `CreditProfile` / feed readiness** — rejected outright: it would let unverified, provider-sourced data silently change a regulated-adjacent decision. The two paths stay separate by construction.
2. **Read the seeded report directly (sync), bypassing the provider** — rejected: the point of the slice is to exercise the provider-neutral seam so a real adapter is a true drop-in; the async provider call models reality and handles the unknown-subject path.
3. **Add a dedicated `credit_data_access` consent type now** — deferred: it is a schema/enum migration with no consumer until real bureau data is on the table (which is contract-gated). `data_processing` is the honest existing gate meanwhile.
4. **Surface full tradeline detail** — rejected for V1: aggregate facts suffice for staff context without presenting granular unverified data as authoritative.
