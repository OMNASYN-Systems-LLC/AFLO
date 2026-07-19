# ADR-0016: Client message-reply targeting without exposing internal ids

## Status

**Accepted** — 2026-07-19 (Production Readiness directive, secure-messaging
interactive-send slice)

## Context

Secure staff↔client messaging now renders in both surfaces (staff client-detail
card and client portal). This slice makes it interactive: staff and clients can
send messages, completing the two-way loop.

The staff side is straightforward — the staff client-detail page already holds
the `ConversationThread` (with its `id`) server-side, so a staff reply posts to
`thread.id`, and `store.postReply` re-scopes that id to the session's org.

The client side hits a deliberate constraint. The client portal renders
`ClientThreadView`, a projection that is documented as a **safety boundary**
(`packages/shared/src/domain/messaging.ts`): it is built only from `Message`s
and **strips every internal field**, including the thread id and all sender ids.
A client sees "you"/"advisor", the body, and the time — nothing else. To reply,
the client must somehow name *which* thread — but the browser has never received
a thread id, and the projection's whole point is that it never should.

## Decision

**Keep `ClientThreadView` id-free. Target a client reply by its positional
index in the client's own conversation list, re-resolved server-side from the
session.**

- The portal renders `view.conversations.map((thread, threadIndex) => …)` and
  binds `sendClientMessageAction.bind(null, threadIndex)`. Only the integer
  index crosses to the browser — never an internal id.
- `sendClientMessageAction` (`apps/web/src/app/portal/actions.ts`) resolves the
  session (org + client id come **only** from `getClientSession()`), calls
  `store.conversationsFor(session.organizationId, session.clientId)`, and indexes
  into *that* list. It posts with `senderRole: "client"`,
  `senderId: session.clientId`.
- Index order matches what the client saw because both the portal repository's
  `getPortalView` and `store.conversationsFor` sort conversations by
  `(lastMessageAt ?? createdAt)` descending.

Two independent properties make this safe:

1. **Isolation by construction.** The index only ever indexes into the *session
   client's own* threads. A tampered or stale index can, at worst, resolve to a
   *different thread of the same client* (benign) or out of range (a no-op) — it
   can never reach another client's or another org's thread, because the list it
   indexes is already scoped to the session.
2. **Defense in depth.** `store.postReply` independently re-verifies the thread
   belongs to `session.organizationId` and that the sender is the thread's own
   client (`senderId === thread.clientId`); any mismatch is denied and audited.

## Alternatives Considered

1. **Add `threadId` to `ClientThreadView` and post it from the form.** Rejected.
   It is the simplest code, and it is *not* a cross-tenant leak (the store
   re-verifies ownership, and it is the client's own thread id). But it visibly
   weakens a boundary the founder has repeatedly emphasized and that adversarial
   review has already scrutinized — the projection exists precisely so the
   browser never holds internal ids. The thread id also embeds the internal
   client record id. The index handle achieves the same function with the
   boundary fully intact, so the small extra indirection is worth it.
2. **Mint a per-thread opaque token (hash/HMAC) in the projection.** Rejected as
   over-engineering: a token still resolves server-side to the client's own
   threads, giving no security benefit over the index while adding key
   management and surface. If threads ever need a stable client-facing handle
   across renders (e.g. deep links), revisit this then.
3. **Single-thread assumption (post to "the" thread).** Rejected — the model
   supports multiple threads per client and the seed already exercises that, so
   a positional handle is required.

## Consequences

- The portal's message reply is robust for the single-actor prototype. Positional
  indices are only fragile under concurrent thread reordering between render and
  submit, which cannot happen in the demo's single-session model and would be
  benign (own-thread-only) even if it did.
- When durable persistence and real client auth land, the same action shape
  holds: session-derived identity + server-side re-resolution. A durable store
  swaps in behind `store.conversationsFor`/`store.postReply` without touching the
  portal or the boundary.
