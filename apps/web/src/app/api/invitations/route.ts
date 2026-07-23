import { randomUUID } from "node:crypto";
import { generateInvitationToken } from "@aflo/auth/invitation-token";
import {
  DrizzleInvitationRepository,
  handleIssueInvitation,
  isDatabaseConfigured,
  isResolverConfigured,
  type IssueInvitationRouteInput,
} from "@aflo/database";
import { resolveAuthMode, resolveRepositoryMode } from "@aflo/shared";
import { createSessionProvider, resolverHandle, tenantHandle } from "@/lib/auth-runtime";

/**
 * Invitation ISSUANCE (Workstream B6, ADR-0042) — a THIN composition over the
 * tested `handleIssueInvitation` service. All logic (owner-only authorization
 * via the engine, kernel validation, digest-only persistence, raw-token-once)
 * lives in @aflo/database/services; this file only builds the dependencies
 * from env and FAILS CLOSED (503, nothing issued) unless the real runtime is
 * fully configured:
 *
 *   - AUTH_MODE=clerk and REPOSITORY_MODE=postgres (the demo/synthetic runtime
 *     NEVER mints real invitations),
 *   - the tenant connection configured (DATABASE_URL — the invitation row is
 *     org-scoped, RLS-enforced),
 *   - the resolver connection configured (AUTH_RESOLVER_DATABASE_URL — the
 *     session provider's principal resolution runs there).
 *
 * The 201 response carries the RAW invitation token — its only appearance,
 * ever (never persisted, never logged) — so the response is `no-store`.
 * Until the Clerk closure is composed (see lib/auth-runtime.ts), the session
 * provider resolves no session and every request answers 401.
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

  let input: IssueInvitationRouteInput;
  try {
    const parsed: unknown = await request.json();
    if (typeof parsed !== "object" || parsed === null) throw new Error("not_an_object");
    input = parsed as IssueInvitationRouteInput;
  } catch {
    return Response.json(
      { ok: false, error: "invalid_json" },
      { status: 400, headers: { "cache-control": "no-store" } },
    );
  }

  const tenant = tenantHandle(env.DATABASE_URL ?? "");
  const resolver = resolverHandle(env.AUTH_RESOLVER_DATABASE_URL ?? "");

  const result = await handleIssueInvitation(
    {
      sessionProvider: createSessionProvider(resolver.db),
      invitations: new DrizzleInvitationRepository(tenant.db),
      now: () => new Date(),
      newId: randomUUID,
      generateToken: generateInvitationToken,
    },
    input,
  );
  return Response.json(result.body, { status: result.status, headers: { "cache-control": "no-store" } });
}
