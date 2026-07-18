# @aflo/notifications

Consent-gated notification kernel. Deterministic and provider-neutral; **mock delivery in dev/preview**, Resend in production once the founder issues credentials (charter). No external send is ever attempted without consent.

## What lives here

- **`consent`** — `hasActiveConsent`: append-only, latest-record-wins consent evaluation (fails closed on stale/absent/invalid records).
- **`templates`** — the `NotificationType` catalog (each tied to a domain event), a typed template registry, and `renderNotification` (fails closed on any missing/blank variable — a half-populated message is never sent).
- **`delivery`** — the delivery-log allow-list state machine (`notification.v1.0.0`): `queued → sent → delivered | bounced`, `failed → queued` (retry); `suppressed`, `delivered`, `bounced` terminal.
- **`plan`** — `planNotification`: the consent gate runs **before** any content is rendered; the result is either `suppressed` (with a reason) or `queued` (with rendered content). Pure, no I/O.
- **`provider`** — `NotificationProvider` boundary and `MockNotificationProvider` (records sends, deterministic receipts, never contacts an external service).
- **`registry`** — versioned rule metadata, lockstep-tested against the code.

## Activating Resend (founder actions required)

1. Create the Resend account and verified sending domain; add `RESEND_API_KEY` to the worker/Vercel env (never the repo).
2. Add a `ResendNotificationProvider implements NotificationProvider` here that maps a `DeliveryRequest` to a Resend send and returns the provider message id.
3. Swap the provider at the composition root; the consent gate, templates, delivery state machine, and every call site stay unchanged.

Until then, dev/preview plan and "deliver" through the mock provider over synthetic data.
