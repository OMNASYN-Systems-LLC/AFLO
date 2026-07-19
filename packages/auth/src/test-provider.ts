/**
 * Test-only session-context provider (founder directive PHASE 2).
 *
 * Resolves a fixed, pre-built SessionContext for deterministic tests. This is
 * NOT a runtime demo fallback: outside automated tests the app must resolve
 * identity through the real (Clerk-backed) provider or fail closed. It lives here
 * so unit/integration tests can exercise the session→authorization path without
 * a live Clerk session.
 */

import {
  buildSessionContext,
  type SessionContext,
  type SessionContextInput,
  type SessionContextProvider,
} from "./session-context";

export class TestSessionContextProvider implements SessionContextProvider {
  private readonly context: SessionContext | null;

  constructor(context: SessionContext | null) {
    this.context = context;
  }

  /** Build a provider from raw identity/membership/client-link input. */
  static fromInput(input: SessionContextInput): TestSessionContextProvider {
    return new TestSessionContextProvider(buildSessionContext(input));
  }

  /** An always-unauthenticated provider (resolves null). */
  static unauthenticated(): TestSessionContextProvider {
    return new TestSessionContextProvider(null);
  }

  async resolve(): Promise<SessionContext | null> {
    return this.context;
  }
}
