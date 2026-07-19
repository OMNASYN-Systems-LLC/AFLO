import { describe, expect, it } from "vitest";
import {
  READINESS_INPUT_KEYS,
  REQUIRED_READINESS_INPUT_KEYS,
  RESOLUTION_LOOP_STAGES,
  RESOLUTION_RULES_VERSION,
  readinessInputCompleteness,
  type ReadinessInputPresence,
} from "../src/resolution";

/** All-present / all-absent presence maps for the seven inputs. */
const all = (v: boolean): ReadinessInputPresence =>
  Object.fromEntries(READINESS_INPUT_KEYS.map((k) => [k, v])) as ReadinessInputPresence;

describe("resolution: readinessInputCompleteness (the understand primitive)", () => {
  it("loop stages are the nine-stage governed vocabulary", () => {
    expect(RESOLUTION_LOOP_STAGES).toEqual([
      "understand",
      "diagnose",
      "organize",
      "educate",
      "resolve",
      "verify",
      "route",
      "track",
      "adapt",
    ]);
  });

  it("only the credit score is optional; the other six are required", () => {
    expect(REQUIRED_READINESS_INPUT_KEYS).not.toContain("creditScore");
    expect(REQUIRED_READINESS_INPUT_KEYS).toHaveLength(6);
  });

  it("all inputs captured → canDiagnose, 100%, nothing missing", () => {
    const r = readinessInputCompleteness(all(true));
    expect(r.canDiagnose).toBe(true);
    expect(r.completionPct).toBe(100);
    expect(r.missingKeys).toEqual([]);
    expect(r.blockingMissingKeys).toEqual([]);
    expect(r.ruleVersion).toBe(RESOLUTION_RULES_VERSION);
  });

  it("nothing captured → cannot diagnose, 0%, all six required missing block it", () => {
    const r = readinessInputCompleteness(all(false));
    expect(r.canDiagnose).toBe(false);
    expect(r.completionPct).toBe(0);
    expect(r.capturedKeys).toEqual([]);
    expect(r.blockingMissingKeys).toHaveLength(6);
    expect(r.blockingMissingKeys).not.toContain("creditScore");
  });

  it("only the credit score missing → STILL diagnosable (thin file), score listed as missing but non-blocking", () => {
    const r = readinessInputCompleteness({ ...all(true), creditScore: false });
    expect(r.canDiagnose).toBe(true);
    expect(r.missingKeys).toEqual(["creditScore"]);
    expect(r.blockingMissingKeys).toEqual([]);
    expect(r.completionPct).toBe(86); // 6/7
  });

  it("a required input missing → NOT diagnosable and named as blocking", () => {
    const r = readinessInputCompleteness({ ...all(true), dtiPct: false });
    expect(r.canDiagnose).toBe(false);
    expect(r.blockingMissingKeys).toEqual(["dtiPct"]);
  });

  it("fails closed: a non-boolean/undefined presence flag counts as missing", () => {
    // A partial object (missing keys) must not read as captured.
    const r = readinessInputCompleteness({ creditScore: true } as unknown as ReadinessInputPresence);
    expect(r.capturedKeys).toEqual(["creditScore"]);
    expect(r.canDiagnose).toBe(false);
    expect(r.blockingMissingKeys).toHaveLength(6);
  });

  it("preserves canonical key order in captured/missing lists", () => {
    const r = readinessInputCompleteness({ ...all(false), incomeStability: true, creditScore: true });
    expect(r.capturedKeys).toEqual(["creditScore", "incomeStability"]);
  });
});
