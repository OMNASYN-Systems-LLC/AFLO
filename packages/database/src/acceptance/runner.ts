import type { AcceptanceDb } from "./db";
import type { AcceptanceOptions, AcceptanceReport, CheckResult } from "./types";
import {
  checkEnumLockstep,
  checkFailClosedSmoke,
  checkJournalMatchesDirectory,
  checkKeyIndexes,
  checkMigrationsApplied,
  checkResolverFunction,
  checkResolverReadPaths,
  checkResolverRolePosture,
  checkSnapshotChain,
  checkTenantAuditInsert,
  checkTenantRolePosture,
  checkTenantRoleWalledOff,
  checkTenantTableRls,
  defaultMigrationsDir,
  migrationsDirExists,
} from "./checks";

/**
 * The acceptance runner (ADR-0050): executes every check against the given
 * target and aggregates a structured report. A check that THROWS is converted
 * into a failed result — the suite always completes and always reports.
 *
 * The runner itself never issues DDL; applying migrations to a target is the
 * caller's decision (the CLI gates remote DDL behind ACCEPTANCE_APPLY_MIGRATIONS).
 */

/** The complete, ordered check list (ids). Pinned by the vitest wrapper. */
export const ACCEPTANCE_CHECK_IDS = [
  "migrations.journal_matches_directory",
  "migrations.snapshot_chain_integrity",
  "migrations.applied_in_journal_order",
  "rls.tenant_tables_enforced",
  "roles.tenant_role_posture",
  "roles.resolver_role_posture",
  "grants.resolver_read_paths",
  "grants.tenant_role_walled_off",
  "grants.tenant_audit_insert",
  "function.find_invitation_by_token",
  "constraints.key_indexes",
  "enums.lockstep_with_schema",
  "smoke.fail_closed_no_org_context",
] as const;

async function guardedRun(check: string, run: () => Promise<CheckResult> | CheckResult): Promise<CheckResult> {
  try {
    return await run();
  } catch (err) {
    return { check, passed: false, detail: `check threw: ${(err as Error).message}` };
  }
}

export async function runAcceptance(db: AcceptanceDb, opts: AcceptanceOptions = {}): Promise<AcceptanceReport> {
  const startedAt = new Date().toISOString();
  const migrationsDir = opts.migrationsDir ?? defaultMigrationsDir();
  const target = opts.target ?? "pglite";

  if (!migrationsDirExists(migrationsDir)) {
    const finishedAt = new Date().toISOString();
    return {
      target,
      passed: false,
      startedAt,
      finishedAt,
      results: [
        {
          check: "migrations.journal_matches_directory",
          passed: false,
          detail: `migrations directory not found at ${migrationsDir}`,
        },
      ],
    };
  }

  const results: CheckResult[] = [];
  results.push(await guardedRun("migrations.journal_matches_directory", () => checkJournalMatchesDirectory(migrationsDir)));
  results.push(await guardedRun("migrations.snapshot_chain_integrity", () => checkSnapshotChain(migrationsDir)));
  results.push(await guardedRun("migrations.applied_in_journal_order", () => checkMigrationsApplied(db, migrationsDir)));
  results.push(await guardedRun("rls.tenant_tables_enforced", () => checkTenantTableRls(db)));
  results.push(await guardedRun("roles.tenant_role_posture", () => checkTenantRolePosture(db)));
  results.push(await guardedRun("roles.resolver_role_posture", () => checkResolverRolePosture(db)));
  results.push(await guardedRun("grants.resolver_read_paths", () => checkResolverReadPaths(db)));
  results.push(await guardedRun("grants.tenant_role_walled_off", () => checkTenantRoleWalledOff(db)));
  results.push(await guardedRun("grants.tenant_audit_insert", () => checkTenantAuditInsert(db)));
  results.push(await guardedRun("function.find_invitation_by_token", () => checkResolverFunction(db)));
  results.push(await guardedRun("constraints.key_indexes", () => checkKeyIndexes(db)));
  results.push(await guardedRun("enums.lockstep_with_schema", () => checkEnumLockstep(db)));
  results.push(await guardedRun("smoke.fail_closed_no_org_context", () => checkFailClosedSmoke(db)));

  const finishedAt = new Date().toISOString();
  return {
    target,
    passed: results.every((r) => r.passed),
    results,
    startedAt,
    finishedAt,
  };
}
