import { describe, expect, it } from "vitest";
import { parse as parseConnectionString } from "pg-connection-string";
import { evaluateRemoteTargetGuard, NON_MAIN_TOKENS, FORBIDDEN_CONNECTION_PARAMS } from "../src/acceptance/guard";

/**
 * The remote-target hard guard (ADR-0050) — refusal-matrix proof, built around
 * the PARSE-FOR-CONNECT principle. The guard is a PURE function: none of these
 * cases opens a connection. Every ambiguity refuses; only an affirmatively
 * non-main target (validated on the host pg ACTUALLY connects to) with an exact
 * operator echo passes.
 *
 * Includes the TWO live-proven bypasses of the earlier WHATWG-only guard:
 *   C1 — `?host=` silently overrides the authority host in pg-connection-string.
 *   C2 — `postgres://` is non-special, so WHATWG keeps `%61` opaque while
 *        pg-connection-string decodes it to `a` (`ep-m%61in` → `ep-main`).
 */

const PREVIEW_HOST = "ep-aflo-preview-123456.us-east-2.aws.neon.tech";
const PREVIEW_URL = `postgresql://aflo_app:x@${PREVIEW_HOST}/aflo`;
const CONFIRMED = { ACCEPTANCE_CONFIRM_NON_MAIN: PREVIEW_HOST };

describe("parse-for-connect — the guard validates the host pg actually connects to", () => {
  it("C1 (LIVE BYPASS): ?host= override — validates the ?host= target, not the decoy authority", () => {
    // pg-connection-string returns host = ep-aflo-main-1 (the ?host= value); the
    // decoy authority ep-aflo-preview-1 must NOT let this through.
    const url = `postgresql://u:p@ep-aflo-preview-1.aws.neon.tech/aflo?host=ep-aflo-main-1.aws.neon.tech`;
    // Prove the premise: pg really connects to the main host.
    expect(parseConnectionString(url).host).toBe("ep-aflo-main-1.aws.neon.tech");
    const verdict = evaluateRemoteTargetGuard(url, {
      ACCEPTANCE_CONFIRM_NON_MAIN: "ep-aflo-preview-1.aws.neon.tech",
    });
    expect(verdict.ok).toBe(false);
    // Refused at the forbidden-param layer (host param) before it can reach a marker.
    expect(verdict.reason).toMatch(/'host' query parameter/);
  });

  it("C2 (LIVE BYPASS): percent-encoded host — validates the DECODED host", () => {
    // WHATWG keeps ep-m%61in-1 opaque; pg-connection-string decodes to ep-main-1.
    const url = `postgresql://u:p@ep-m%61in-1.aws.neon.tech/aflo`;
    expect(parseConnectionString(url).host).toBe("ep-main-1.aws.neon.tech");
    const verdict = evaluateRemoteTargetGuard(url, {
      ACCEPTANCE_CONFIRM_NON_MAIN: "ep-main-1.aws.neon.tech",
    });
    expect(verdict.ok).toBe(false);
    // Either the divergence layer or the marker layer refuses — both hold; assert refusal.
    expect(verdict.reason).toMatch(/manipulated\/percent-encoded host|main-like marker 'main'/);
  });

  it("C2 variant: uppercase percent-encoding (%41 → A) is also decoded and refused", () => {
    const url = `postgresql://u:p@ep-M%41IN-1.aws.neon.tech/aflo`;
    expect(parseConnectionString(url).host?.toLowerCase()).toBe("ep-main-1.aws.neon.tech");
    const verdict = evaluateRemoteTargetGuard(url, {
      ACCEPTANCE_CONFIRM_NON_MAIN: "ep-main-1.aws.neon.tech",
    });
    expect(verdict.ok).toBe(false);
  });

  it("any percent-encoding in the host refuses via the divergence layer, even without a marker", () => {
    // ep-previe%77 decodes to ep-preview (has the discriminator) — but it is still
    // a manipulated host, so the divergence layer refuses it on principle.
    const url = `postgresql://u:p@ep-previe%77-1.aws.neon.tech/aflo`;
    const verdict = evaluateRemoteTargetGuard(url, {
      ACCEPTANCE_CONFIRM_NON_MAIN: "ep-preview-1.aws.neon.tech",
    });
    expect(verdict.ok).toBe(false);
    expect(verdict.reason).toMatch(/manipulated\/percent-encoded host/);
  });
});

