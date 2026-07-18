/**
 * AFLO auth contract (ADR-0006: Clerk accepted, founder-gated activation).
 *
 * Identity resolution is provider-neutral behind this interface. Providers
 * are identity authorities ONLY — role and membership authority stays with
 * `organization_members` (AUTHORIZATION_MATRIX.md); nothing here grants
 * permissions. Sessions resolve server-side per request; the browser never
 * supplies organization, staff, or client identity.
 */

export interface StaffSession {
  kind: "staff";
  organizationId: string;
  staffId: string;
}

export interface ClientSession {
  kind: "client";
  organizationId: string;
  clientId: string;
}

export type AuthSession = StaffSession | ClientSession | null;

export interface AuthProvider {
  /** Resolve the current request's session. Null = unauthenticated. */
  getSession(): Promise<AuthSession>;
}

/** Thrown by the guards; route handlers translate it to a redirect/404. */
export class UnauthorizedError extends Error {
  constructor(required: "staff" | "client") {
    super(`unauthorized: a ${required} session is required`);
    this.name = "UnauthorizedError";
  }
}

/** Fail closed: anything but a staff session is rejected. */
export async function requireStaffSession(provider: AuthProvider): Promise<StaffSession> {
  const session = await provider.getSession();
  if (!session || session.kind !== "staff") throw new UnauthorizedError("staff");
  return session;
}

/** Fail closed: anything but a client session is rejected. */
export async function requireClientSession(provider: AuthProvider): Promise<ClientSession> {
  const session = await provider.getSession();
  if (!session || session.kind !== "client") throw new UnauthorizedError("client");
  return session;
}
