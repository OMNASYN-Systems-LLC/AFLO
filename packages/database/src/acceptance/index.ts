/**
 * Preview acceptance suite (ADR-0050) — public surface.
 *
 * NOT re-exported from the package root index: this module and `bootstrap.ts`
 * import dev/operational-only drivers (PGlite, a live pg Pool) and the suite is
 * operational tooling, not runtime code. Import from
 * `@aflo/database/src/acceptance` in tests/tooling only. (`bootstrap` and `cli`
 * are intentionally excluded here too — import `./bootstrap` directly where the
 * PGlite devDependency is acceptable.)
 *
 * REMOTE-HANDLE INVARIANT (review M1): the ONLY exported way to obtain a remote
 * `AcceptanceDb` is `connectRemoteAcceptanceDb` (from `./remote`), which runs the
 * guard INSIDE the factory. `acceptanceDbFromPgPool` is deliberately NOT exported
 * — a caller cannot construct a guard-free remote handle from the package surface.
 */
export * from "./types";
export * from "./guard";
export * from "./runner";
export { connectRemoteAcceptanceDb, type RemoteConnectResult } from "./remote";
// Public db surface: the handle interface + the PGlite adapter ONLY. The pool
// adapter (acceptanceDbFromPgPool) stays internal to ./remote.
export {
  acceptanceDbFromPGlite,
  type AcceptanceDb,
  type QueryResultLike,
  type PGliteLike,
} from "./db";
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
