# ADR-0028: Secure-messaging repositories + application-layer field encryption

## Status

**Accepted** — 2026-07-20 (Production Cutover directive, PHASE 5 — repositories
over the persisted tables; first consumer of the messaging tables from ADR-0027)

## Context

Migration 0006 (ADR-0027) added `conversation_threads` + `messages` with
FORCE RLS and a ciphertext-only `body_encrypted` column, but nothing wrote or
read them — messaging still ran entirely through the in-memory store. Two gaps
had to close together for a durable messaging path:

1. **A tenant-scoped persistence layer** over the new tables that routes every
   query through `withOrgContext` (ADR-0025) so RLS scopes it to one org.
2. **Actual field encryption.** The `encrypted` bytea columns (message bodies,
   and later phone/DOB/storage keys) had been schema-only — no code encrypted a
   field yet. The message body is the first value that MUST be ciphertext at
   rest (charter + cutover directive), so the encryption primitive lands here.

## Decision

### `FieldCipher` (AES-256-GCM) in `@aflo/security`

A small injected cipher — `createAesGcmFieldCipher(key)` producing
`{ encrypt(plaintext) → Buffer, decrypt(buffer) → string }` — with wire format
`[12-byte IV][16-byte GCM tag][ciphertext]`. Properties (all tested):

- **No plaintext at rest.** The DB stores only the opaque buffer; a round-trip
  through `encode(body_encrypted,'hex')` never contains the plaintext bytes.
- **Non-deterministic.** A fresh random IV per call → the same plaintext yields
  different ciphertext, so there is no equality/length oracle across rows.
- **Tamper-evident.** The GCM auth tag makes `decrypt` throw on a flipped byte or
  a wrong key rather than returning forged plaintext.
- **Fail-closed key handling.** `parseFieldEncryptionKey` rejects anything that
  is not a clean base64 round-trip of exactly 32 bytes; a wrong-length key throws
  at cipher construction. No key material lives in the repo — the 32-byte key is
  supplied at runtime from a secret env var (credential-gated); tests use an
  ephemeral generated key, so the crypto path is proven credential-free.

The cipher is **injected** into the repository (never env-reading inside it), so
the repository stays credential-free and testable and the key's provenance (env,
KMS, test) is the caller's concern.

### `DrizzleMessagingRepository` in `@aflo/database`

Implements the new `@aflo/shared` `MessagingRepository` contract
(`createThread`, `getThread`, `listThreads`, `postMessage`, `listMessages`,
`markThreadRead`, `setThreadStatus`). Every method wraps its work in
`withOrgContext(db, organizationId, …)` — one transaction-local org GUC per
operation, so RLS enforces isolation and the setting reverts at COMMIT/ROLLBACK
(no cross-request leak on a pooled connection). Callers work in **plaintext**
`Message.body`; encryption/decryption is entirely below this boundary.

Safety properties, proven on PGlite under a **non-superuser** role:

- **Bodies are ciphertext at rest**, decrypted only on read (raw `body_encrypted`
  never contains the plaintext; wire length is exactly plaintext + 28 bytes).
- **No cross-client mis-filing.** A message's `organization_id` and `client_id`
  are DERIVED from the loaded thread, never caller-supplied — closing the
  "no cross-table org/client CHECK" gap ADR-0027 flagged (FK validation bypasses
  RLS, so the guard is enforced in the repository). `createThread` verifies the
  client is in the current org; a **client** sender may only post to their OWN
  thread (`senderId` must equal the thread's `clientId`).
- **Well-formedness re-checked.** `postMessage`/`setThreadStatus` re-run the
  deterministic messaging kernel (`validateMessageDraft`, `transitionThread`), so
  a closed-thread / empty / too-long write is rejected even if a caller skipped
  validation.
- **Read receipts** mark only the counterparty's unread messages, idempotently
  (a second read transitions 0 rows).
- **No body in the outbox.** Event emission stays with the caller/store, and the
  `MessagePosted`/`MessageRead` payloads already carry ids + roles only — the
  repository writes no event and never places a body in one.

**Authorization boundary.** This layer enforces ORG isolation (RLS) and message
well-formedness. Cross-CLIENT authorization within an org (which staff/clients
may act on which client) is the authorization engine's job (ADR-0018
`CLIENT_SCOPED_PERMISSIONS` + the session's `linkedClientId`), not the
repository's — the same separation the rest of the system uses (e.g.
`ClientRepository.getDetail` also takes a `clientId` it does not itself
authorize). Note the deliberate asymmetry: `postMessage` additionally checks
`senderId === thread.clientId` (cheap defense-in-depth, since it has the sender),
but the read/receipt/status methods take no actor id and so **cannot** gate on
client ownership. **Wiring requirement (enforced before the client portal reaches
this repository):** the caller MUST gate `getThread`, `listThreads`,
`listMessages`, `markThreadRead`, and `setThreadStatus` through the authorization
engine so a client can only reach their own threads — otherwise, within one org,
a client id substituted for another's `threadId` would read that thread's
decrypted messages. There is no live exploit today (the repository is not yet
wired to any request path).

## Consequences

- **`@aflo/security` gains a runtime dependency edge into `@aflo/database`**
  (database → security). `@aflo/security` remains a leaf (node:crypto only), so
  no cycle. 19 security tests, 118 database tests (10 new messaging-repository
  integration tests), 230 shared tests; workspace typecheck/lint + web build +
  demo-marker guard green.
- **Not yet wired to the app or a live DB.** Swapping the store's messaging paths
  onto this repository, and supplying the `FIELD_ENCRYPTION_KEY` + Neon
  `DATABASE_URL` (interactive-tx driver — node-postgres/Neon serverless
  WebSocket Pool, never `neon-http`), are credential-gated deploy steps. The
  store keeps serving messaging until that cutover.
- **Key management is a documented deployment prerequisite.** The env var is a
  base64 32-byte AES-256 key; rotation (versioned keys / re-encryption) is a
  future concern — the wire format leaves room for a key-id prefix if needed.
- **Follow-up (separate PR):** the auth-resolver repositories over 0005's
  identity tables (`identity_provider_accounts`, `invitations`,
  `client_user_links`, `provider_webhook_events`, `session_revocations`),
  honoring ADR-0026's least-privileged-resolver-role / user-scoped
  `session_revocations` invariant and the `SECURITY DEFINER` accept-by-token
  lookup. Kept separate for reviewability.
