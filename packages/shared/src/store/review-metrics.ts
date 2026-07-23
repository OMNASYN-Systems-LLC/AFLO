import type {
  LifecycleStage,
  ReviewArtifactType,
  ReviewDecision,
  ReviewItemState,
} from "@aflo/rules";

/**
 * Review & playbook analytics — PURE derivation functions (Workstream A PR-3,
 * founder directive 2026-07-20 §"measurable outcomes" + continuation §analytics
 * priority). Metrics are ALWAYS computed from the underlying records, never
 * stored as aggregates — there is nothing to drift, backfill, or reconcile.
 *
 * DATA GOVERNANCE (founder directive, verbatim intent): review-feedback data —
 * decisions, reason codes, modification counts, outcomes — is used ONLY for
 * analytics, rule improvement, prompt improvement, workflow improvement, and
 * QA. It is NEVER used for uncontrolled external-model training. Any future
 * training use requires an explicit founder-approved governance decision.
 *
 * Input shapes are the metric-relevant projections of the Review Center
 * records (kernel vocabularies from @aflo/rules; the persisted tables land in
 * the migration slice — these types are the analytics CONTRACT they must
 * satisfy). All timestamps are ISO strings; all rates are 0..1 fractions
 * (null when the denominator is empty — "no data" is never reported as 0%).
 */

export interface ReviewItemMetricInput {
  id: string;
  artifactType: ReviewArtifactType;
  state: ReviewItemState;
  /** The playbook run this item belongs to, when any. */
  playbookId: string | null;
  playbookVersion: string | null;
  submittedAtIso: string | null;
  publishedAtIso: string | null;
}

export interface ReviewDecisionMetricInput {
  reviewItemId: string;
  decision: ReviewDecision;
  reviewerMemberId: string;
  /** When the decided item entered the queue (copied for time-to-decision). */
  submittedAtIso: string;
  decidedAtIso: string;
  modifiedFieldCount: number;
}

/** A client action tracked to completion, attributable to a review item/playbook. */
export interface ActionOutcomeMetricInput {
  reviewItemId: string | null;
  playbookId: string | null;
  playbookVersion: string | null;
  completed: boolean;
  /** Stage advancement observed after completion (outcome tracking). */
  advancedToStage: LifecycleStage | null;
}

export interface DecisionMix {
  total: number;
  approvedUnchanged: number;
  approvedWithEdits: number;
  rejected: number;
  escalated: number;
  deferred: number;
  /** approved (both kinds) / total decisions; null when no decisions. */
  approvalRate: number | null;
  /** approved_with_edits / approved (both kinds); null when no approvals. */
  editRate: number | null;
  /** rejected / total; null when no decisions. */
  rejectionRate: number | null;
  /** Median minutes from submission to decision; null when no decisions. */
  medianReviewMinutes: number | null;
  /** Mean recorded modifications per approved-with-edits decision; null when none. */
  meanModifiedFields: number | null;
}

export interface StaffDecisionProfile extends DecisionMix {
  reviewerMemberId: string;
}

export interface PlaybookEffectiveness {
  playbookId: string;
  playbookVersion: string;
  itemCount: number;
  publishedCount: number;
  actionCount: number;
  /** completed actions / actions; null when no actions. */
  actionCompletionRate: number | null;
  /** actions followed by a stage advancement / completed actions; null when none completed. */
  stageAdvancementRate: number | null;
}

export interface ReviewMetrics {
  overall: DecisionMix;
  /** Per artifact type — every queue the founder listed gets its own row. */
  byArtifactType: Partial<Record<ReviewArtifactType, DecisionMix>>;
  /** Escalations across all decisions (also present per-mix as `escalated`). */
  escalationVolume: number;
  /** Items currently awaiting review (queue depth). */
  awaitingReviewCount: number;
  actionCompletionRate: number | null;
  stageAdvancementCount: number;
  staffProfiles: StaffDecisionProfile[];
  playbookEffectiveness: PlaybookEffectiveness[];
}

function rate(numerator: number, denominator: number): number | null {
  return denominator === 0 ? null : numerator / denominator;
}

function median(values: number[]): number | null {
  if (values.length === 0) return null;
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 1 ? sorted[mid]! : (sorted[mid - 1]! + sorted[mid]!) / 2;
}

function minutesBetween(fromIso: string, toIso: string): number | null {
  const from = Date.parse(fromIso);
  const to = Date.parse(toIso);
  if (!Number.isFinite(from) || !Number.isFinite(to)) return null; // malformed → excluded, never 0
  return (to - from) / 60_000;
}

