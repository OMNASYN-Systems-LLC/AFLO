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
 * Composition root for the prototype phase.
 *
 * Pages depend on repository interfaces; workflow mutations go through the
 * AfloStore (rules-gated, event-emitting, audited). Swapping these
 * singletons for Neon-backed implementations is the migration surface
 * (ADR-0002). Store state lives for the server-process lifetime and resets
 * on restart — documented prototype behavior.
 *
 * The demo READ clock stays pinned to SYNTHETIC_NOW for deterministic
 * rendering of seed data; MUTATIONS stamp real time so the audit trail and
 * events order correctly.
 */

export const DEMO_ORG_ID = syntheticDatabase.organization.id;
export const demoNow: Date = SYNTHETIC_NOW;

export const store = new AfloStore(syntheticDatabase);

export const clientRepository: ClientRepository = new MockClientRepository(store.database());
export const dashboardRepository: DashboardRepository = new MockDashboardRepository(store.database());
export const portalRepository: PortalRepository = new MockPortalRepository(store.database());

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
 * guards plus every call site stay unchanged.
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
  return requireStaffSession(staffAuth);
}

export async function getClientSession(): Promise<ClientSession> {
  return requireClientSession(clientAuth);
}
