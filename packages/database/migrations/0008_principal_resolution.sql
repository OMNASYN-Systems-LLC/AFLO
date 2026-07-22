-- Principal resolution for the provider-backed session adapter (ADR-0035/0037).
--
-- Resolving "who is this verified Clerk identity to ΛFLO?" happens BEFORE any
-- org context exists — the org is discovered FROM the membership/client link,
-- exactly like accept-by-token (ADR-0032). So the PrincipalDirectory runs on
-- the RESOLVER connection and needs read access to the three principal tables.
--
--   1. `users` gains `sessions_invalidated_before` — the account's
--      session-revocation cutoff (ADR-0024): a session issued before this
--      instant no longer resolves. NULL = nothing revoked. Additive, nullable,
--      no backfill needed.
--   2. The resolver role gains SELECT (read-only — the directory never writes)
--      on users, organization_members, and client_user_links. The resolver is
--      BYPASSRLS, so SELECT suffices for the cross-org pre-context reads; the
--      tenant role's access to these tables is unchanged (`users` is a global
--      NO-RLS table; `organization_members` and `client_user_links` are the
--      RLS-FORCED org-scoped ones, so the tenant role still sees only the
--      current org's rows there — migrations 0003/0005).
--
-- Role statements are guarded on role existence (0007 discipline): a safe
-- no-op where the roles are not provisioned.

ALTER TABLE "users" ADD COLUMN IF NOT EXISTS "sessions_invalidated_before" timestamp with time zone;
--> statement-breakpoint
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'aflo_auth_resolver') THEN
    -- Read-only principal resolution: identity mapping is already granted (0007);
    -- these are the ΛFLO-side records buildSessionContext derives from.
    GRANT SELECT ON users, organization_members, client_user_links TO aflo_auth_resolver;
  END IF;
END
$$;