function decisionMix(decisions: readonly ReviewDecisionMetricInput[]): DecisionMix {
  const count = (d: ReviewDecision) => decisions.filter((x) => x.decision === d).length;
  const approvedUnchanged = count("approved_unchanged");
  const approvedWithEdits = count("approved_with_edits");
  const approved = approvedUnchanged + approvedWithEdits;
  const total = decisions.length;
  const times = decisions
    .map((d) => minutesBetween(d.submittedAtIso, d.decidedAtIso))
    .filter((m): m is number => m !== null && m >= 0);
  const editCounts = decisions
    .filter((d) => d.decision === "approved_with_edits")
    .map((d) => d.modifiedFieldCount)
    .filter((n) => Number.isInteger(n) && n >= 0);
  return {
    total,
    approvedUnchanged,
    approvedWithEdits,
    rejected: count("rejected"),
    escalated: count("escalated"),
    deferred: count("deferred"),
    approvalRate: rate(approved, total),
    editRate: rate(approvedWithEdits, approved),
    rejectionRate: rate(count("rejected"), total),
    medianReviewMinutes: median(times),
    meanModifiedFields:
      editCounts.length === 0 ? null : editCounts.reduce((a, b) => a + b, 0) / editCounts.length,
  };
}

/**
 * Derive the full analytics read-model from raw records. Deterministic, pure,
 * O(n) per grouping — cheap enough to recompute on every read, which is the
 * point: no stored aggregate can disagree with the records.
 */
export function reviewMetricsFor(
  items: readonly ReviewItemMetricInput[],
  decisions: readonly ReviewDecisionMetricInput[],
  actions: readonly ActionOutcomeMetricInput[],
): ReviewMetrics {
  const itemsById = new Map(items.map((i) => [i.id, i]));

  const byArtifactType: Partial<Record<ReviewArtifactType, DecisionMix>> = {};
  const typeGroups = new Map<ReviewArtifactType, ReviewDecisionMetricInput[]>();
  for (const d of decisions) {
    const item = itemsById.get(d.reviewItemId);
    if (!item) continue; // orphan decision — excluded rather than misattributed
    const group = typeGroups.get(item.artifactType) ?? [];
    group.push(d);
    typeGroups.set(item.artifactType, group);
  }
  for (const [type, group] of typeGroups) byArtifactType[type] = decisionMix(group);

  const staffGroups = new Map<string, ReviewDecisionMetricInput[]>();
  for (const d of decisions) {
    const group = staffGroups.get(d.reviewerMemberId) ?? [];
    group.push(d);
    staffGroups.set(d.reviewerMemberId, group);
  }
  const staffProfiles = [...staffGroups.entries()]
    .map(([reviewerMemberId, group]) => ({ reviewerMemberId, ...decisionMix(group) }))
    .sort((a, b) => a.reviewerMemberId.localeCompare(b.reviewerMemberId));

  const playbookGroups = new Map<string, { items: ReviewItemMetricInput[]; actions: ActionOutcomeMetricInput[] }>();
  const playbookKey = (id: string, version: string) => `${id}@@${version}`;
  for (const item of items) {
    if (!item.playbookId || !item.playbookVersion) continue;
    const key = playbookKey(item.playbookId, item.playbookVersion);
    const group = playbookGroups.get(key) ?? { items: [], actions: [] };
    group.items.push(item);
    playbookGroups.set(key, group);
  }
  for (const action of actions) {
    if (!action.playbookId || !action.playbookVersion) continue;
    const key = playbookKey(action.playbookId, action.playbookVersion);
    const group = playbookGroups.get(key) ?? { items: [], actions: [] };
    group.actions.push(action);
    playbookGroups.set(key, group);
  }
  const playbookEffectiveness = [...playbookGroups.entries()]
    .map(([key, group]) => {
      const [playbookId, playbookVersion] = key.split("@@") as [string, string];
      const completed = group.actions.filter((a) => a.completed);
      return {
        playbookId,
        playbookVersion,
        itemCount: group.items.length,
        publishedCount: group.items.filter((i) => i.state === "published").length,
        actionCount: group.actions.length,
        actionCompletionRate: rate(completed.length, group.actions.length),
        stageAdvancementRate: rate(completed.filter((a) => a.advancedToStage !== null).length, completed.length),
      };
    })
    .sort((a, b) => `${a.playbookId}@${a.playbookVersion}`.localeCompare(`${b.playbookId}@${b.playbookVersion}`));

  const completedActions = actions.filter((a) => a.completed);
  return {
    overall: decisionMix(decisions),
    byArtifactType,
    escalationVolume: decisions.filter((d) => d.decision === "escalated").length,
    awaitingReviewCount: items.filter((i) => i.state === "awaiting_review").length,
    actionCompletionRate: rate(completedActions.length, actions.length),
    stageAdvancementCount: actions.filter((a) => a.advancedToStage !== null).length,
    staffProfiles,
    playbookEffectiveness,
  };
}
