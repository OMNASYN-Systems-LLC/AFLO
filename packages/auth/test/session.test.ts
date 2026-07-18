import { describe, expect, it } from "vitest";
import {
  DemoAuthProvider,
  requireClientSession,
  requireStaffSession,
  UnauthorizedError,
  type AuthProvider,
} from "../src";

const staffProvider = new DemoAuthProvider({
  kind: "staff",
  organizationId: "org-golden-key",
  staffId: "s-mercer",
});
const clientProvider = new DemoAuthProvider({
  kind: "client",
  organizationId: "org-golden-key",
  clientId: "c-bell",
});
const anonymous: AuthProvider = { getSession: async () => null };

describe("requireStaffSession", () => {
  it("returns the staff session", async () => {
    await expect(requireStaffSession(staffProvider)).resolves.toMatchObject({
      kind: "staff",
      organizationId: "org-golden-key",
      staffId: "s-mercer",
    });
  });

  it("fails closed for client sessions and anonymous requests", async () => {
    await expect(requireStaffSession(clientProvider)).rejects.toThrow(UnauthorizedError);
    await expect(requireStaffSession(anonymous)).rejects.toThrow(/staff session is required/);
  });
});

describe("requireClientSession", () => {
  it("returns the client session", async () => {
    await expect(requireClientSession(clientProvider)).resolves.toMatchObject({
      kind: "client",
      clientId: "c-bell",
    });
  });

  it("fails closed for staff sessions and anonymous requests", async () => {
    await expect(requireClientSession(staffProvider)).rejects.toThrow(UnauthorizedError);
    await expect(requireClientSession(anonymous)).rejects.toThrow(/client session is required/);
  });
});
