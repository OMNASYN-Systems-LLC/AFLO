# @aflo/integrations

External-provider adapters (Stripe, Resend, storage, PostHog, Sentry) behind AFLO-owned interfaces so no provider schema leaks into domain logic. Stub until the first provider integration slice (Stripe test-mode billing).

This package is intentionally a stub (charter monorepo layout; ADR-0004). It gains real content only when its activating vertical slice lands. Regulated execution always stays with the provider — AFLO never stores raw card numbers, CVVs, bank-account numbers, or payment credentials.
