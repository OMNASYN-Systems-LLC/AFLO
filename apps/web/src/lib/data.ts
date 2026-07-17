import {
  MockClientRepository,
  MockDashboardRepository,
  SYNTHETIC_NOW,
  syntheticDatabase,
  type ClientRepository,
  type DashboardRepository,
} from "@aflo/shared";

/**
 * Composition root for the first vertical slice.
 *
 * Pages depend on the repository interfaces only; swapping these singletons
 * for Neon-backed implementations is the entire migration surface (ADR-0002).
 * The demo clock is pinned to SYNTHETIC_NOW so the prototype is deterministic.
 */

export const DEMO_ORG_ID = syntheticDatabase.organization.id;
export const DEMO_STAFF_NAME = "Danielle Mercer";
export const demoNow: Date = SYNTHETIC_NOW;

export const clientRepository: ClientRepository = new MockClientRepository();
export const dashboardRepository: DashboardRepository = new MockDashboardRepository();
