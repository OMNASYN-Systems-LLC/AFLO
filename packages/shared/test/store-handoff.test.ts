import { describe, expect, it } from "vitest";
import { AfloStore } from "../src/store";
import { syntheticDatabase } from "../src/data/synthetic";

const ORG = syntheticDatabase.organization.id;
const NOW = new Date("2026-07-18T12:00:00.000Z");

function makeStore(clock: () => Date = () => NOW) {
  return new AfloStore(syntheticDatabase, clock);
}

describe("generateHandoffPackage", () => {
  it("signs a package of verified facts for a consented client", () => {
    const store = makeStore();
    const res = store.generateHandoffPackage({
      organizationId: ORG,
      clientId: "c-whitaker",
      recipientScope: "partner-cpa:acme-tax",
      actorStaffId: "s-boyd",
    });

    expect(res.ok).toBe(true);
    const pkg = res.package!;
    expect(pkg).toMatchObject({
      organizationId: ORG,
      clientId: "c-whitaker",
      recipientScope: "partner-cpa:acme-tax",
      algorithm: "ed25519",
      schemaVersion: "handoff.v1",
      ruleVersion: "security.v1.0.0",
      revokedAt: null,
    });
    // Verified facts only — the readiness STAGE, never a bureau score.
    expect(pkg.payload).toEqual({
      subjectName: "James Whitaker",
      issuingOrganization: "Golden Key Wealth",
      afloReadinessStage: "capital_readiness",
      afloReadinessStageLabel: "Capital Readiness",
      readinessIsBureauScore: false,
      readinessRuleVersion: "readiness.v1.0.0",
      readinessAssessedAt: expect.any(String),
      primaryGoal: { title: "Purchase a first home", category: "home_purchase" },
      verifiedDocumentCount: 2,
      latestPublishedReportQuarter: "2026-Q2",
    });
    // A digest is present but is not the signature; the signature is separate.
    expect(pkg.payloadDigest).toMatch(/^[0-9a-f]{64}$/);
    expect(pkg.signature).not.toBe(pkg.payloadDigest);
    expect(pkg.expiresAt).toBe("2026-08-17T12:00:00.000Z");

    const audit = store.auditFor(ORG).at(-1)!;
    expect(audit.action).toBe("handoff.generated");
    expect(audit.reasonCode).toBe("HANDOFF_ISSUED");
  });

  it("verifies its own freshly signed package as VALID", () => {
    const store = makeStore();
    const { package: pkg } = store.generateHandoffPackage({
      organizationId: ORG,
      clientId: "c-whitaker",
      recipientScope: "partner-cpa:acme-tax",
      actorStaffId: "s-boyd",
    });
    expect(store.verifyHandoffPackageById(ORG, pkg!.id)).toEqual({ ok: true, verdict: "VALID" });
  });

  it("fails closed without partner-data-sharing consent, audited, no package", () => {
    const store = makeStore();
    const res = store.generateHandoffPackage({
      organizationId: ORG,
      clientId: "c-bell", // communication consent only, no partner_data_sharing
      recipientScope: "partner-cpa:acme-tax",
      actorStaffId: "s-boyd",
    });
    expect(res).toEqual({ ok: false, denialCode: "NO_PARTNER_CONSENT" });
    expect(store.handoffPackagesFor(ORG, "c-bell")).toHaveLength(0);
    expect(store.auditFor(ORG).at(-1)).toMatchObject({
      action: "handoff.generate_denied",
      reasonCode: "NO_PARTNER_CONSENT",
    });
  });

  it("fails closed when the client has no recorded readiness assessment", () => {
    const store = makeStore();
    // Solomon has partner_data_sharing consent but no recorded assessment.
    const res = store.generateHandoffPackage({
      organizationId: ORG,
      clientId: "c-solomon",
      recipientScope: "partner-cpa:acme-tax",
      actorStaffId: "s-mercer",
    });
    expect(res).toEqual({ ok: false, denialCode: "NO_VERIFIED_ASSESSMENT" });
    expect(store.auditFor(ORG).at(-1)).toMatchObject({
      action: "handoff.generate_denied",
      reasonCode: "NO_VERIFIED_ASSESSMENT",
    });
  });

  it("rejects an unknown actor and an unknown client without mutating", () => {
    const store = makeStore();
    expect(
      store.generateHandoffPackage({
        organizationId: ORG,
        clientId: "c-whitaker",
        recipientScope: "partner-cpa:acme-tax",
        actorStaffId: "s-ghost",
      }),
    ).toEqual({ ok: false, denialCode: "ACTOR_NOT_IN_ORG" });
    expect(
      store.generateHandoffPackage({
        organizationId: ORG,
        clientId: "c-nobody",
        recipientScope: "partner-cpa:acme-tax",
        actorStaffId: "s-boyd",
      }),
    ).toEqual({ ok: false, denialCode: "CLIENT_NOT_FOUND" });
    expect(store.handoffPackagesFor(ORG, "c-whitaker")).toHaveLength(0);
  });
});

