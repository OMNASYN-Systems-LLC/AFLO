/**
 * Deterministic monthly-action status rules (action.v1.0.0).
 *
 * Monthly actions are the operating tasks of a client's plan for one month.
 * Status moves are an allow-list; a completed action can be reopened, but
 * that is a distinct, flagged move (AC_REOPENED) so the audit trail records
 * corrections — completion history is never silently rewritten.
 */

export const ACTION_RULES_VERSION = "action.v1.0.0";

export const ACTION_STATUSES = ["todo", "in_progress", "done"] as const;

export type ActionStatusId = (typeof ACTION_STATUSES)[number];

export type ActionReasonCode =
  | "AC_STARTED"
  | "AC_COMPLETED"
  | "AC_PAUSED"
  | "AC_REOPENED"
  | "AC_SAME_STATUS"
  | "AC_UNKNOWN_STATUS"
  | "AC_ILLEGAL_TRANSITION";

const ALLOWED: Record<ActionStatusId, Partial<Record<ActionStatusId, ActionReasonCode>>> = {
  todo: { in_progress: "AC_STARTED", done: "AC_COMPLETED" },
  in_progress: { done: "AC_COMPLETED", todo: "AC_PAUSED" },
  done: { todo: "AC_REOPENED", in_progress: "AC_REOPENED" },
};

export interface ActionTransitionResult {
  allowed: boolean;
  fromStatus: string;
  toStatus: string;
  reasonCode: ActionReasonCode;
  ruleVersion: string;
}

export function actionTransition(fromStatus: string, toStatus: string): ActionTransitionResult {
  const base = { fromStatus, toStatus, ruleVersion: ACTION_RULES_VERSION };
  const known = (s: string): s is ActionStatusId => (ACTION_STATUSES as readonly string[]).includes(s);
  if (!known(fromStatus) || !known(toStatus)) {
    return { ...base, allowed: false, reasonCode: "AC_UNKNOWN_STATUS" };
  }
  if (fromStatus === toStatus) return { ...base, allowed: false, reasonCode: "AC_SAME_STATUS" };
  const code = ALLOWED[fromStatus][toStatus];
  if (!code) return { ...base, allowed: false, reasonCode: "AC_ILLEGAL_TRANSITION" };
  return { ...base, allowed: true, reasonCode: code };
}
