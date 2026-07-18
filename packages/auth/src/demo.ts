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
