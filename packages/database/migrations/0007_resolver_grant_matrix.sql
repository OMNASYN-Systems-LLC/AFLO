-- Auth-resolver privilege boundary (ADR-0026 / ADR-0030) — makes the compensating
-- control for the three UN-scoped auth tables real and testable.
--
-- identity_provider_accounts, provider_webhook_events, and session_revocations
-- carry no org-RLS (the resolver reads them BEFORE/ACROSS an org context), so a
-- single tenant-request role could otherwise read them table-wide with no
-- backstop. This migration:
--   1. Adds a SECURITY DEFINER accept-by-token lookup, so the invitation whose
--      globally-unique token digest is presented can be resolved WITHOUT an org
--      context (invitations is FORCE-RLS, so a plain read pre-org sees nothing).
--      When owned by the BYPASSRLS resolver role it reads across orgs; EXECUTE is
--      revoked from PUBLIC so only the resolver identity can call it.
--   2. Applies a grant matrix that REVOKEs the three un-scoped tables from the
--      tenant-request role, so only the distinct resolver connection reaches them.
--
-- Roles are provisioned by the deploy pipeline (Neon), NOT created here:
--   * aflo_app             — tenant-request role (ADR-0025 runtime role), NON-BYPASSRLS.
--   * aflo_auth_resolver   — privileged resolver identity, BYPASSRLS so its
--                            SECURITY DEFINER function may read across orgs. The
--                            deploy role that runs migrations must be a member of
--                            it (to reassign the function's owner).
-- The role-specific statements are guarded on role existence, so on a database
-- where the roles are not (yet) provisioned this migration is a safe no-op for
-- those statements rather than an error.

CREATE OR REPLACE FUNCTION find_invitation_by_token(p_token_digest varchar)
RETURNS SETOF invitations
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT * FROM invitations WHERE token_digest = p_token_digest;
$$;
--> statement-breakpoint
-- No ambient caller may execute the resolver lookup or read the un-scoped tables.
REVOKE ALL ON FUNCTION find_invitation_by_token(varchar) FROM PUBLIC;
--> statement-breakpoint
REVOKE ALL ON TABLE identity_provider_accounts, provider_webhook_events, session_revocations FROM PUBLIC;
--> statement-breakpoint
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'aflo_auth_resolver') THEN
    -- The resolver role OWNS the SECURITY DEFINER function (so it runs BYPASSRLS)
    -- and is the sole reader/writer of the un-scoped resolver tables.
    ALTER FUNCTION find_invitation_by_token(varchar) OWNER TO aflo_auth_resolver;
    GRANT EXECUTE ON FUNCTION find_invitation_by_token(varchar) TO aflo_auth_resolver;
    GRANT SELECT, INSERT, UPDATE, DELETE ON identity_provider_accounts, provider_webhook_events, session_revocations TO aflo_auth_resolver;
    -- The SECURITY DEFINER function runs as this role and reads invitations
    -- (BYPASSRLS lifts RLS, but the table privilege is still required).
    GRANT SELECT ON invitations TO aflo_auth_resolver;
  END IF;

  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'aflo_app') THEN
    -- The tenant-request role must NOT reach the un-scoped tables directly (no
    -- org-RLS backstop) and cannot resolve an invitation by token — that is the
    -- resolver connection's job only.
    REVOKE ALL ON identity_provider_accounts, provider_webhook_events, session_revocations FROM aflo_app;
  END IF;
END $$;
