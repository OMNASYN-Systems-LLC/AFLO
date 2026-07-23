import {
  DemoAuthProvider,
  requireClientSession,
  requireStaffSession,
  type AuthProvider,
  type ClientSession,
  type StaffSession,
} from "@aflo/auth";
import {
  AfloStore,
  isDemoRuntimePermitted,
  MockClientRepository,
  MockDashboardRepository,
  MockPortalRepository,
  SYNTHETIC_NOW,
  syntheticDatabase,
  type ClientRepository,
  type DashboardRepository,
  type PortalRepository,
  type StaffMember,
} from "@aflo/shared";

/**
 * Composition root for the DEMO runtime (ADR-0002 mock-first; ADR-0048
 * explicit opt-in).
 *
 * Pages depend on repository interfaces; workflow mutations go through the
 * AfloStore (rules-gated, event-emitting, audited). Swapping these
 * singletons for Neon-backed implementations is the migration surface
 * (ADR-0002). Store state lives for the server-process lifetime and resets
 * on restart — documented prototype behavior.
 *
 * EXPLICIT OPT-IN (ADR-0048): every exported store/repository/session in this
 * module is gated on `isDemoRuntimePermitted` — synthetic data and demo
 * identities are served ONLY when the process explicitly opted in with
 * `APP_ENV=demo` (or under automated tests). In any other runtime each access
 * throws instead of serving synthetic data; boot enforcement
 * (`instrumentation.ts`) refuses ambiguous configs before a request ever gets
 * here, so this gate is the belt-and-braces layer behind it.
 *
 * The ONE allowance: `next build` prerendering (`NEXT_PHASE=
 * phase-production-build`). The prototype's static shell pages render from
 * synthetic data at build time; SERVING them still requires the boot gate and
 * this request-time gate to pass, so no ambiguous deployment ever answers a
 * request with synthetic data. The demo-runtime REMOVAL slice (B11) deletes
 * this module and the allowance with it.
 *
 * The demo READ clock stays pinned to SYNTHETIC_NOW for deterministic
 * rendering of seed data; MUTATIONS stamp real time so the audit trail and
 * events order correctly.
 */

/** Refuse demo/synthetic access outside the explicit opt-in (ADR-0048). */
function assertDemoRuntime(): void {
  if (isDemoRuntimePermitted(process.env)) return;
  if (process.env.NEXT_PHASE === "phase-production-build") return; // build-time prerender of the prototype shell only
  throw new Error(
    "[aflo] demo runtime refused: this process has not opted into the demo/synthetic runtime " +
      "(APP_ENV=demo) — refusing to serve synthetic data or demo identities (ADR-0048). " +
      "Set APP_ENV=demo for the demo prototype, or complete the real runtime configuration " +
      "(AUTH_MODE=clerk, REPOSITORY_MODE=postgres, and the ADR-0017 integration variables).",
  );
}

/** Wrap an object so every METHOD CALL re-checks the demo-runtime gate. */
function demoGated<T extends object>(target: T): T {
  return new Proxy(target, {
    get(t, prop, receiver) {
      const value = Reflect.get(t, prop, receiver);
      if (typeof value !== "function") return value;
      return (...args: unknown[]) => {
        assertDemoRuntime();
        return (value as (...a: unknown[]) => unknown).apply(t, args);
      };
    },
  });
}

export const DEMO_ORG_ID = syntheticDatabase.organization.id;
export const demoNow: Date = SYNTHETIC_NOW;

// Ungated internals: module composition only. Everything EXPORTED is gated.
const afloStore = new AfloStore(syntheticDatabase);

export const store: AfloStore = demoGated(afloStore);

export const clientRepository: ClientRepository = demoGated(
  new MockClientRepository(afloStore.database()),
);
export const dashboardRepository: DashboardRepository = demoGated(
  new MockDashboardRepository(afloStore.database()),
);
export const portalRepository: PortalRepository = demoGated(
  new MockPortalRepository(afloStore.database()),
);

/** The signed-in staff member the shell impersonates until Clerk lands. */
export const DEMO_STAFF: StaffMember = (() => {
  const owner = syntheticDatabase.staff.find((s) => s.role === "organization_owner");
  if (!owner) throw new Error("synthetic dataset must include an organization owner");
  return owner;
})();

/** The demo client persona the portal shell impersonates until Clerk lands. */
export const DEMO_CLIENT_ID = "c-bell";

/**
 * Session resolution flows through the @aflo/auth boundary (ADR-0006) — the
 * ONLY source of organization and actor identity for reads and mutations.
 * Never accept ids from the browser. The two demo providers are a
 * prototype-only split; the Clerk-backed provider replaces both, and the
 * guards plus every call site stay unchanged. Both resolvers are gated on the
 * explicit demo opt-in (ADR-0048): outside it they throw — a demo identity is
 * never minted in an ambiguous or real runtime.
 */
const staffAuth: AuthProvider = new DemoAuthProvider({
  kind: "staff",
  organizationId: DEMO_ORG_ID,
  staffId: DEMO_STAFF.id,
});
const clientAuth: AuthProvider = new DemoAuthProvider({
  kind: "client",
  organizationId: DEMO_ORG_ID,
  clientId: DEMO_CLIENT_ID,
});

export async function getStaffSession(): Promise<StaffSession> {
  assertDemoRuntime();
  return requireStaffSession(staffAuth);
}

export async function getClientSession(): Promise<ClientSession> {
  assertDemoRuntime();
  return requireClientSession(clientAuth);
}
