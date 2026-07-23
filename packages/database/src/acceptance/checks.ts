import { createHash, randomUUID } from "node:crypto";
import { existsSync, readFileSync, readdirSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { getTableColumns, getTableName } from "drizzle-orm";
import { PgTable } from "drizzle-orm/pg-core";
import * as schema from "../schema";
import * as enums from "../enums";
import type { AcceptanceDb } from "./db";
import type { CheckResult } from "./types";

/**
 * Preview acceptance checks (ADR-0050) — each a pure function over an
 * `AcceptanceDb` (or the migrations directory for the filesystem checks),
 * returning ONE structured `CheckResult`. They AGGREGATE the invariants the
 * per-area PGlite proofs already pin (rls-runtime, rls-auth-tables,
 * resolver-grant-matrix, migration/enums lockstep) into a single runnable gate
 * against an ARBITRARY target database — they do not replace those tests.
 *
 * Read-only by design: no check ever issues DDL, and the single check that
 * writes (the fail-closed smoke) does so strictly inside a transaction it
 * ROLLBACKs — safe to point at a live Neon preview branch.
 */

export const ZERO_UUID = "00000000-0000-0000-0000-000000000000";

/** This package's committed migrations directory. */
export function defaultMigrationsDir(): string {
  return join(dirname(fileURLToPath(import.meta.url)), "..", "..", "migrations");
}

interface JournalEntry {
  idx: number;
  tag: string;
  when: number;
}

function readJournal(migrationsDir: string): JournalEntry[] {
  const raw = readFileSync(join(migrationsDir, "meta", "_journal.json"), "utf8");
  const parsed = JSON.parse(raw) as { entries?: JournalEntry[] };
  if (!Array.isArray(parsed.entries)) throw new Error("journal has no entries array");
  return parsed.entries;
}

/** Lowercase + strip all whitespace: deparse-cosmetics-insensitive, content-exact comparison. */
function norm(sql: string): string {
  return sql.toLowerCase().replace(/\s+/g, "");
}

const SAFE_IDENT = /^[a-z_][a-z0-9_]*$/;

/** Quote a list of known-safe identifiers as SQL string literals for an IN (...) list. */
function literalList(names: readonly string[]): string {
  for (const n of names) {
    if (!SAFE_IDENT.test(n)) throw new Error(`unsafe identifier: ${n}`);
  }
  return names.map((n) => `'${n}'`).join(", ");
}

/**
 * The tenant-table set, derived PROGRAMMATICALLY from schema.ts: every pgTable
 * with a NOT NULL `organization_id` column. The NOT NULL discriminator is what
 * separates the org-RLS-scoped tables from `session_revocations`, whose
 * organization_id is an OPTIONAL scope on a user-scoped resolver table
 * (intentionally not org-RLS — ADR-0026/0030).
 */
export function deriveTenantTables(): string[] {
  const names: string[] = [];
  for (const value of Object.values(schema)) {
    if (value instanceof PgTable) {
      const columns = Object.values(getTableColumns(value));
      const org = columns.find((c) => c.name === "organization_id");
      if (org && org.notNull) names.push(getTableName(value));
    }
  }
  return names.sort();
}

/** Every pgEnum declared by the schema (the migration.test.ts iteration pattern). */
export function declaredEnums(): { name: string; values: readonly string[] }[] {
  const out: { name: string; values: readonly string[] }[] = [];
  for (const value of Object.values(enums)) {
    // A drizzle pgEnum is CALLABLE (typeof "function") with enumName/enumValues properties.
    if (
      value &&
      (typeof value === "object" || typeof value === "function") &&
      "enumName" in value &&
      "enumValues" in value
    ) {
      const e = value as unknown as { enumName: unknown; enumValues: readonly string[] };
      if (typeof e.enumName === "string" && Array.isArray(e.enumValues)) {
        out.push({ name: e.enumName, values: e.enumValues });
      }
    }
  }
  return out;
}

// ---------------------------------------------------------------------------
// 1–2. Filesystem checks: journal ↔ directory ↔ snapshot chain
// ---------------------------------------------------------------------------

/** Journal entries are contiguous, tags match the .sql files exactly, snapshots exist 1:1. */
export function checkJournalMatchesDirectory(migrationsDir: string): CheckResult {
  const check = "migrations.journal_matches_directory";
  const problems: string[] = [];
  const entries = readJournal(migrationsDir);
  entries.forEach((entry, i) => {
    if (entry.idx !== i) problems.push(`entry ${i} has idx ${entry.idx} (gap or reorder)`);
    const prefix = String(entry.idx).padStart(4, "0");
    if (!entry.tag.startsWith(`${prefix}_`)) problems.push(`tag ${entry.tag} does not match idx ${entry.idx}`);
  });
  const journalTags = new Set(entries.map((e) => e.tag));
  if (journalTags.size !== entries.length) problems.push("duplicate tags in journal");

  const sqlFiles = readdirSync(migrationsDir).filter((f) => f.endsWith(".sql"));
  for (const f of sqlFiles) {
    if (!journalTags.has(f.replace(/\.sql$/, ""))) problems.push(`migration file ${f} missing from journal`);
  }
  for (const tag of journalTags) {
    if (!sqlFiles.includes(`${tag}.sql`)) problems.push(`journal entry ${tag} has no .sql file`);
  }

  const snapshotFiles = readdirSync(join(migrationsDir, "meta")).filter((f) => /^\d{4}_snapshot\.json$/.test(f));
  for (const entry of entries) {
    const snap = `${String(entry.idx).padStart(4, "0")}_snapshot.json`;
    if (!snapshotFiles.includes(snap)) problems.push(`missing snapshot ${snap}`);
  }
  if (snapshotFiles.length !== entries.length) {
    problems.push(`snapshot count ${snapshotFiles.length} != journal entries ${entries.length}`);
  }

  return {
    check,
    passed: problems.length === 0,
    detail:
      problems.length === 0
        ? `${entries.length} journal entries match ${sqlFiles.length} migration files and ${snapshotFiles.length} snapshots (no extras, no gaps)`
        : problems.join("; "),
  };
}

/** Snapshot chain integrity BY VALUE: each snapshot's prevId === its predecessor's id. */
export function checkSnapshotChain(migrationsDir: string): CheckResult {
  const check = "migrations.snapshot_chain_integrity";
  const problems: string[] = [];
  const entries = readJournal(migrationsDir);
  const snapshots = entries.map((entry) => {
    const file = join(migrationsDir, "meta", `${String(entry.idx).padStart(4, "0")}_snapshot.json`);
    const parsed = JSON.parse(readFileSync(file, "utf8")) as { id?: string; prevId?: string };
    return { idx: entry.idx, id: parsed.id, prevId: parsed.prevId };
  });

  const first = snapshots[0];
  if (!first) return { check, passed: false, detail: "no snapshots found" };
  if (first.prevId !== ZERO_UUID) {
    problems.push(`snapshot 0000 prevId is ${String(first.prevId)}, expected the zero uuid`);
  }
  for (let i = 1; i < snapshots.length; i++) {
    const current = snapshots[i]!;
    const previous = snapshots[i - 1]!;
    if (!current.id || !current.prevId) {
      problems.push(`snapshot ${current.idx} missing id/prevId`);
    } else if (current.prevId !== previous.id) {
      problems.push(
        `snapshot ${String(current.idx).padStart(4, "0")} prevId ${current.prevId} !== snapshot ${String(previous.idx).padStart(4, "0")} id ${String(previous.id)}`,
      );
    }
  }
  const ids = new Set(snapshots.map((s) => s.id));
  if (ids.size !== snapshots.length) problems.push("duplicate snapshot ids");

  return {
    check,
    passed: problems.length === 0,
    detail:
      problems.length === 0
        ? `snapshot chain 0000→${String(snapshots.length - 1).padStart(4, "0")} intact by value (each prevId === predecessor id)`
        : problems.join("; "),
  };
}

// ---------------------------------------------------------------------------
// 3. Migrations applied in journal order (drizzle bookkeeping table)
// ---------------------------------------------------------------------------

/**
 * The target's `drizzle.__drizzle_migrations` rows must correspond 1:1, in
 * order, with the committed journal: same count, `created_at` = the journal
 * `when`, and each `hash` = sha256 of the committed migration file (the exact
 * drizzle migrator algorithm). Proves the database was produced by THESE
 * migrations — not hand-authored DDL.
 */
export async function checkMigrationsApplied(db: AcceptanceDb, migrationsDir: string): Promise<CheckResult> {
  const check = "migrations.applied_in_journal_order";
  const present = await db.query<{ present: boolean }>(
    "SELECT to_regclass('drizzle.__drizzle_migrations') IS NOT NULL AS present",
  );
  if (!present.rows[0]?.present) {
    return {
      check,
      passed: false,
      detail: "drizzle.__drizzle_migrations does not exist — the target was not migrated via the drizzle migrator",
    };
  }

  const entries = readJournal(migrationsDir);
  const expected = entries.map((entry) => {
    const content = readFileSync(join(migrationsDir, `${entry.tag}.sql`), "utf8");
    return { tag: entry.tag, when: entry.when, hash: createHash("sha256").update(content).digest("hex") };
  });

  const applied = await db.query<{ hash: string; created_at: string | number }>(
    "SELECT hash, created_at FROM drizzle.__drizzle_migrations ORDER BY created_at ASC, id ASC",
  );
  const problems: string[] = [];
  if (applied.rows.length !== expected.length) {
    problems.push(`applied ${applied.rows.length} migrations, journal has ${expected.length}`);
  }
  const count = Math.min(applied.rows.length, expected.length);
  for (let i = 0; i < count; i++) {
    const row = applied.rows[i]!;
    const want = expected[i]!;
    if (Number(row.created_at) !== want.when) {
      problems.push(`row ${i}: created_at ${String(row.created_at)} != journal when ${want.when} (${want.tag})`);
    }
    if (row.hash !== want.hash) {
      problems.push(`row ${i}: hash mismatch for ${want.tag} — the applied SQL differs from the committed file`);
    }
  }
  return {
    check,
    passed: problems.length === 0,
    detail:
      problems.length === 0
        ? `${expected.length} migrations applied in journal order with matching content hashes (${expected[0]!.tag} → ${expected[expected.length - 1]!.tag})`
        : problems.join("; "),
  };
}

// ---------------------------------------------------------------------------
// 4. RLS on every tenant table, with the exact fail-closed policy shape
// ---------------------------------------------------------------------------

/**
 * The exact fail-closed org-isolation expression (migration 0003 shape) as
 * Postgres deparses it: unset GUC → NULL, cleared-to-'' GUC → NULL via
 * nullif — either way no row matches instead of erroring.
 */
const EXPECTED_POLICY_EXPR = norm(
  "(organization_id = (NULLIF(current_setting('app.current_org_id'::text, true), ''::text))::uuid)",
);

/** Every derived tenant table has RLS ENABLED + FORCED and exactly the org_isolation policy. */
export async function checkTenantTableRls(db: AcceptanceDb): Promise<CheckResult> {
  const check = "rls.tenant_tables_enforced";
  const tables = deriveTenantTables();
  if (tables.length === 0) {
    return { check, passed: false, detail: "derived zero tenant tables from schema.ts — derivation broken" };
  }
  const inList = literalList(tables);

  const rls = await db.query<{ relname: string; relrowsecurity: boolean; relforcerowsecurity: boolean }>(
    `SELECT c.relname, c.relrowsecurity, c.relforcerowsecurity
       FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
      WHERE n.nspname = 'public' AND c.relkind = 'r' AND c.relname IN (${inList})`,
  );
  const rlsByTable = new Map(rls.rows.map((r) => [r.relname, r]));

  const policies = await db.query<{
    tablename: string;
    policyname: string;
    permissive: string;
    cmd: string;
    qual: string | null;
    with_check: string | null;
  }>(
    `SELECT tablename, policyname, permissive, cmd, qual, with_check
       FROM pg_policies WHERE schemaname = 'public' AND tablename IN (${inList})`,
  );
  const policiesByTable = new Map<string, typeof policies.rows>();
  for (const p of policies.rows) {
    const list = policiesByTable.get(p.tablename) ?? [];
    list.push(p);
    policiesByTable.set(p.tablename, list);
  }

  const problems: string[] = [];
  for (const table of tables) {
    const state = rlsByTable.get(table);
    if (!state) {
      problems.push(`${table}: table missing from target`);
      continue;
    }
    if (!state.relrowsecurity) problems.push(`${table}: RLS not enabled`);
    if (!state.relforcerowsecurity) problems.push(`${table}: RLS not FORCED`);
    const tablePolicies = policiesByTable.get(table) ?? [];
    const org = tablePolicies.find((p) => p.policyname === "org_isolation");
    if (!org) {
      problems.push(`${table}: org_isolation policy missing`);
      continue;
    }
    if (tablePolicies.length !== 1) {
      problems.push(`${table}: expected exactly one policy, found ${tablePolicies.length}`);
    }
    if (org.permissive.toUpperCase() !== "PERMISSIVE") problems.push(`${table}: policy not PERMISSIVE`);
    if (org.cmd.toUpperCase() !== "ALL") problems.push(`${table}: policy cmd ${org.cmd}, expected ALL`);
    if (!org.qual || norm(org.qual) !== EXPECTED_POLICY_EXPR) {
      problems.push(`${table}: USING expression differs from the nullif() fail-closed shape (${String(org.qual)})`);
    }
    if (!org.with_check || norm(org.with_check) !== EXPECTED_POLICY_EXPR) {
      problems.push(`${table}: WITH CHECK expression differs from the nullif() fail-closed shape (${String(org.with_check)})`);
    }
  }

  // ABSENCE CHECK (review M3a): enumerate the WHOLE public schema for any table
  // carrying rowsecurity OR a policy, and assert that set EQUALS the derived
  // tenant set. An UNEXPECTED RLS table (RLS mistakenly enabled on a global /
  // resolver-path table like `users`, which would silently break the resolver
  // path) OR a MISSING one both fail — the derived set is the whole truth.
  const rlsUniverse = await db.query<{ relname: string }>(
    `SELECT DISTINCT c.relname
       FROM pg_class c
       JOIN pg_namespace n ON n.oid = c.relnamespace
      WHERE n.nspname = 'public' AND c.relkind = 'r'
        AND (c.relrowsecurity OR EXISTS (
          SELECT 1 FROM pg_policy p WHERE p.polrelid = c.oid
        ))`,
  );
  const actualRlsTables = new Set(rlsUniverse.rows.map((r) => r.relname));
  const expectedRlsTables = new Set(tables);
  for (const t of actualRlsTables) {
    if (!expectedRlsTables.has(t)) {
      problems.push(`${t}: has RLS/policies but is NOT a derived tenant table (unexpected — a global/resolver table must not carry RLS)`);
    }
  }
  for (const t of expectedRlsTables) {
    if (!actualRlsTables.has(t)) {
      problems.push(`${t}: is a derived tenant table but carries NO RLS/policy in the target`);
    }
  }

  return {
    check,
    passed: problems.length === 0,
    detail:
      problems.length === 0
        ? `${tables.length}/${tables.length} tenant tables (derived from schema.ts) have RLS enabled + forced with the exact nullif() org_isolation policy, and the target's RLS-table set EQUALS the derived set exactly (no unexpected or missing RLS tables)`
        : problems.join("; "),
  };
}

// ---------------------------------------------------------------------------
// 5–6. Role posture
// ---------------------------------------------------------------------------

/** aflo_app exists and is a plain role: NOT superuser, NOT BYPASSRLS (RLS actually binds it). */
export async function checkTenantRolePosture(db: AcceptanceDb): Promise<CheckResult> {
  const check = "roles.tenant_role_posture";
  const res = await db.query<{ rolsuper: boolean; rolbypassrls: boolean }>(
    "SELECT rolsuper, rolbypassrls FROM pg_roles WHERE rolname = 'aflo_app'",
  );
  const row = res.rows[0];
  if (!row) return { check, passed: false, detail: "role aflo_app does not exist (runbook §2 provisioning missing)" };
  const problems: string[] = [];
  if (row.rolsuper) problems.push("aflo_app is SUPERUSER");
  if (row.rolbypassrls) problems.push("aflo_app has BYPASSRLS — RLS would not bind the tenant path");
  return {
    check,
    passed: problems.length === 0,
    detail: problems.length === 0 ? "aflo_app exists, non-superuser, non-BYPASSRLS" : problems.join("; "),
  };
}

/** aflo_auth_resolver exists with BYPASSRLS (the privileged resolver identity, ADR-0030). */
export async function checkResolverRolePosture(db: AcceptanceDb): Promise<CheckResult> {
  const check = "roles.resolver_role_posture";
  const res = await db.query<{ rolsuper: boolean; rolbypassrls: boolean }>(
    "SELECT rolsuper, rolbypassrls FROM pg_roles WHERE rolname = 'aflo_auth_resolver'",
  );
  const row = res.rows[0];
  if (!row) {
    return { check, passed: false, detail: "role aflo_auth_resolver does not exist (runbook §2 provisioning missing)" };
  }
  const problems: string[] = [];
  if (!row.rolbypassrls) problems.push("aflo_auth_resolver lacks BYPASSRLS — the resolver path would see zero rows");
  if (row.rolsuper) problems.push("aflo_auth_resolver is SUPERUSER (least privilege violated)");
  return {
    check,
    passed: problems.length === 0,
    detail: problems.length === 0 ? "aflo_auth_resolver exists with BYPASSRLS, non-superuser" : problems.join("; "),
  };
}

// ---------------------------------------------------------------------------
// 7–9. Grant matrix spot checks (runbook §2 + migrations 0007/0008)
// ---------------------------------------------------------------------------

const RESOLVER_ONLY_TABLES = ["identity_provider_accounts", "provider_webhook_events", "session_revocations"] as const;
/** Read-only principal-resolution grants from migration 0008. */
const RESOLVER_PRINCIPAL_TABLES = ["users", "organization_members", "client_user_links"] as const;

async function tablePrivilege(db: AcceptanceDb, role: string, table: string, privilege: string): Promise<boolean> {
  const res = await db.query<{ ok: boolean }>("SELECT has_table_privilege($1, $2, $3) AS ok", [
    role,
    `public.${table}`,
    privilege,
  ]);
  return res.rows[0]?.ok === true;
}

const ALL_PRIVILEGES = ["SELECT", "INSERT", "UPDATE", "DELETE"] as const;

/**
 * The EXACT resolver grant whitelist (migrations 0007/0008): table → the
 * privileges the resolver is allowed to hold on it. The absence check asserts
 * the resolver holds NOTHING beyond this — a manual `GRANT … TO
 * aflo_auth_resolver` on a tenant table (which BYPASSRLS would make a
 * cross-tenant reader) flips the check.
 */
const RESOLVER_GRANT_WHITELIST: Record<string, readonly string[]> = {
  identity_provider_accounts: ALL_PRIVILEGES,
  provider_webhook_events: ALL_PRIVILEGES,
  session_revocations: ALL_PRIVILEGES,
  invitations: ["SELECT"],
  users: ["SELECT"],
  organization_members: ["SELECT"],
  client_user_links: ["SELECT"],
};

/** Every public base table (for the whole-schema no-excess-grant enumeration). */
async function publicBaseTables(db: AcceptanceDb): Promise<string[]> {
  const res = await db.query<{ relname: string }>(
    `SELECT c.relname FROM pg_class c
       JOIN pg_namespace n ON n.oid = c.relnamespace
      WHERE n.nspname = 'public' AND c.relkind = 'r'`,
  );
  return res.rows.map((r) => r.relname).filter((n) => n !== "__drizzle_migrations");
}

/**
 * The resolver role holds EXACTLY the read/write paths migrations 0007/0008
 * grant it — the required grants are present (M spot-checks) AND, enumerating
 * the whole public schema, NO grant exists beyond the whitelist (review M3b).
 */
export async function checkResolverReadPaths(db: AcceptanceDb): Promise<CheckResult> {
  const check = "grants.resolver_read_paths";
  const problems: string[] = [];

  // Required grants present.
  for (const table of RESOLVER_ONLY_TABLES) {
    for (const privilege of ALL_PRIVILEGES) {
      if (!(await tablePrivilege(db, "aflo_auth_resolver", table, privilege))) {
        problems.push(`resolver missing ${privilege} on ${table} (migration 0007)`);
      }
    }
  }
  if (!(await tablePrivilege(db, "aflo_auth_resolver", "invitations", "SELECT"))) {
    problems.push("resolver missing SELECT on invitations (migration 0007)");
  }
  for (const table of RESOLVER_PRINCIPAL_TABLES) {
    if (!(await tablePrivilege(db, "aflo_auth_resolver", table, "SELECT"))) {
      problems.push(`resolver missing SELECT on ${table} (migration 0008)`);
    }
  }

  // ABSENCE CHECK: no grant anywhere beyond the whitelist.
  for (const table of await publicBaseTables(db)) {
    const allowed = RESOLVER_GRANT_WHITELIST[table] ?? [];
    for (const privilege of ALL_PRIVILEGES) {
      const held = await tablePrivilege(db, "aflo_auth_resolver", table, privilege);
      if (held && !allowed.includes(privilege)) {
        problems.push(
          `resolver holds ${privilege} on ${table} — OUTSIDE the whitelist (a BYPASSRLS role must never hold a grant beyond migrations 0007/0008)`,
        );
      }
    }
  }

  return {
    check,
    passed: problems.length === 0,
    detail:
      problems.length === 0
        ? "resolver holds read/write on the three un-scoped tables, SELECT on invitations + the three principal tables, and NOTHING beyond that whitelist (whole-schema enumeration)"
        : problems.join("; "),
  };
}

/** The tenant role holds NO privilege on the resolver-only tables and cannot execute the resolver function. */
export async function checkTenantRoleWalledOff(db: AcceptanceDb): Promise<CheckResult> {
  const check = "grants.tenant_role_walled_off";
  const problems: string[] = [];
  for (const table of RESOLVER_ONLY_TABLES) {
    for (const privilege of ["SELECT", "INSERT", "UPDATE", "DELETE"]) {
      if (await tablePrivilege(db, "aflo_app", table, privilege)) {
        problems.push(`aflo_app holds ${privilege} on resolver-only table ${table} (0007 REVOKE not in effect)`);
      }
    }
  }
  try {
    const fn = await db.query<{ ok: boolean }>(
      "SELECT has_function_privilege('aflo_app', 'find_invitation_by_token(varchar)', 'EXECUTE') AS ok",
    );
    if (fn.rows[0]?.ok === true) {
      problems.push("aflo_app can EXECUTE find_invitation_by_token — a cross-tenant read path");
    }
  } catch (err) {
    problems.push(`find_invitation_by_token privilege probe failed: ${(err as Error).message}`);
  }
  return {
    check,
    passed: problems.length === 0,
    detail:
      problems.length === 0
        ? "aflo_app holds no privilege on the three resolver-only tables and cannot execute the resolver function"
        : problems.join("; "),
  };
}

/** The tenant role can still write the audit trail (INSERT on audit_events). */
export async function checkTenantAuditInsert(db: AcceptanceDb): Promise<CheckResult> {
  const check = "grants.tenant_audit_insert";
  const ok = await tablePrivilege(db, "aflo_app", "audit_events", "INSERT");
  return {
    check,
    passed: ok,
    detail: ok
      ? "aflo_app holds INSERT on audit_events (audited state changes stay writable)"
      : "aflo_app missing INSERT on audit_events — audited state changes would fail",
  };
}

// ---------------------------------------------------------------------------
// 10. Resolver function posture
// ---------------------------------------------------------------------------

/** find_invitation_by_token exists, SECURITY DEFINER, owned by the resolver role, empty pinned search_path. */
export async function checkResolverFunction(db: AcceptanceDb): Promise<CheckResult> {
  const check = "function.find_invitation_by_token";
  const res = await db.query<{ prosecdef: boolean; owner: string; proconfig: string[] | null }>(
    `SELECT p.prosecdef, r.rolname AS owner, p.proconfig
       FROM pg_proc p
       JOIN pg_roles r ON r.oid = p.proowner
       JOIN pg_namespace n ON n.oid = p.pronamespace
      WHERE n.nspname = 'public' AND p.proname = 'find_invitation_by_token'`,
  );
  const row = res.rows[0];
  if (!row) return { check, passed: false, detail: "find_invitation_by_token does not exist (migration 0007)" };
  const problems: string[] = [];
  if (res.rows.length !== 1) problems.push(`expected one overload, found ${res.rows.length}`);
  if (!row.prosecdef) problems.push("not SECURITY DEFINER");
  if (row.owner !== "aflo_auth_resolver") {
    problems.push(`owned by ${row.owner}, expected aflo_auth_resolver (BYPASSRLS owner is what lifts RLS)`);
  }
  const searchPath = (row.proconfig ?? []).find((c) => c.startsWith("search_path="));
  if (searchPath === undefined) {
    problems.push("search_path not pinned (SECURITY DEFINER hardening missing)");
  } else {
    const value = searchPath.slice("search_path=".length).replaceAll('"', "").trim();
    if (value !== "") problems.push(`search_path pinned to '${value}', expected empty`);
  }
  const resolverCanExecute = await db.query<{ ok: boolean }>(
    "SELECT has_function_privilege('aflo_auth_resolver', 'find_invitation_by_token(varchar)', 'EXECUTE') AS ok",
  );
  if (resolverCanExecute.rows[0]?.ok !== true) problems.push("aflo_auth_resolver cannot EXECUTE it");
  return {
    check,
    passed: problems.length === 0,
    detail:
      problems.length === 0
        ? "SECURITY DEFINER, owned by aflo_auth_resolver, empty pinned search_path, resolver-executable"
        : problems.join("; "),
  };
}

// ---------------------------------------------------------------------------
// 11. Key constraint / index definitions (exact)
// ---------------------------------------------------------------------------

/** Expected index definitions, normalized (lowercase, whitespace-stripped) against pg_get_indexdef output. */
const EXPECTED_INDEXES: Record<string, string> = {
  // Founder decision 2026-07-23 #3 verbatim tuple (migration 0010): one OPEN review per
  // org-scoped (artifact_type, artifact_id, artifact_version, workflow_type).
  uq_review_items_open: norm(
    `CREATE UNIQUE INDEX uq_review_items_open ON public.review_items USING btree
     (organization_id, artifact_type, artifact_id, artifact_version, workflow_type)
     WHERE (state = ANY (ARRAY['draft'::review_item_state, 'awaiting_review'::review_item_state]))`,
  ),
  uq_playbook_versions_playbook_version: norm(
    "CREATE UNIQUE INDEX uq_playbook_versions_playbook_version ON public.playbook_versions USING btree (playbook_id, version)",
  ),
  uq_playbooks_org_key: norm(
    "CREATE UNIQUE INDEX uq_playbooks_org_key ON public.playbooks USING btree (organization_id, playbook_key)",
  ),
  // At most one PENDING invitation per (org, email) — migration 0005.
  uq_invitations_pending_email: norm(
    `CREATE UNIQUE INDEX uq_invitations_pending_email ON public.invitations USING btree
     (organization_id, email) WHERE (status = 'pending'::invitation_status)`,
  ),
};

/** The load-bearing unique indexes exist with exactly the expected definitions. */
export async function checkKeyIndexes(db: AcceptanceDb): Promise<CheckResult> {
  const check = "constraints.key_indexes";
  const names = Object.keys(EXPECTED_INDEXES);
  const res = await db.query<{ indexname: string; indexdef: string }>(
    `SELECT indexname, indexdef FROM pg_indexes WHERE schemaname = 'public' AND indexname IN (${literalList(names)})`,
  );
  const byName = new Map(res.rows.map((r) => [r.indexname, r.indexdef]));
  const problems: string[] = [];
  for (const name of names) {
    const actual = byName.get(name);
    if (!actual) {
      problems.push(`${name}: missing`);
      continue;
    }
    if (norm(actual) !== EXPECTED_INDEXES[name]) {
      problems.push(`${name}: definition differs — actual: ${actual}`);
    }
  }
  return {
    check,
    passed: problems.length === 0,
    detail:
      problems.length === 0
        ? `${names.length}/${names.length} key unique indexes present with exact definitions (${names.join(", ")})`
        : problems.join("; "),
  };
}

// ---------------------------------------------------------------------------
// 12. Enum lockstep
// ---------------------------------------------------------------------------

/**
 * Every pgEnum the schema declares exists in the target with EXACTLY the same
 * labels in the same order. Because the kernel-owned enums are BUILT from the
 * @aflo/rules / @aflo/ai / sibling-package constant arrays (enums.ts), this
 * transitively locksteps the database against the kernel vocabularies.
 */
export async function checkEnumLockstep(db: AcceptanceDb): Promise<CheckResult> {
  const check = "enums.lockstep_with_schema";
  const declared = declaredEnums();
  if (declared.length === 0) return { check, passed: false, detail: "no declared enums found — derivation broken" };
  const res = await db.query<{ typname: string; labels: string[] }>(
    `SELECT t.typname, array_agg(e.enumlabel ORDER BY e.enumsortorder) AS labels
       FROM pg_type t
       JOIN pg_enum e ON e.enumtypid = t.oid
       JOIN pg_namespace n ON n.oid = t.typnamespace
      WHERE n.nspname = 'public'
      GROUP BY t.typname`,
  );
  const actual = new Map(res.rows.map((r) => [r.typname, r.labels]));
  const problems: string[] = [];
  for (const declaration of declared) {
    const labels = actual.get(declaration.name);
    if (!labels) {
      problems.push(`${declaration.name}: enum type missing from target`);
      continue;
    }
    const expected = JSON.stringify([...declaration.values]);
    const got = JSON.stringify(labels);
    if (expected !== got) problems.push(`${declaration.name}: values ${got} != declared ${expected}`);
  }
  return {
    check,
    passed: problems.length === 0,
    detail:
      problems.length === 0
        ? `${declared.length}/${declared.length} declared enums match the target's labels exactly (order included)`
        : problems.join("; "),
  };
}

// ---------------------------------------------------------------------------
// 13. Fail-closed smoke (runtime proof under the tenant role)
// ---------------------------------------------------------------------------

/**
 * With NO org context, a tenant-role SELECT on a tenant table returns ZERO
 * rows. Runs entirely inside transactions that ROLLBACK (the seeded row never
 * persists), so it is safe against a live preview branch. Requires the
 * connecting role to be able to `SET ROLE aflo_app` (grant the acceptance role
 * membership: `GRANT aflo_app TO <acceptance role>`).
 */
export async function checkFailClosedSmoke(db: AcceptanceDb): Promise<CheckResult> {
  const check = "smoke.fail_closed_no_org_context";
  return db.withSession(async (session) => {
    // Part 1 — unset GUC: fresh transaction, tenant role, no org context at all.
    // ROLLBACK ALWAYS runs (L3: try/finally) so a failed assertion or thrown
    // query can never leave an open transaction on a live target.
    try {
      let unsetCount: number;
      try {
        await session.query("BEGIN");
        await session.query("SET LOCAL ROLE aflo_app");
        const unset = await session.query<{ n: number | string }>("SELECT count(*) AS n FROM clients");
        unsetCount = Number(unset.rows[0]?.n);
      } finally {
        await session.query("ROLLBACK").catch(() => undefined);
      }
      if (unsetCount !== 0) {
        return {
          check,
          passed: false,
          detail: `tenant role saw ${unsetCount} clients rows with NO org context — RLS is not failing closed`,
        };
      }
    } catch (err) {
      return {
        check,
        passed: false,
        detail: `could not run the unset-context probe (is the acceptance role granted membership in aflo_app?): ${(err as Error).message}`,
      };
    }

    // Part 2 — seeded, cleared-to-'' GUC (the nullif hardening): the row is
    // provably present in the transaction, then invisible to the tenant role.
    const orgId = randomUUID();
    try {
      let clearedCount: number;
      try {
        await session.query("BEGIN");
        await session.query("SELECT set_config('app.current_org_id', $1, true)", [orgId]);
        await session.query("INSERT INTO organizations (id, name, slug) VALUES ($1, 'acceptance-smoke', $2)", [
          orgId,
          `acceptance-smoke-${orgId.slice(0, 8)}`,
        ]);
        await session.query(
          "INSERT INTO clients (organization_id, pipeline_stage_id, first_name, last_name) VALUES ($1, 'stage-new', 'Smoke', 'Probe')",
          [orgId],
        );
        const visible = await session.query<{ n: number | string }>(
          "SELECT count(*) AS n FROM clients WHERE organization_id = $1",
          [orgId],
        );
        if (Number(visible.rows[0]?.n) !== 1) throw new Error("seed row not visible inside its own org context");
        // Clear the org context to the hardened '' state, then become the tenant role.
        await session.query("SELECT set_config('app.current_org_id', '', true)");
        await session.query("SET LOCAL ROLE aflo_app");
        const cleared = await session.query<{ n: number | string }>("SELECT count(*) AS n FROM clients");
        clearedCount = Number(cleared.rows[0]?.n);
      } finally {
        // The seed row (and everything else) is discarded — nothing persists on
        // a live target, whatever happened above.
        await session.query("ROLLBACK").catch(() => undefined);
      }
      if (clearedCount !== 0) {
        return {
          check,
          passed: false,
          detail: `tenant role saw ${clearedCount} clients rows with the org context cleared to '' — the nullif hardening is not in effect`,
        };
      }
    } catch (err) {
      return {
        check,
        passed: false,
        detail: `fail-closed smoke errored (seed + cleared-context probe, transaction rolled back): ${(err as Error).message}`,
      };
    }

    return {
      check,
      passed: true,
      detail:
        "tenant role sees zero tenant rows with no org context (unset AND cleared-to-''), including a row seeded in the same rolled-back transaction",
    };
  });
}

/** True when the migrations directory exists (guards a bad --migrations override). */
export function migrationsDirExists(migrationsDir: string): boolean {
  return existsSync(join(migrationsDir, "meta", "_journal.json"));
}
