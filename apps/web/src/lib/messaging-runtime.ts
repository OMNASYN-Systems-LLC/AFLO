import {
  AuthorizedMessagingService,
  DrizzleAuditEventRepository,
  DrizzleMessagingRepository,
  isMessagingRouteConfigured,
  messagingCipherFromEnv,
  type MessagingRouteDeps,
  type MessagingRouteResult,
} from "@aflo/database";
import { createSessionProvider, resolverHandle, tenantHandle } from "@/lib/auth-runtime";

/**
 * SERVER-ONLY messaging-route composition (Workstream B9, ADR-0044) — the
 * exact `auth-runtime.ts` idiom (ADR-0042): the five `/api/messages/...`
 * routes are THIN, and this module builds their injected deps from env,
 * failing closed to null (route → 503 `not_configured`) unless the REAL
 * runtime is fully configured: AUTH_MODE=clerk + REPOSITORY_MODE=postgres +
 * both role-scoped database URLs + a well-formed `FIELD_ENCRYPTION_KEY`
 * (message bodies are ciphertext at rest, ADR-0028). The demo/synthetic
 * runtime never serves persistent messaging.
 *
 * The service composed here is the ADR-0036 authorization gate over the
 * repository — routes never touch `DrizzleMessagingRepository` directly — and
 * its REQUIRED audit sink is the org-scoped `DrizzleAuditEventRepository`,
 * so every sensitive denial writes its distinct internal reason while the
 * external response stays anti-oracle uniform (founder decision 4).
 * Until the Clerk closure is composed (see lib/auth-runtime.ts), the session
 * provider resolves no session and every request answers 401 — fail closed.
 */

/** The messaging route deps for one request, or null → the route answers 503. */
export function composeMessagingDeps(env: NodeJS.ProcessEnv): MessagingRouteDeps | null {
  if (!isMessagingRouteConfigured(env)) return null;
  const cipher = messagingCipherFromEnv(env);
  if (!cipher) return null; // malformed key — fail closed, never a partial runtime
  const tenant = tenantHandle(env.DATABASE_URL ?? "");
  const resolver = resolverHandle(env.AUTH_RESOLVER_DATABASE_URL ?? "");
  return {
    sessionProvider: createSessionProvider(resolver.db),
    messaging: new AuthorizedMessagingService(
      new DrizzleMessagingRepository(tenant.db, cipher),
      new DrizzleAuditEventRepository(tenant.db),
    ),
    now: () => new Date(),
  };
}

/** The uniform fail-closed 503 (identical to the invitation routes'). */
export function notConfiguredResponse(): Response {
  return Response.json(
    { ok: false, error: "not_configured" },
    { status: 503, headers: { "cache-control": "no-store" } },
  );
}

/** Render a service result; decrypted bodies are in play, so always `no-store`. */
export function messagingResponse<TOk>(result: MessagingRouteResult<TOk>): Response {
  return Response.json(result.body, {
    status: result.status,
    headers: { "cache-control": "no-store" },
  });
}

/** Parse a JSON object body, or null (route → 400 `invalid_json`). */
export async function readJsonObject(request: Request): Promise<Record<string, unknown> | null> {
  try {
    const parsed: unknown = await request.json();
    if (typeof parsed !== "object" || parsed === null) return null;
    return parsed as Record<string, unknown>;
  } catch {
    return null;
  }
}

/** The uniform 400 for an unparsable request body (invitation-route idiom). */
export function invalidJsonResponse(): Response {
  return Response.json(
    { ok: false, error: "invalid_json" },
    { status: 400, headers: { "cache-control": "no-store" } },
  );
}
