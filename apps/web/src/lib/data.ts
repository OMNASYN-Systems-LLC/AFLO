import {
  AfloStore,
  MockClientRepository,
  MockDashboardRepository,
  SYNTHETIC_NOW,
  syntheticDatabase,
  type ClientRepository,
  type DashboardRepository,
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

/** The signed-in staff member the shell impersonates until Clerk lands. */
export const DEMO_STAFF: StaffMember = (() => {
  const owner = syntheticDatabase.staff.find((s) => s.role === "organization_owner");
  if (!owner) throw new Error("synthetic dataset must include an organization owner");
  return owner;
})();

/**
 * Server-side session resolution — the ONLY source of organization and
 * actor identity for mutations. Never accept organization_id or staff_id
 * from the browser. Replaced by the Clerk adapter (packages/auth, ADR-0006)
 * with the same shape.
 */
export function getStaffSession(): { organizationId: string; staffId: string } {
  return { organizationId: DEMO_ORG_ID, staffId: DEMO_STAFF.id };
}
