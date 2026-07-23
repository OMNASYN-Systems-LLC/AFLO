import {
  createDemoAuthProvider,
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
 * There is NO build-phase bypass (PR #99 review M1): every page that reads
 * this module is `force-dynamic`, so nothing here executes during
 * `next build` and no synthetic data is ever baked into a build artifact
 * that a non-demo deployment could serve. The demo-runtime REMOVAL slice
 * (B11) deletes this module entirely.
 *
 * The demo READ clock stays pinned to SYNTHETIC_NOW for deterministic
 * rendering of seed data; MUTATIONS stamp real time so the audit trail and
 * events order correctly.
 */

/** Refuse demo/synthetic access outside the explicit opt-in (ADR-0048). */
function assertDemoRuntime(): void {
  if (isDemoRuntimePermitted(process.env)) return;
  throw new Error(
    "[aflo] demo runtime refused: this process has not opted into the demo/synthetic runtime " +
      "(APP_ENV=demo) — refusing to serve synthetic data or demo identities (ADR-0048). " +
      "Set APP_ENV=demo for the demo prototype, or complete the real runtime configuration " +
      "(AUTH_MODE=clerk, REPOSITORY_MODE=postgres, and the ADR-0017 integration variables).",
  );
}

/**
 * Wrap an object so EVERY property access re-checks the demo-runtime gate.
 *
 * A method call is gated at CALL time (so a mere reference read stays cheap and
 * the throw lands where the synthetic work would actually run). A non-function
 * property is gated at READ time: ADR-0052 closes the ADR-0048 review's LOW-2
 * gap, where the previous proxy returned data properties (e.g. an accessor or
 * getter exposing synthetic state) RAW, without the gate — so a synthetic value
 * could be read outside the opt-in without a method call. Now reading any
 * non-function property outside the explicit demo opt-in throws exactly like
 * calling a method does. (No consumer reads a data property off these
 * singletons today — every call site uses a method — so this only strengthens
 * the fail-closed posture; it never changes demo/test behavior.)
 */
function demoGated<T extends object>(target: T): T {
  return new Proxy(target, {
    get(t, prop, receiver) {
      const value = Reflect.get(t, prop, receiver);
      if (typeof value !== "function") {
        // LOW-2 (ADR-0048 review, closed by ADR-0052): data props fail closed too.
        assertDemoRuntime();
        return value;
      }
      return (...args: unknown[]) => {
        assertDemoRuntime();
        return (value as (...a: unknown[]) => unknown).apply(t, args);
      };
    },
  });
}

// Rendered-identity constants (inventory §e). Computed EAGERLY at module load
// from the synthetic dataset; the VALUES themselves are not behind the demo
// gate, but nothing SERVES them outside the opt-in (ADR-0052): (1) they hold
// only synthetic ORG id / STAFF identity / a pinned clock, never client PII
// beyond the dataset already bundled for demo; (2) boot enforcement
// (`instrumentation.ts`) refuses to SERVE any non-opt-in config before this
// module can be reached in a served process; (3) pages pass `DEMO_ORG_ID` /
// `demoNow` only as ARGUMENTS to gated store/repository calls, which throw
// first outside the opt-in, so a real-cell request 500s before rendering any
// synthetic byte; (4) the one component that renders identity DIRECTLY — the
// `(app)` layout shell — now goes through the gated `getDemoShellIdentity()`
// (below), closing the LOW-2 leak where the shell of a real-cell 500 streamed
// synthetic staff identity. Result: the real cell serves ZERO synthetic bytes
// (live-re-verified). Full deletion of these constants is the B11 cutover's
// job — this module is removed whole when Clerk lands (inventory §h).
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
 * Gated shell identity for the `(app)` layout chrome (ADR-0052).
 *
 * Every DATA page renders synthetic values only THROUGH a gated store/repository
 * call, which throws first outside the opt-in — so a real-cell request 500s
 * before any synthetic byte is produced. The `(app)` layout is the exception:
 * it renders staff identity + the read clock DIRECTLY (sidebar name/role, header
 * date), with no preceding gated call, so on origin/main it streamed synthetic
 * identity ("Danielle Mercer", the pinned date) into the shell of a real-cell
 * 500 response (the LOW-2 ungated-constant leak, live-proven). Routing the
 * layout through this accessor makes it fail closed EXACTLY like the pages:
 * outside `APP_ENV=demo` it throws and no synthetic identity is served; under
 * the opt-in it returns the personas unchanged, so demo previews render
 * byte-identically. (B11 deletes this whole module when Clerk lands.)
 */
export function getDemoShellIdentity(): { staff: StaffMember; now: Date } {
  assertDemoRuntime();
  return { staff: DEMO_STAFF, now: demoNow };
}

/**
 * Session resolution flows through the @aflo/auth boundary (ADR-0006) — the
 * ONLY source of organization and actor identity for reads and mutations.
 * Never accept ids from the browser. The two demo providers are a
 * prototype-only split; the Clerk-backed provider replaces both, and the
 * guards plus every call site stay unchanged. Both resolvers are gated on the
 * explicit demo opt-in (ADR-0048): outside it they throw — a demo identity is
 * never minted in an ambiguous or real runtime.
 */
const staffAuth: AuthProvider = createDemoAuthProvider({
  kind: "staff",
  organizationId: DEMO_ORG_ID,
  staffId: DEMO_STAFF.id,
});
const clientAuth: AuthProvider = createDemoAuthProvider({
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
