import {
  resolveMessagingUiRuntime,
  StorePortalMessagingGateway,
  StoreStaffMessagingGateway,
  type PortalMessagingGateway,
  type StaffMessagingGateway,
} from "@aflo/shared";
import {
  RouteServicePortalMessagingGateway,
  RouteServiceStaffMessagingGateway,
} from "@aflo/database";
import { getClientSession, getStaffSession, store } from "@/lib/data";
import { composeMessagingDeps } from "@/lib/messaging-runtime";

/**
 * SERVER-ONLY messaging seam composition (Workstream B10, ADR-0046) — the ONE
 * place the messaging UI's data access is selected, by the EXISTING runtime
 * contract (`resolveMessagingUiRuntime`, ADR-0017 as flipped by ADR-0048 —
 * no parallel flag system):
 *
 *   - EXPLICIT demo runtime (`APP_ENV=demo`) → the `AfloStore` gateways over
 *     the same demo sessions the pages used before the seam (behavior
 *     unchanged — but only under the deliberate opt-in),
 *   - clerk + postgres runtime → the route-service gateways over
 *     `composeMessagingDeps(env)` — the exact deps the `/api/messages/...`
 *     routes compose (ADR-0044), so authorization, the uniform anti-oracle
 *     404, and the sensitive-denial audit live in exactly one place. Null
 *     deps (real runtime, incomplete config) → every operation answers
 *     `unavailable`: fail closed, NEVER a demo-data fallback. Until the Clerk
 *     closure composes, the session resolves null and every operation answers
 *     `signed_out` — production stays inert.
 *   - anything else (ambiguous/partial runtime — e.g. intended production
 *     that forgot one mode variable) → the route-service gateways with null
 *     deps: every operation answers `unavailable`. Demo data is NEVER the
 *     fallback (ADR-0048; PR #97 review LOW-5). Boot enforcement
 *     (`instrumentation.ts`) refuses to start these configs outright; this
 *     branch is the belt-and-braces runtime guard behind it.
 *
 * Pages and server actions call THESE factories only — no page or action
 * touches `store.conversationsFor`/`postReply`/... or the messaging
 * repository directly anymore, and none of them may add authorization logic:
 * the UI renders `not_found` as not-found, never as "access denied".
 *
 * Gateways are composed per call (the routes' idiom — deps are cheap; the
 * underlying connection handles are module-cached in `auth-runtime.ts`).
 */

/** The staff messaging gateway for the current runtime. */
export function staffMessaging(): StaffMessagingGateway {
  if (resolveMessagingUiRuntime(process.env) === "demo") {
    return new StoreStaffMessagingGateway(store, getStaffSession);
  }
  // "persistent" — or "unavailable", where composeMessagingDeps yields null
  // and every operation fails closed with `unavailable` (never demo data).
  return new RouteServiceStaffMessagingGateway(composeMessagingDeps(process.env));
}

/** The client-portal messaging gateway for the current runtime. */
export function portalMessaging(): PortalMessagingGateway {
  if (resolveMessagingUiRuntime(process.env) === "demo") {
    return new StorePortalMessagingGateway(store, getClientSession);
  }
  return new RouteServicePortalMessagingGateway(composeMessagingDeps(process.env));
}
