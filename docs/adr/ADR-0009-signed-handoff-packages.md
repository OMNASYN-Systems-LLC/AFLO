# ADR-0009: Signed Verification Handoff Packages

## Status

**Accepted** — 2026-07-18 (founder-directed implementation order #13: reports and signed verification packages)

## Context

AFLO's long-term purpose is a financial verification and interoperability layer: a client's verified position (readiness stage, verified-document count, published progress) must be shareable with a consented professional — a CPA, a lending partner — in a form the recipient can trust was not altered in transit. The founder directive is explicit that this requires **real asymmetric digital signatures**, not a bare hash: "A SHA-256 hash alone is not a digital signature. Use a proper asymmetric signing key." It is equally explicit about what the output must **not** be called: not "audit-proof", "legally verified", "underwriting approved", "pre-audited", or "zero-knowledge" — none of those capabilities exist or have been independently reviewed.

The package must carry recipient scope, consent scope, expiration, and revocation, and every issuance/revocation must be auditable. Acknowledgment and sign-off records must store a digest and identity, never a raw authentication token or a browser fingerprint.

## Decision

**1. A dedicated security package** (`packages/security`, `@aflo/security`, rule tag `security.v1.0.0`) holds three pure primitives, isolated from the readiness engine:

- **`canonical`** — deterministic JSON serialization (recursively sorted keys). Signer and verifier serialize a payload identically, so the signature is stable regardless of key order.
- **`signing`** — SHA-256 digests (integrity, **not** a signature) and **Ed25519** asymmetric sign/verify over the canonical payload. Keys carry a self-describing `keyId` (first 16 hex of the public key's SHA-256) so a verifier selects the public key by the id recorded on the signature — the rotation seam.
- **`handoff`** — `HandoffPackage` (signed `HandoffFacts` payload, recipient scope, consent scope, `payloadDigest`, `signature`, `keyId`, `algorithm`, `issuedAt`, `expiresAt`, `revokedAt`, `ruleVersion`), `assembleHandoffPackage`, and `verifyHandoffPackage`. Verification is **fail-closed and ordered**: revoked → digest → known key → signature → expiry, each yielding a specific verdict (`REVOKED`, `DIGEST_MISMATCH`, `UNKNOWN_KEY`, `SIGNATURE_INVALID`, `EXPIRED`, `VALID`). Integrity is checked before staleness, so tampering is reported over expiry.

**2. The payload is verified facts only** (`HandoffFacts`): subject name, issuing organization, the **ΛFLO readiness stage** (with `readinessIsBureauScore: false` and the deterministic rule version), primary goal, count of staff-approved documents, and the latest published report quarter. No SSN, bank-account, or raw credit-report data ever enters a package. The readiness stage is the deterministic lifecycle stage — explicitly **not** a credit-bureau score, and the two are never merged.

**3. The store gates issuance and owns the lifecycle** (`AfloStore`). `generateHandoffPackage` fails closed on three gates before signing: a server-verified actor, active **`partner_data_sharing`** consent (an external share is impossible without it), and at least one recorded readiness assessment (a handoff must assert a verified position). `verifyHandoffPackageById` is a pure read against the store's key and clock. `revokeHandoffPackage` is one-way. Issuance and revocation are audited and organization/actor scoped; denials are audited and never mutate.

**4. Key custody is provider-neutral; no production key lives in the repo.** The prototype store generates an ephemeral Ed25519 key per process (documented dev-only) so packages verify within the running store. In production the private key lives behind a managed KMS/HSM; the `keyId` on each package is the rotation and resolution seam. The private key is never serialized, logged, or exposed.

## Consequences

Positive: a recipient can detect any post-issuance tampering (digest + signature), staleness (expiry), or withdrawal (revocation) with a specific verdict; the share is impossible without recorded consent and a verified position; the crypto primitives are pure and unit-tested apart from the store; the readiness-stage/bureau-score boundary is enforced in the payload itself.

Negative / accepted: the dev key is process-ephemeral, so packages do not survive a restart and cross-process verification is out of scope until KMS integration — acceptable and documented for the prototype. `@aflo/security` uses `node:crypto` and must stay server-side; the shared facade re-exports only its **types** (erased at compile time) so no crypto runtime reaches a client bundle, and the store that consumes it is already server-only. Issuance is audited but does not yet emit a domain event; a `HandoffPackageIssued`/`HandoffPackageRevoked` event pair is a follow-up when a consumer needs it.

## Explicitly Out of Scope / Not Claimed

The package is a **tamper-evident, signed data package**. It is not audit-proof, not legally verified, not underwriting-approved, not pre-audited, and not a zero-knowledge proof. It is not a credit-bureau report and carries no bureau score. Client acknowledgment and professional sign-off record shapes store the payload digest and identity only — never a raw authentication token or a browser fingerprint.

## Alternatives Considered

1. **SHA-256 digest alone as the "signature"** — rejected by the directive: a hash proves integrity against accidental change but anyone can recompute it, so it authenticates nothing. Asymmetric signing is required.
2. **HMAC (shared secret)** — rejected: every verifier would need the signing secret, which both lets them forge packages and spreads the secret. Asymmetric keys let recipients verify with a public key they cannot sign with.
3. **Embedding raw credit/financial data in the payload** — rejected by charter: the package carries derived, verified facts (readiness stage, counts), never raw regulated data.
4. **Issuing without a consent gate** — rejected: an external share of a client's position requires recorded `partner_data_sharing` consent; absent it, issuance fails closed.
