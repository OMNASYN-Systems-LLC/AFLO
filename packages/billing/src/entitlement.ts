import { MS_PER_DAY } from "@aflo/rules";
import type { SubscriptionStatus } from "./status";
import { BILLING_RULES_VERSION } from "./transitions";

/**
 * Subscription-access gate (deterministic). Decides whether a subscription
 * currently entitles access, independent of any credit-readiness state.
 *
 * A past_due subscription keeps access through a grace window so a single
 * failed charge does not immediately lock a client out mid-coaching; after
 * the window, access is withdrawn until payment recovers.
 */

export type EntitlementReasonCode =
  | "ENT_ACTIVE"
  | "ENT_TRIALING"
  | "ENT_PAST_DUE_IN_GRACE"
  | "ENT_PAST_DUE_EXPIRED"
  | "ENT_PAUSED"
  | "ENT_CANCELED";

export interface EntitlementDecision {
  entitled: boolean;
  reasonCode: EntitlementReasonCode;
  ruleVersion: string;
}

export const DEFAULT_PAST_DUE_GRACE_DAYS = 7;

export interface EntitlementInput {
  status: SubscriptionStatus;
  /** When the subscription entered past_due; required only for past_due. */
  pastDueSinceIso?: string;
  now: Date;
  graceDays?: number;
}

export function evaluateEntitlement(input: EntitlementInput): EntitlementDecision {
  const ruleVersion = BILLING_RULES_VERSION;
  const graceDays = input.graceDays ?? DEFAULT_PAST_DUE_GRACE_DAYS;

  switch (input.status) {
    case "active":
      return { entitled: true, reasonCode: "ENT_ACTIVE", ruleVersion };
    case "trialing":
      return { entitled: true, reasonCode: "ENT_TRIALING", ruleVersion };
    case "paused":
      return { entitled: false, reasonCode: "ENT_PAUSED", ruleVersion };
    case "canceled":
      return { entitled: false, reasonCode: "ENT_CANCELED", ruleVersion };
    case "past_due": {
      if (!input.pastDueSinceIso) {
        // No recorded start → treat as just-entered, still in grace.
        return { entitled: true, reasonCode: "ENT_PAST_DUE_IN_GRACE", ruleVersion };
      }
      const since = new Date(input.pastDueSinceIso).getTime();
      if (Number.isNaN(since)) {
        throw new TypeError(`evaluateEntitlement: invalid pastDueSince "${input.pastDueSinceIso}"`);
      }
      const withinGrace = input.now.getTime() <= since + graceDays * MS_PER_DAY;
      return withinGrace
        ? { entitled: true, reasonCode: "ENT_PAST_DUE_IN_GRACE", ruleVersion }
        : { entitled: false, reasonCode: "ENT_PAST_DUE_EXPIRED", ruleVersion };
    }
  }
}