describe("remote-target guard — forbidden connection params", () => {
  it.each([...FORBIDDEN_CONNECTION_PARAMS])("refuses a '%s' query parameter outright", (param) => {
    const url = `postgresql://u:p@${PREVIEW_HOST}/aflo?${param}=whatever`;
    const verdict = evaluateRemoteTargetGuard(url, CONFIRMED);
    expect(verdict.ok).toBe(false);
    expect(verdict.reason).toMatch(new RegExp(`'${param}' query parameter`));
  });

  it("refuses ?hostaddr= (pins a connect IP behind the visible host)", () => {
    const verdict = evaluateRemoteTargetGuard(`postgresql://u:p@${PREVIEW_HOST}/aflo?hostaddr=1.2.3.4`, CONFIRMED);
    expect(verdict.ok).toBe(false);
    expect(verdict.reason).toMatch(/'hostaddr' query parameter/);
  });

  it("refuses ?options= (can reconfigure the session, e.g. search_path)", () => {
    const verdict = evaluateRemoteTargetGuard(
      `postgresql://u:p@${PREVIEW_HOST}/aflo?options=-csearch_path%3Dmain`,
      CONFIRMED,
    );
    expect(verdict.ok).toBe(false);
    expect(verdict.reason).toMatch(/'options' query parameter/);
  });
});

describe("remote-target guard — userinfo tricks (read the host, not the userinfo)", () => {
  it("refuses a decoy INNOCENT username in front of a MAIN host (real host is main)", () => {
    // userinfo 'ep-preview-user' looks innocent; the real host is ep-main-1.
    const url = `postgresql://ep-preview-user:p@ep-main-1.aws.neon.tech/aflo`;
    expect(parseConnectionString(url).host).toBe("ep-main-1.aws.neon.tech");
    const verdict = evaluateRemoteTargetGuard(url, {
      ACCEPTANCE_CONFIRM_NON_MAIN: "ep-main-1.aws.neon.tech",
    });
    expect(verdict.ok).toBe(false);
    expect(verdict.reason).toMatch(/main-like marker 'main'/);
  });

  it("does NOT over-refuse a 'main'-containing USERNAME when the real host is innocent-preview", () => {
    // 'main-user' is just a username; pg connects to the innocent preview host.
    const host = "ep-innocent-preview-1.aws.neon.tech";
    const url = `postgresql://main-user:p@${host}/aflo`;
    expect(parseConnectionString(url).host).toBe(host);
    const verdict = evaluateRemoteTargetGuard(url, { ACCEPTANCE_CONFIRM_NON_MAIN: host });
    expect(verdict.ok).toBe(true);
  });
});

describe("remote-target guard — IPv6 literal hosts", () => {
  it("refuses an IPv6 literal with no branch discriminator", () => {
    const url = "postgresql://u:p@[2001:db8::1]:5432/aflo";
    const verdict = evaluateRemoteTargetGuard(url, { ACCEPTANCE_CONFIRM_NON_MAIN: "2001:db8::1" });
    expect(verdict.ok).toBe(false);
    expect(verdict.reason).toMatch(/verifiable non-main branch discriminator/);
  });

  it("accepts the IPv6 loopback ::1 only via its 127-less path — refuses (no discriminator)", () => {
    // ::1 has no '127' token; it is refused for lack of a discriminator (correct).
    const url = "postgresql://u:p@[::1]:5432/aflo";
    const verdict = evaluateRemoteTargetGuard(url, { ACCEPTANCE_CONFIRM_NON_MAIN: "::1" });
    expect(verdict.ok).toBe(false);
  });
});

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
    const verdict = evaluateRemoteTargetGuard(`postgresql://u:p@${PREVIEW_HOST}/aflo_prod`, CONFIRMED);
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
    const host = "db.mydomain-preview.example.com";
    const verdict = evaluateRemoteTargetGuard(`postgresql://u:p@${host}/aflo`, {
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
  it("accepts a preview host with the exact confirm echo (validate-only + read-only by default)", () => {
    const verdict = evaluateRemoteTargetGuard(PREVIEW_URL, CONFIRMED);
    expect(verdict.ok).toBe(true);
    expect(verdict.host).toBe(PREVIEW_HOST);
    expect(verdict.applyMigrations).toBe(false);
    expect(verdict.runSmoke).toBe(false);
    expect(verdict.config?.host).toBe(PREVIEW_HOST);
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

  it("accepts the 127.0.0.1 loopback (the '127' token is a discriminator)", () => {
    const verdict = evaluateRemoteTargetGuard("postgresql://u:p@127.0.0.1:5432/aflo", {
      ACCEPTANCE_CONFIRM_NON_MAIN: "127.0.0.1",
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

  it("enables the remote DML smoke ONLY on ACCEPTANCE_RUN_SMOKE === 'true' (exactly)", () => {
    expect(evaluateRemoteTargetGuard(PREVIEW_URL, { ...CONFIRMED, ACCEPTANCE_RUN_SMOKE: "true" }).runSmoke).toBe(true);
    for (const notTrue of ["1", "TRUE", "yes", ""]) {
      expect(evaluateRemoteTargetGuard(PREVIEW_URL, { ...CONFIRMED, ACCEPTANCE_RUN_SMOKE: notTrue }).runSmoke).toBe(false);
    }
  });

  it("documents the accepted discriminator tokens", () => {
    expect(NON_MAIN_TOKENS).toContain("preview");
    expect(NON_MAIN_TOKENS).toContain("dev");
    expect(NON_MAIN_TOKENS).toContain("staging");
  });
});
