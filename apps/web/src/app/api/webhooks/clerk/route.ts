import { verifyWebhook } from "@aflo/auth/webhook";
import {
  createResolverConnection,
  DrizzleIdentityAccountRepository,
  DrizzleSessionRevocationRepository,
  DrizzleWebhookEventRepository,
  handleClerkWebhook,
  isResolverConfigured,
} from "@aflo/database";
import { resolveAuthMode, resolveRepositoryMode } from "@aflo/shared";

/**
 * Clerk webhook receiver (Workstream B4, ADR-0039) — a THIN composition over
 * the tested `handleClerkWebhook` service. All logic (verify-first, digest-only
 * idempotent receipt, retryable failures, authority-respecting dispatch) lives
 * in @aflo/database/services; this file only builds the dependencies from env
 * and FAILS CLOSED (503, nothing processed, nothing persisted) unless the real
 * runtime is fully configured:
 *
 *   - AUTH_MODE=clerk and REPOSITORY_MODE=postgres (the demo/synthetic runtime
 *     NEVER processes provider webhooks),
 *   - CLERK_WEBHOOK_SECRET present,
 *   - the resolver connection configured (AUTH_RESOLVER_DATABASE_URL).
 *
 * Secrets never appear in responses or logs. The raw body is read exactly once
 * and passed byte-for-byte to signature verification.
 */

export const dynamic = "force-dynamic";
// node:crypto + pg require the Node.js runtime — pinned against config drift.
export const runtime = "nodejs";

/**
 * Module-scoped lazy resolver connection: pool construction performs no I/O
 * (ADR-0033) and a per-request pool would leak — one handle serves the route's
 * lifetime, keyed by URL so a config change in dev gets a fresh handle.
 */
let cached: { url: string; handle: ReturnType<typeof createResolverConnection> } | null = null;
function resolverHandle(url: string): ReturnType<typeof createResolverConnection> {
  if (!cached || cached.url !== url) {
    // Drain a replaced handle (config change in dev) instead of leaking it.
    void cached?.handle.close().catch(() => undefined);
    cached = { url, handle: createResolverConnection(url) };
  }
  return cached.handle;
}

export async function POST(request: Request): Promise<Response> {
  const env = process.env;
  const secret = env.CLERK_WEBHOOK_SECRET?.trim() ?? "";
  const configured =
    resolveAuthMode(env) === "clerk" &&
    resolveRepositoryMode(env) === "postgres" &&
    secret.length > 0 &&
    isResolverConfigured(env);
  if (!configured) {
    return Response.json(
      { ok: false, outcome: "not_configured" },
      { status: 503, headers: { "cache-control": "no-store" } },
    );
  }

  const payload = await request.text();
  // Resolver-side repositories ONLY — the webhook never touches tenant-scoped
  // data, so no tenant handle (and no field cipher) is ever constructed here.
  const resolver = resolverHandle(env.AUTH_RESOLVER_DATABASE_URL ?? "");

  const result = await handleClerkWebhook(
    {
      verify: (input) => verifyWebhook({ payload: input.payload, headers: input.headers, secret }),
      webhookEvents: new DrizzleWebhookEventRepository(resolver.db),
      identityAccounts: new DrizzleIdentityAccountRepository(resolver.db),
      sessionRevocations: new DrizzleSessionRevocationRepository(resolver.db),
      now: () => new Date(),
    },
    {
      payload,
      headers: {
        "svix-id": request.headers.get("svix-id"),
        "svix-timestamp": request.headers.get("svix-timestamp"),
        "svix-signature": request.headers.get("svix-signature"),
      },
    },
  );
  return Response.json(result.body, { status: result.status, headers: { "cache-control": "no-store" } });
}
