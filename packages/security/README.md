# @aflo/security

Security primitives and cryptographically verifiable handoff packages.

## What lives here

- **`canonical`** — deterministic JSON serialization (recursively sorted keys) so signer and verifier serialize a payload identically.
- **`signing`** — SHA-256 digests and **Ed25519 asymmetric** sign/verify. A SHA-256 hash alone is **not** a signature; signing uses a real asymmetric key with a `keyId` for rotation.
- **`handoff`** — `HandoffPackage` (signed payload of verified facts, recipient + consent scope, expiration, revocation), `assembleHandoffPackage`, and `verifyHandoffPackage` (digest → signature → expiry → revocation, fail-closed with a specific verdict). Plus `ClientAcknowledgment` and `ProfessionalSignOff` record shapes.

## Boundaries (charter)

- The output is a **tamper-evident, signed data package** — it is *not* called "audit-proof", "legally verified", "underwriting approved", "pre-audited", or "zero-knowledge" (none independently reviewed).
- **No production key material lives in the repo.** In production the private key lives behind a managed KMS/HSM; this module is provider-neutral about key source. The demo generates an ephemeral process key (dev only).
- Acknowledgment and sign-off records store the **payload digest and identity**, never a raw authentication token or a browser fingerprint.
