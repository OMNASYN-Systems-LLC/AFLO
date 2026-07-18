# @aflo/credit-data

Provider-neutral credit-data interfaces (`credit-data.v1.0.0`).

## What lives here

- **`model`** — the normalized, bureau-agnostic AFLO credit model: `NormalizedCreditReport`, `NormalizedTradeline`, `NormalizedInquiry`, `CreditScore`. Every provider normalizes into these shapes.
- **`provider`** — the `CreditDataProvider` adapter interface plus `CreditReportRequest` and `CreditDataProviderInfo`. Real bureaus plug in behind this; the app never sees a bureau's raw schema (ADR-0007 §5).
- **`normalize`** — `summarizeCreditReport`, deterministic aggregation of a report into readiness-relevant `CreditFacts` (utilization, derogatory count, recent hard inquiries, on-time rate). No stage decision, no inference.
- **`mock`** — `MockCreditDataProvider` and `syntheticCreditReport`, the only provider in V1.

## Boundaries (charter / ADR-0007 §5)

- **No production bureau is wired.** Real providers plug in only behind a reviewed contract and compliance review (FCRA permissible purpose, consent, retention). `isProduction` is false for every provider in V1.
- The layer is never architected around one bureau's proprietary schema.
- Data here is **synthetic**; `subjectRef` is a client id, never a real SSN or bureau file number.
- No AFLO readiness stage is derived here, and a readiness stage is never presented as a bureau score.