describe("verifyHandoffPackageById", () => {
  it("detects payload tampering as DIGEST_MISMATCH", () => {
    const store = makeStore();
    const { package: pkg } = store.generateHandoffPackage({
      organizationId: ORG,
      clientId: "c-whitaker",
      recipientScope: "partner-cpa:acme-tax",
      actorStaffId: "s-boyd",
    });
    // Tamper the stored package (handoffPackagesFor returns live references).
    const stored = store.handoffPackagesFor(ORG, "c-whitaker")[0]!;
    stored.payload = { ...(stored.payload as object), afloReadinessStage: "legacy" } as typeof stored.payload;
    expect(store.verifyHandoffPackageById(ORG, pkg!.id)).toMatchObject({
      ok: false,
      verdict: "DIGEST_MISMATCH",
    });
  });

  it("reports EXPIRED once past the validity window", () => {
    let clock = NOW;
    const store = makeStore(() => clock);
    const { package: pkg } = store.generateHandoffPackage({
      organizationId: ORG,
      clientId: "c-whitaker",
      recipientScope: "partner-cpa:acme-tax",
      actorStaffId: "s-boyd",
    });
    clock = new Date("2026-09-01T00:00:00.000Z"); // beyond issuedAt + 30 days
    expect(store.verifyHandoffPackageById(ORG, pkg!.id)).toMatchObject({ ok: false, verdict: "EXPIRED" });
  });

  it("returns PACKAGE_NOT_FOUND for an unknown id and across tenants", () => {
    const store = makeStore();
    const { package: pkg } = store.generateHandoffPackage({
      organizationId: ORG,
      clientId: "c-whitaker",
      recipientScope: "partner-cpa:acme-tax",
      actorStaffId: "s-boyd",
    });
    expect(store.verifyHandoffPackageById(ORG, "hp-nope")).toEqual({
      ok: false,
      verdict: "PACKAGE_NOT_FOUND",
    });
    // Tenant isolation: another org cannot resolve this package by id.
    expect(store.verifyHandoffPackageById("org-other", pkg!.id)).toEqual({
      ok: false,
      verdict: "PACKAGE_NOT_FOUND",
    });
  });
});

describe("revokeHandoffPackage", () => {
  it("revokes a package and then verifies it as REVOKED", () => {
    const store = makeStore();
    const { package: pkg } = store.generateHandoffPackage({
      organizationId: ORG,
      clientId: "c-whitaker",
      recipientScope: "partner-cpa:acme-tax",
      actorStaffId: "s-boyd",
    });
    const res = store.revokeHandoffPackage({ organizationId: ORG, packageId: pkg!.id, actorStaffId: "s-boyd" });
    expect(res.ok).toBe(true);
    expect(res.package?.revokedAt).toBe(NOW.toISOString());
    expect(store.verifyHandoffPackageById(ORG, pkg!.id)).toEqual({ ok: false, verdict: "REVOKED" });
    expect(store.auditFor(ORG).at(-1)).toMatchObject({ action: "handoff.revoked", reasonCode: "HANDOFF_REVOKED" });
  });

  it("refuses a second revocation and an unknown package", () => {
    const store = makeStore();
    const { package: pkg } = store.generateHandoffPackage({
      organizationId: ORG,
      clientId: "c-whitaker",
      recipientScope: "partner-cpa:acme-tax",
      actorStaffId: "s-boyd",
    });
    store.revokeHandoffPackage({ organizationId: ORG, packageId: pkg!.id, actorStaffId: "s-boyd" });
    expect(
      store.revokeHandoffPackage({ organizationId: ORG, packageId: pkg!.id, actorStaffId: "s-boyd" }),
    ).toMatchObject({ ok: false, denialCode: "ALREADY_REVOKED" });
    expect(
      store.revokeHandoffPackage({ organizationId: ORG, packageId: "hp-nope", actorStaffId: "s-boyd" }),
    ).toEqual({ ok: false, denialCode: "PACKAGE_NOT_FOUND" });
  });

  it("enforces tenant isolation on revocation", () => {
    const store = makeStore();
    const { package: pkg } = store.generateHandoffPackage({
      organizationId: ORG,
      clientId: "c-whitaker",
      recipientScope: "partner-cpa:acme-tax",
      actorStaffId: "s-boyd",
    });
    // Wrong org: actor is not in that org, so it never reaches the package.
    expect(
      store.revokeHandoffPackage({ organizationId: "org-other", packageId: pkg!.id, actorStaffId: "s-boyd" }),
    ).toEqual({ ok: false, denialCode: "ACTOR_NOT_IN_ORG" });
    // Package remains valid.
    expect(store.verifyHandoffPackageById(ORG, pkg!.id)).toEqual({ ok: true, verdict: "VALID" });
  });
});
