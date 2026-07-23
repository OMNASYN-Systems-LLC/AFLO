import { describe, expect, it } from "vitest";
import { evaluateRemoteTargetGuard, NON_MAIN_TOKENS } from "../src/acceptance/guard";

/**
 * The remote-target hard guard (ADR-0050) — refusal-matrix proof. The guard is
 * a PURE function: none of these cases opens a connection. Every ambiguity
 * refuses; only an affirmatively non-main target with an exact operator echo
 * of the host passes, and remote DDL additionally requires
 * ACCEPTANCE_APPLY_MIGRATIONS=true.
 */

const PREVIEW_HOST = "ep-aflo-preview-123456.us-east-2.aws.neon.tech";
const PREVIEW_URL = `postgresql://aflo_app:x@${PREVIEW_HOST}/aflo`;
const CONFIRMED = { ACCEPTANCE_CONFIRM_NON_MAIN: PREVIEW_HOST };

describe("remote-target guard — refusals", () => {
  it("refuses an unparseable URL", () => {
    const verdict = evaluateRemoteTargetGuard("not a url", {});
    expect(verdict.ok).toBe(false);
    expect(verdict.reason).toMatch(/not a parseable URL/);
  });

  it("refuses a non-postgres protocol", () => {
    const verdict = evaluateRemoteTargetGuard("mysql://host-preview/db", {});
    expect(verdict.ok).toBe(false);
    expect(verdict.reason).toMatch(/non-postgres protocol/);
  });

  it("refuses a main-ish HOST even with a correct confirm echo", () => {
    const host = "ep-aflo-main-123456.aws.neon.tech";
    const verdict = evaluateRemoteTargetGuard(`postgresql://u:p@${host}/aflo_preview`, {
      ACCEPTANCE_CONFIRM_NON_MAIN: host,
    });
    expect(verdict.ok).toBe(false);
    expect(verdict.reason).toMatch(/main-like marker 'main'/);
  });

  it("refuses a prod-ish DATABASE name", () => {
    const verdict = evaluateRemoteTargetGuard(
      `postgresql://u:p@${PREVIEW_HOST}/aflo_prod`,
      CONFIRMED,
    );
    expect(verdict.ok).toBe(false);
    expect(verdict.reason).toMatch(/main-like marker 'prod'/);
  });

  it.each(["production", "primary", "live"])("refuses the main-like marker '%s' in the host", (marker) => {
    const host = `ep-${marker}-branch-1.aws.neon.tech`;
    const verdict = evaluateRemoteTargetGuard(`postgresql://u:p@${host}/aflo`, {
      ACCEPTANCE_CONFIRM_NON_MAIN: host,
    });
    expect(verdict.ok).toBe(false);
    expect(verdict.reason).toMatch(/main-like marker/);
  });

  it("main-like matching is SUBSTRING (over-broad by design): 'domain' refuses on 'main'", () => {
    const host = "db.mydomain.example.com";
    const verdict = evaluateRemoteTargetGuard(`postgresql://u:p@${host}/aflo_preview`, {
      ACCEPTANCE_CONFIRM_NON_MAIN: host,
    });
    expect(verdict.ok).toBe(false);
    expect(verdict.reason).toMatch(/main-like marker 'main'/);
  });

  it("refuses a URL with NO verifiable non-main discriminator (a bare Neon endpoint)", () => {
    const host = "ep-cool-star-123456.us-east-2.aws.neon.tech";
    const verdict = evaluateRemoteTargetGuard(`postgresql://u:p@${host}/aflo`, {
      ACCEPTANCE_CONFIRM_NON_MAIN: host,
    });
    expect(verdict.ok).toBe(false);
    expect(verdict.reason).toMatch(/no verifiable non-main branch discriminator|carries a verifiable non-main/);
  });

  it("the discriminator must be a clean TOKEN — an accidental letter run does not count", () => {
    // "sadeva" contains "dev" as a substring but not as a token.
    const host = "ep-sadeva-123456.aws.neon.tech";
    const verdict = evaluateRemoteTargetGuard(`postgresql://u:p@${host}/aflo`, {
      ACCEPTANCE_CONFIRM_NON_MAIN: host,
    });
    expect(verdict.ok).toBe(false);
  });

  it("refuses when ACCEPTANCE_CONFIRM_NON_MAIN is missing", () => {
    const verdict = evaluateRemoteTargetGuard(PREVIEW_URL, {});
    expect(verdict.ok).toBe(false);
    expect(verdict.reason).toMatch(/ACCEPTANCE_CONFIRM_NON_MAIN is not set/);
  });

  it("refuses when ACCEPTANCE_CONFIRM_NON_MAIN mismatches the host", () => {
    const verdict = evaluateRemoteTargetGuard(PREVIEW_URL, {
      ACCEPTANCE_CONFIRM_NON_MAIN: "ep-other-preview-999.aws.neon.tech",
    });
    expect(verdict.ok).toBe(false);
    expect(verdict.reason).toMatch(/does not match the target host/);
  });

  it("refuses an empty confirm echo", () => {
    const verdict = evaluateRemoteTargetGuard(PREVIEW_URL, { ACCEPTANCE_CONFIRM_NON_MAIN: "" });
    expect(verdict.ok).toBe(false);
  });
});

describe("remote-target guard — acceptance", () => {
  it("accepts a preview host with the exact confirm echo (validate-only by default)", () => {
    const verdict = evaluateRemoteTargetGuard(PREVIEW_URL, CONFIRMED);
    expect(verdict.ok).toBe(true);
    expect(verdict.host).toBe(PREVIEW_HOST);
    expect(verdict.applyMigrations).toBe(false);
  });

  it("accepts a discriminator carried by the DATABASE name (host bare)", () => {
    const host = "ep-cool-star-123456.aws.neon.tech";
    const verdict = evaluateRemoteTargetGuard(`postgresql://u:p@${host}/aflo_preview`, {
      ACCEPTANCE_CONFIRM_NON_MAIN: host,
    });
    expect(verdict.ok).toBe(true);
  });

  it("accepts localhost (dev database)", () => {
    const verdict = evaluateRemoteTargetGuard("postgresql://u:p@localhost:5432/aflo", {
      ACCEPTANCE_CONFIRM_NON_MAIN: "localhost",
    });
    expect(verdict.ok).toBe(true);
  });

  it("enables remote DDL ONLY on ACCEPTANCE_APPLY_MIGRATIONS === 'true' (exactly)", () => {
    expect(
      evaluateRemoteTargetGuard(PREVIEW_URL, { ...CONFIRMED, ACCEPTANCE_APPLY_MIGRATIONS: "true" }).applyMigrations,
    ).toBe(true);
    for (const notTrue of ["1", "TRUE", "yes", "True", ""]) {
      expect(
        evaluateRemoteTargetGuard(PREVIEW_URL, { ...CONFIRMED, ACCEPTANCE_APPLY_MIGRATIONS: notTrue }).applyMigrations,
      ).toBe(false);
    }
  });

  it("documents the accepted discriminator tokens", () => {
    expect(NON_MAIN_TOKENS).toContain("preview");
    expect(NON_MAIN_TOKENS).toContain("dev");
    expect(NON_MAIN_TOKENS).toContain("staging");
  });
});
