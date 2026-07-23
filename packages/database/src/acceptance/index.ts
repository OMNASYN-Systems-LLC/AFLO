/**
 * Preview acceptance suite (ADR-0050) — public surface.
 *
 * NOT re-exported from the package root index: `bootstrap.ts` imports the
 * dev-only PGlite driver and the suite is operational tooling, not runtime
 * code. Import from `@aflo/database/src/acceptance` in tests/tooling only.
 * (`bootstrap` and `cli` are intentionally excluded here too — import
 * `./bootstrap` directly where the PGlite devDependency is acceptable.)
 */
export * from "./types";
export * from "./db";
export * from "./guard";
export * from "./runner";
export {
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
  declaredEnums,
  defaultMigrationsDir,
  deriveTenantTables,
  migrationsDirExists,
  ZERO_UUID,
} from "./checks";
