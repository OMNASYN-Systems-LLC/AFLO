import { randomUUID } from "node:crypto";
import {
  acceptInvitationByToken,
  DrizzleAuditEventRepository,
  handleAcceptInvitation,
  isDatabaseConfigured,
  isResolverConfigured,
  type AcceptInvitationRouteInput,
} from "@aflo/database";
import { resolveAuthMode, resolveRepositoryMode } from "@aflo/shared";
import {
  createSessionProvider,
  resolverHandle,
  tenantHandle,
  verifiedSessionEmail,
} from "@/lib/auth-runtime";

/**
 * Invitation ACCEPTANCE (Workstream B7, ADR-0042) — a THIN composition over
 * the tested `handleAcceptInvitation` service, which wraps the PGlite-proven
 * `acceptInvitationByToken` core (ADR-0032: resolver-side token lookup,
 * constant-time verification, deterministic kernel, atomic org-scoped claim +
 * membership/client-link write). This file only builds the dependencies from
 * env and FAILS CLOSED (503) unless AUTH_MODE=clerk, REPOSITORY_MODE=postgres,
 * and BOTH connection URLs are configured.
 *
 * The compared email is the SESSION's verified email (`verifiedSessionEmail`,
 * bound to the verified Clerk identity at activation) — never the request
 * body. `invalid_token` and `email_mismatch` answer identically (404) so the
 * route is not a token-validity oracle. Until the Clerk closure is composed
 * (see lib/auth-runtime.ts), the session provider resolves no session and
 * every request answers 401 — acceptance requires signing in first.
 */

export const dynamic = "force-dynamic";
// node:crypto + pg require the Node.js runtime — pinned against config drift.
export const runtime = "nodejs";

export async function POST(request: Request): Promise<Response> {
  const env = process.env;
  const configured =
    resolveAuthMode(env) === "clerk" &&
    resolveRepositoryMode(env) === "postgres" &&
    isDatabaseConfigured(env) &&
    isResolverConfigured(env);
  if (!configured) {
    return Response.json(
      { ok: false, error: "not_configured" },
      { status: 503, headers: { "cache-control": "no-store" } },
    );
  }

  let input: AcceptInvitationRouteInput;
  try {
    const parsed: unknown = await request.json();
    if (typeof parsed !== "object" || parsed === null) throw new Error("not_an_object");
    input = parsed as AcceptInvitationRouteInput;
  } catch {
    return Response.json(
      { ok: false, error: "invalid_json" },
      { status: 400, headers: { "cache-control": "no-store" } },
    );
  }

  const tenant = tenantHandle(env.DATABASE_URL ?? "");
  const resolver = resolverHandle(env.AUTH_RESOLVER_DATABASE_URL ?? "");

  const result = await handleAcceptInvitation(
    {
      sessionProvider: createSessionProvider(resolver.db),
      // Pre-bound to the two role-scoped handles: resolver read → tenant write.
      acceptInvitation: (acceptInput) => acceptInvitationByToken(resolver.db, tenant.db, acceptInput),
      verifiedEmail: verifiedSessionEmail,
      // Matrix §7 row 1 (ADR-0044, closing the ADR-0042 deferral): the created
      // membership/link is audited org-scoped — ids only, never email/token.
      auditSink: new DrizzleAuditEventRepository(tenant.db),
      now: () => new Date(),
      newMembershipId: randomUUID,
    },
    input,
  );
  return Response.json(result.body, { status: result.status, headers: { "cache-control": "no-store" } });
}
