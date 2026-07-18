import {
  MockClientRepository,
  MockDashboardRepository,
  SYNTHETIC_NOW,
  syntheticDatabase,
  type ClientRepository,
  type DashboardRepository,
  type StaffMember,
} from "@aflo/shared";

/**
 * Composition root for the first vertical slice.
 *
 * Pages depend on the repository interfaces only; swapping these singletons
 * for Neon-backed implementations is the entire migration surface (ADR-0002).
 * The demo clock is pinned to SYNTHETIC_NOW so the prototype is deterministic.
 */

export const DEMO_ORG_ID = syntheticDatabase.organization.id;
export const demoNow: Date = SYNTHETIC_NOW;

/** The signed-in staff member the shell impersonates until real auth lands. */
export const DEMO_STAFF: StaffMember = (() => {
  const owner = syntheticDatabase.staff.find((s) => s.role === "organization_owner");
  if (!owner) throw new Error("synthetic dataset must include an organization owner");
  return owner;
})();

export const clientRepository: ClientRepository = new MockClientRepository();
export const dashboardRepository: DashboardRepository = new MockDashboardRepository();
