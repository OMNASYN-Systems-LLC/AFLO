import { describe, expect, it } from "vitest";
import {
  projectedMonthlySavingsCents,
  roundUpAmountCents,
  totalRoundUpCents,
} from "../src/roundup";

describe("roundUpAmountCents", () => {
  it("rounds up to the next dollar by default (multiplier 1)", () => {
    expect(roundUpAmountCents(423, 100, 1)).toBe(77); // $4.23 → $5.00
    expect(roundUpAmountCents(1001, 100, 1)).toBe(99); // $10.01 → $11.00
  });

  it("contributes a full increment when already on the boundary", () => {
    expect(roundUpAmountCents(500, 100, 1)).toBe(100); // exact $5 → +$1
    expect(roundUpAmountCents(0, 100, 1)).toBe(100);
  });

  it("applies the multiplier", () => {
    expect(roundUpAmountCents(423, 100, 2)).toBe(154); // 77 × 2
    expect(roundUpAmountCents(423, 100, 1.5)).toBe(116); // round(77 × 1.5 = 115.5)
  });

  it("supports non-dollar boundaries", () => {
    expect(roundUpAmountCents(1234, 500, 1)).toBe(266); // → $15.00
  });

  it("is integer-cent exact (no floating drift)", () => {
    expect(roundUpAmountCents(1010, 100, 1)).toBe(90);
    expect(Number.isInteger(roundUpAmountCents(999, 100, 1.1))).toBe(true);
  });

  it("fails safe on invalid inputs", () => {
    expect(roundUpAmountCents(-5, 100, 1)).toBe(0);
    expect(roundUpAmountCents(423, 0, 1)).toBe(0);
    expect(roundUpAmountCents(423, 100, -1)).toBe(0);
    expect(roundUpAmountCents(Number.NaN, 100, 1)).toBe(0);
  });
});

describe("totalRoundUpCents", () => {
  const settings = { roundToCents: 100, multiplier: 1, enabled: true };

  it("sums the round-ups across transactions", () => {
    expect(totalRoundUpCents([423, 1001, 500], settings)).toBe(77 + 99 + 100);
  });

  it("returns zero when the simulation is disabled", () => {
    expect(totalRoundUpCents([423, 1001], { ...settings, enabled: false })).toBe(0);
  });
});

describe("projectedMonthlySavingsCents", () => {
  it("scales the sampled total to a 30-day month", () => {
    expect(projectedMonthlySavingsCents(600, 15)).toBe(1200); // 600 over 15d → 1200/mo
    expect(projectedMonthlySavingsCents(300, 30)).toBe(300);
  });

  it("returns the raw total for a non-positive window", () => {
    expect(projectedMonthlySavingsCents(500, 0)).toBe(500);
    expect(projectedMonthlySavingsCents(500, -3)).toBe(500);
  });
});
