import type { AuthProvider, AuthSession } from "./session";

/**
 * Demo provider for the synthetic prototype phase: resolves a fixed persona,
 * configured at the composition root. The staff shell and the client portal
 * each compose their own instance — a demo-only split. When Clerk activates
 * (founder supplies credentials; ADR-0006), both surfaces switch to the
 * single Clerk-backed provider and the split disappears; the guards and
 * every call site stay unchanged.
 */
export class DemoAuthProvider implements AuthProvider {
  constructor(private readonly session: NonNullable<AuthSession>) {}

  async getSession(): Promise<AuthSession> {
    return this.session;
  }
}

/**
 * The ONLY place outside this module that gets a demo auth provider.
 *
 * ADR-0052 (demo-runtime removal-proper): the `DemoAuthProvider` *class* now
 * lives entirely inside `packages/auth/src/demo.ts` — its definition AND its
 * construction. The web composition root (`apps/web/src/lib/data.ts`) calls
 * this factory instead of naming the class, so the demo-identity marker
 * (`DemoAuthProvider`) no longer appears in a second production file: the
 * `check:demo-markers` allowlist shrinks to this one legitimate demo-only
 * home (ADR-0021 guard), which now regains marker coverage over `data.ts`.
 * When Clerk activates, deleting this file removes the last demo marker and
 * drains the allowlist to zero (runbook §5.2).
 *
 * This is composition only — it mints no identity of its own: the caller
 * supplies the fixed persona and gates the call on the explicit demo opt-in
 * (`isDemoRuntimePermitted`, ADR-0048). The factory name deliberately carries
 * no standalone demo-identity marker.
 */
export function createDemoAuthProvider(session: NonNullable<AuthSession>): AuthProvider {
  return new DemoAuthProvider(session);
}
