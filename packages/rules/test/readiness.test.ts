import { describe, expect, it } from "vitest";
import {
  assessReadiness,
  dtiPct,
  READINESS_RULES_VERSION,
  reserveMonths,
  utilizationPct,
  type ReadinessFacts,
} from "../src/readiness";

function facts(overrides: Partial<ReadinessFacts> = {}): ReadinessFacts {
  // Baseline: every acquisition gate passes.
  return {
    creditScore: 720,
    utilizationPct: 5,
    dtiPct: 20,
    reserveMonths: 6,
    derogatoryMarks: 0,
    onTimePaymentRate: 1,
    incomeStability: "stable",
    ...overrides,
  };
}

describe("deterministic calculators", () => {
  it("computes utilization and rounds to one decimal", () => {
    expect(utilizationPct(4400_00, 10000_00)).toBe(44);
    expect(utilizationPct(6100_00, 16000_00)).toBe(38.1);
  });

  it("treats a zero limit with no balance as zero utilization", () => {
    expect(utilizationPct(0, 0)).toBe(0);
  });

  it("treats a positive balance on a zero limit as fully utilized, never 0%", () => {
    expect(utilizationPct(5000_00, 0)).toBe(100);
  });

  it("computes DTI and pins zero income to 100", () => {
    expect(dtiPct(2600_00, 5000_00)).toBe(52);
    expect(dtiPct(1000_00, 0)).toBe(100);
  });

  it("computes reserve months", () => {
    expect(reserveMonths(11800_00, 4900_00)).toBe(2.4);
    expect(reserveMonths(1000_00, 0)).toBe(0);
  });
});

describe("assessReadiness gate ordering", () => {
  it("reaches acquisition when every gate passes", () => {
    const result = assessReadiness(facts());
    expect(result.stage).toBe("acquisition");
    expect(result.reasonCodes).toEqual(["RC_ALL_ACQUISITION_GATES_MET"]);
    expect(result.ruleVersion).toBe(READINESS_RULES_VERSION);
  });

  it("puts unstable income in recovery regardless of other strengths", () => {
    const result = assessReadiness(facts({ incomeStability: "unstable" }));
    expect(result.stage).toBe("recovery");
    expect(result.reasonCodes).toContain("RC_INCOME_UNSTABLE");
  });

  it("puts poor payment history and heavy derogatories in recovery", () => {
    const result = assessReadiness(facts({ onTimePaymentRate: 0.78, derogatoryMarks: 5 }));
    expect(result.stage).toBe("recovery");
    expect(result.reasonCodes).toEqual(
      expect.arrayContaining(["RC_PAYMENT_HISTORY_POOR", "RC_DEROGATORY_HIGH"]),
    );
  });

  it("boundary: exactly 3 derogatory marks and 85% on-time is not recovery", () => {
    const result = assessReadiness(facts({ derogatoryMarks: 3, onTimePaymentRate: 0.85 }));
    expect(result.stage).toBe("acquisition");
  });

  it("high DTI lands in stabilization", () => {
    const result = assessReadiness(facts({ dtiPct: 52 }));
    expect(result.stage).toBe("stabilization");
    expect(result.reasonCodes).toEqual(["RC_DTI_HIGH"]);
  });

  it("thin reserves land in stabilization", () => {
    const result = assessReadiness(facts({ reserveMonths: 0.6 }));
    expect(result.stage).toBe("stabilization");
    expect(result.reasonCodes).toEqual(["RC_RESERVES_LOW"]);
  });

  it("a missing score lands in credit readiness with RC_SCORE_MISSING", () => {
    const result = assessReadiness(facts({ creditScore: null }));
    expect(result.stage).toBe("credit_readiness");
    expect(result.reasonCodes).toEqual(["RC_SCORE_MISSING"]);
  });

  it("a sub-640 score or >30% utilization lands in credit readiness", () => {
    expect(assessReadiness(facts({ creditScore: 612 })).stage).toBe("credit_readiness");
    const both = assessReadiness(facts({ creditScore: 612, utilizationPct: 44 }));
    expect(both.reasonCodes).toEqual(
      expect.arrayContaining(["RC_SCORE_BELOW_CREDIT_FLOOR", "RC_UTILIZATION_ABOVE_30"]),
    );
  });

  it("near-misses on the acquisition gates land in capital readiness", () => {
    const result = assessReadiness(
      facts({ creditScore: 671, utilizationPct: 8, reserveMonths: 2.4 }),
    );
    expect(result.stage).toBe("capital_readiness");
    expect(result.reasonCodes).toEqual(
      expect.arrayContaining(["RC_SCORE_BELOW_CAPITAL_FLOOR", "RC_RESERVES_BELOW_3M"]),
    );
    expect(result.reasonCodes).not.toContain("RC_UTILIZATION_ABOVE_10");
  });

  it("the most severe failing gate wins: recovery beats later-gate failures", () => {
    const result = assessReadiness(
      facts({ onTimePaymentRate: 0.5, dtiPct: 60, creditScore: 500, utilizationPct: 90 }),
    );
    expect(result.stage).toBe("recovery");
  });
});
