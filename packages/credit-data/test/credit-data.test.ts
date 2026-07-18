import { describe, expect, it } from "vitest";
import {
  CREDIT_DATA_RULES_VERSION,
  MockCreditDataProvider,
  UnknownSubjectError,
  summarizeCreditReport,
  syntheticCreditReport,
  type NormalizedTradeline,
} from "../src";

const NOW = new Date("2026-07-18T12:00:00.000Z");

function revolving(id: string, balance: number, limit: number, derogatory = false): NormalizedTradeline {
  return {
    id,
    type: "revolving",
    status: "open",
    balanceCents: balance,
    creditLimitCents: limit,
    monthlyPaymentCents: 5000,
    openedOn: "2022-01-01",
    pastDueAmountCents: 0,
    isDerogatory: derogatory,
  };
}

const REPORT = syntheticCreditReport({
  subjectRef: "c-demo",
  pulledAt: "2026-07-15T00:00:00.000Z",
  score: 682,
  onTimePaymentRate: 0.95,
  tradelines: [
    revolving("tl-1", 40000, 100000), // $400 / $1000
    revolving("tl-2", 20000, 100000), // $200 / $1000
    {
      id: "tl-3",
      type: "installment",
      status: "open",
      balanceCents: 1200000,
      creditLimitCents: null,
      monthlyPaymentCents: 30000,
      openedOn: "2024-06-01",
      pastDueAmountCents: 0,
      isDerogatory: false,
    },
    {
      id: "tl-4",
      type: "other",
      status: "collection",
      balanceCents: 45000,
      creditLimitCents: null,
      monthlyPaymentCents: 0,
      openedOn: "2023-02-01",
      pastDueAmountCents: 45000,
      isDerogatory: true,
    },
  ],
  inquiries: [
    { id: "iq-1", type: "hard", occurredOn: "2026-05-01" }, // within a year
    { id: "iq-2", type: "hard", occurredOn: "2024-01-01" }, // older than a year
    { id: "iq-3", type: "soft", occurredOn: "2026-06-01" }, // soft, not counted
  ],
});

describe("summarizeCreditReport", () => {
  it("aggregates deterministic readiness-relevant facts", () => {
    const facts = summarizeCreditReport(REPORT, NOW);
    expect(facts).toEqual({
      primaryScore: 682,
      primaryScoreModel: "vantagescore_3",
      revolvingBalanceCents: 60000, // 400 + 200
      revolvingLimitCents: 200000, // 1000 + 1000
      utilizationPct: 30, // 60000 / 200000
      openTradelines: 3, // two revolving + one installment (collection is not "open")
      derogatoryMarks: 1,
      hardInquiriesTrailingYear: 1, // only the 2026-05 hard inquiry
      onTimePaymentRate: 0.95,
    });
  });

  it("returns null utilization when there is no revolving limit (no divide-by-zero)", () => {
    const report = syntheticCreditReport({
      subjectRef: "c-norev",
      pulledAt: "2026-07-15T00:00:00.000Z",
      score: 700,
      onTimePaymentRate: 1,
      tradelines: [
        {
          id: "tl-a",
          type: "auto",
          status: "open",
          balanceCents: 900000,
          creditLimitCents: null,
          monthlyPaymentCents: 25000,
          openedOn: "2025-01-01",
          pastDueAmountCents: 0,
          isDerogatory: false,
        },
      ],
    });
    const facts = summarizeCreditReport(report, NOW);
    expect(facts.utilizationPct).toBeNull();
    expect(facts.revolvingLimitCents).toBe(0);
  });
});

describe("MockCreditDataProvider", () => {
  const provider = new MockCreditDataProvider({ "c-demo": REPORT });

  it("advertises itself as a non-production synthetic provider", () => {
    const info = provider.info();
    expect(info.id).toBe("mock");
    expect(info.isProduction).toBe(false);
  });

  it("returns the seeded normalized report for a known subject", async () => {
    const report = await provider.fetchReport({
      subjectRef: "c-demo",
      purpose: "consumer_disclosure",
      requestedAt: NOW.toISOString(),
    });
    expect(report.source).toBe("mock");
    expect(report.scores[0]?.value).toBe(682);
  });

  it("rejects an unknown subject instead of fabricating data", async () => {
    await expect(
      provider.fetchReport({ subjectRef: "c-ghost", purpose: "account_review", requestedAt: NOW.toISOString() }),
    ).rejects.toBeInstanceOf(UnknownSubjectError);
  });
});

describe("versioning", () => {
  it("pins the rule version", () => {
    expect(CREDIT_DATA_RULES_VERSION).toBe("credit-data.v1.0.0");
  });
});
