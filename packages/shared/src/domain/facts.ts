import { dtiPct, reserveMonths, utilizationPct, type ReadinessFacts } from "@aflo/rules";
import type { CreditProfile, FinancialProfile } from "./types";

/**
 * Adapter from domain profiles to the rules kernel's fact shape. Lives in
 * the domain layer so @aflo/rules stays dependency-free.
 */
export function toReadinessFacts(financial: FinancialProfile, credit: CreditProfile): ReadinessFacts {
  return {
    creditScore: credit.score,
    utilizationPct: utilizationPct(credit.revolvingBalanceCents, credit.revolvingLimitCents),
    dtiPct: dtiPct(financial.monthlyDebtPaymentsCents, financial.monthlyIncomeCents),
    reserveMonths: reserveMonths(financial.liquidSavingsCents, financial.monthlyEssentialExpensesCents),
    derogatoryMarks: credit.derogatoryMarks,
    onTimePaymentRate: credit.onTimePaymentRate,
    incomeStability: financial.incomeStability,
  };
}
