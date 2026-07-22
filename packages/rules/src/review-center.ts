/**
 * Human Review Center kernel (review_center.v1.0.0) — founder directive
 * 2026-07-20 + continuation 2026-07-22.
 *
 * The unified, deterministic review lifecycle every reviewable artifact moves
 * through. The Review Center is a COORDINATION LAYER, not a second system of
 * record: a ReviewItem references its artifact (type + id + version) and this
 * kernel governs only the review lifecycle — existing domain kernels
 * (roadmap.v1, report.v1, document.v1, …) stay authoritative for their tables
 * and are BRIDGED via pure mappings in the store, never duplicated.
 *
 * Structural guarantees (the allow-list, not a runtime check, enforces them):
 *   - `draft → published` does not exist.
 *   - `awaiting_review → published` does not exist — publication is only
 *     reachable THROUGH `approved`, so high-impact AI output can never become
 *     client-visible without an explicit authorized human approval.
 *   - `rejected`, `deferred`, `withdrawn`, `superseded` are terminal; a revised
 *     attempt is a NEW ReviewItem linked via `previousReviewItemId`, never a
 *     resurrection (append-only history, the report-kernel principle).
 *   - There is NO "return for edits" edge (the directive's model has none): an
 *     author revises by WITHDRAWING their item and submitting a new linked one,
 *     and every exit from `awaiting_review` is a structured decision or a
 *     withdrawal/supersession — nothing leaves the queue without a recorded,
 *     reason-coded action (the feedback data the moat depends on).
 *   - `escalated` is a DECISION, not a state: the item stays `awaiting_review`
 *     with the required reviewer role raised one rank.
 *
 * Naming: `review.v1.0.0` / `RC_` / `ReviewStatus` are already owned by the
 * readiness review gate, the readiness reason codes, and the @aflo/ai envelope
 * respectively — this kernel uses `review_center.v1.0.0`, `RVC_`/`RVD_`
 * prefixes, and `ReviewItemState`, and never re-exports a second
 * `ReviewStatus`.
 *
 * PURE and deterministic — no I/O, no clock, inputs never mutated. WHO may
 * call the store methods that consume this kernel is the authorization
 * engine's job; `canReview` adds the review-specific policy (role floor +
 * separation of duties) on top, deny-by-default.
 */

export const REVIEW_CENTER_RULES_VERSION = "review_center.v1.0.0";

// --- Vocabularies (kernel-owned; DB enums derive from these via tuple()) ----

export const REVIEW_ITEM_STATES = [
  "draft",
  "awaiting_review",
  "approved",
  "published",
  "rejected",
  "deferred",
  "withdrawn",
  "superseded",
] as const;
export type ReviewItemState = (typeof REVIEW_ITEM_STATES)[number];

/** The ten founder-directed review queues. */
export const REVIEW_ARTIFACT_TYPES = [
  "readiness_assessment",
  "roadmap_draft",
  "concierge_recommendation",
  "document_interpretation",
  "financial_summary",
  "educational_assignment",
  "partner_referral",
  "client_communication",
  "quarterly_report",
  "stage_advancement",
] as const;
export type ReviewArtifactType = (typeof REVIEW_ARTIFACT_TYPES)[number];

/** Reuses the AGENT_BOUNDARIES impact vocabulary so envelopes and items speak one language. */
export const REVIEW_RISK_CLASSES = ["low", "medium", "high"] as const;
export type ReviewRiskClass = (typeof REVIEW_RISK_CLASSES)[number];

/**
 * Ordered reviewer ranks — the subset of member roles that may review.
 * `client` and `partner_viewer` are never reviewers; Platform Admin holds no
 * tenant membership (approvals belong to the tenant — AUTHORIZATION_MATRIX
 * footnote a) and the Worker service passes a null role (footnote e).
 */
export const REVIEWER_ROLES = ["staff", "organization_admin", "organization_owner"] as const;
export type ReviewerRole = (typeof REVIEWER_ROLES)[number];

/** The five structured review decisions (founder directive, verbatim set). */
export const REVIEW_DECISIONS = [
  "approved_unchanged",
  "approved_with_edits",
  "rejected",
  "escalated",
  "deferred",
] as const;
export type ReviewDecision = (typeof REVIEW_DECISIONS)[number];

// --- Reason codes -----------------------------------------------------------

export type ReviewCenterReasonCode =
  | "RVC_SUBMITTED"
  | "RVC_APPROVED"
  | "RVC_APPROVED_WITH_EDITS"
  | "RVC_REJECTED"
  | "RVC_DEFERRED"
  | "RVC_ESCALATED"
  | "RVC_PUBLISHED"
  | "RVC_WITHDRAWN"
  | "RVC_SUPERSEDED"
  | "RVC_REVIEW_ALLOWED"
  | "RVC_SAME_STATE"
  | "RVC_UNKNOWN_STATE"
  | "RVC_ILLEGAL_TRANSITION"
  | "RVC_NOT_AWAITING_REVIEW"
  | "RVC_UNKNOWN_DECISION"
  | "RVC_INVALID_REASON_CODE"
  | "RVC_MISSING_MODIFICATIONS"
  | "RVC_UNEXPECTED_MODIFICATIONS"
  | "RVC_INVALID_MODIFICATION_COUNT"
  | "RVC_ESCALATION_CEILING"
  | "RVC_REVIEWER_NOT_MEMBER"
  | "RVC_ROLE_NOT_REVIEWER"
  | "RVC_INSUFFICIENT_ROLE"
  | "RVC_SELF_REVIEW_DENIED";

/**
 * Structured decision reason codes (founder: "reason codes must be
 * structured"). Each is valid for a declared decision set; the edit-category
 * codes double as the feedback engine's edit taxonomy.
 */
export const REVIEW_DECISION_REASON_CODES = {
  RVD_ACCURATE: {
    decisions: ["approved_unchanged"],
    description: "Content is accurate and appropriate as drafted.",
  },
  RVD_EDITED_TONE: {
    decisions: ["approved_with_edits"],
    description: "Tone/wording adjusted for the client relationship.",
  },
  RVD_EDITED_FACTS: {
    decisions: ["approved_with_edits"],
    description: "Factual details corrected before approval.",
  },
  RVD_EDITED_SCOPE: {
    decisions: ["approved_with_edits"],
    description: "Scope narrowed or expanded (actions added/removed).",
  },
  RVD_EDITED_COMPLIANCE: {
    decisions: ["approved_with_edits"],
    description: "Wording adjusted to stay inside compliance boundaries.",
  },
  RVD_INACCURATE_FACTS: {
    decisions: ["rejected"],
    description: "Built on inaccurate facts; a corrected item must be re-created.",
  },
  RVD_STALE_FACTS: {
    decisions: ["rejected", "deferred"],
    description: "Source facts are stale; refresh before re-proposing.",
  },
  RVD_WRONG_CLIENT_CONTEXT: {
    decisions: ["rejected"],
    description: "Does not fit this client's situation or timing.",
  },
  RVD_COMPLIANCE_RISK: {
    decisions: ["rejected", "escalated"],
    description: "Raises a compliance concern beyond editing.",
  },
  RVD_NOT_APPROPRIATE_NOW: {
    decisions: ["rejected", "deferred"],
    description: "Not the right intervention at this point in the roadmap.",
  },
  RVD_AWAITING_CLIENT_INPUT: {
    decisions: ["deferred"],
    description: "Cannot be decided until the client responds.",
  },
  RVD_AWAITING_DOCUMENT: {
    decisions: ["deferred"],
    description: "Cannot be decided until a document arrives or is verified.",
  },
  RVD_AWAITING_STAFF_CAPACITY: {
    decisions: ["deferred"],
    description: "Parked for capacity; revisit at the next review pass.",
  },
  RVD_NEEDS_SENIOR_REVIEW: {
    decisions: ["escalated"],
    description: "Judgment call above this reviewer's remit.",
  },
  RVD_POLICY_QUESTION: {
    decisions: ["escalated"],
    description: "Exposes an unresolved org policy question.",
  },
} as const satisfies Record<string, { decisions: readonly ReviewDecision[]; description: string }>;

export type ReviewDecisionReasonCode = keyof typeof REVIEW_DECISION_REASON_CODES;

/** Is this structured reason code declared valid for this decision? */
export function isDecisionReasonValid(decision: ReviewDecision, reasonCode: string): boolean {
  const entry = (REVIEW_DECISION_REASON_CODES as Record<string, { decisions: readonly ReviewDecision[] }>)[
    reasonCode
  ];
  return entry !== undefined && entry.decisions.includes(decision);
}

// --- State machine ----------------------------------------------------------

/** Allow-list: every legal move and the reason code that names it (roadmap-kernel idiom). */
const ALLOWED: Record<ReviewItemState, Partial<Record<ReviewItemState, ReviewCenterReasonCode>>> = {
  draft: {
    awaiting_review: "RVC_SUBMITTED",
    withdrawn: "RVC_WITHDRAWN",
    superseded: "RVC_SUPERSEDED",
  },
  awaiting_review: {
    approved: "RVC_APPROVED",
    rejected: "RVC_REJECTED",
    deferred: "RVC_DEFERRED",
    withdrawn: "RVC_WITHDRAWN",
    superseded: "RVC_SUPERSEDED",
  },
  approved: {
    published: "RVC_PUBLISHED",
    superseded: "RVC_SUPERSEDED",
  },
  published: {
    superseded: "RVC_SUPERSEDED",
  },
  rejected: {},
  deferred: {},
  withdrawn: {},
  superseded: {},
};

export interface ReviewItemTransitionResult {
  allowed: boolean;
  fromState: string;
  toState: string;
  reasonCode: ReviewCenterReasonCode;
  ruleVersion: string;
}

/** Validate one state move. Deny-by-default: anything not allow-listed is illegal. */
export function reviewItemTransition(fromState: string, toState: string): ReviewItemTransitionResult {
  const base = { fromState, toState, ruleVersion: REVIEW_CENTER_RULES_VERSION };
  const known = (s: string): s is ReviewItemState => (REVIEW_ITEM_STATES as readonly string[]).includes(s);
  if (!known(fromState) || !known(toState)) {
    return { ...base, allowed: false, reasonCode: "RVC_UNKNOWN_STATE" };
  }
  if (fromState === toState) return { ...base, allowed: false, reasonCode: "RVC_SAME_STATE" };
  const code = ALLOWED[fromState][toState];
  if (!code) return { ...base, allowed: false, reasonCode: "RVC_ILLEGAL_TRANSITION" };
  return { ...base, allowed: true, reasonCode: code };
}

/** Legal forward targets from a state, for UIs that offer only legal moves. */
export function reviewTransitionsFrom(state: ReviewItemState): ReviewItemState[] {
  return Object.keys(ALLOWED[state]) as ReviewItemState[];
}

/** Terminal states — no exits; a follow-up is a NEW linked ReviewItem. */
export function isTerminalReviewState(state: ReviewItemState): boolean {
  return Object.keys(ALLOWED[state]).length === 0;
}

// --- Decisions --------------------------------------------------------------

export interface ApplyReviewDecisionInput {
  decision: string;
  /** The item's current state — decisions are only legal from awaiting_review. */
  fromState: string;
  /** Count of recorded field modifications accompanying the decision. */
  modifiedFieldCount: number;
  /** Structured reason code (RVD_*) — must be declared valid for the decision. */
  decisionReasonCode: string;
  /**
   * The item's CURRENT required reviewer role — used by `escalated` to compute
   * the raised floor and to DENY escalation at the ceiling (an
   * organization_owner-level item has nowhere to escalate).
   */
  requiredReviewerRole: ReviewerRole;
}

export interface ReviewDecisionResult {
  allowed: boolean;
  decision: string;
  fromState: string;
  /** The state after the decision; unchanged for `escalated` and for any denial. */
  toState: string;
  /** For an allowed `escalated` decision: the raised required reviewer role. */
  escalatedToRole?: ReviewerRole;
  reasonCode: ReviewCenterReasonCode;
  ruleVersion: string;
}

/** What each decision does to the state. `escalated` deliberately stays put. */
const DECISION_TO_STATE: Record<ReviewDecision, ReviewItemState> = {
  approved_unchanged: "approved",
  approved_with_edits: "approved",
  rejected: "rejected",
  deferred: "deferred",
  escalated: "awaiting_review",
};

const DECISION_TO_CODE: Record<ReviewDecision, ReviewCenterReasonCode> = {
  approved_unchanged: "RVC_APPROVED",
  approved_with_edits: "RVC_APPROVED_WITH_EDITS",
  rejected: "RVC_REJECTED",
  deferred: "RVC_DEFERRED",
  escalated: "RVC_ESCALATED",
};

/**
 * Apply one of the five structured decisions. Fail-closed validation order:
 * state known → item is awaiting_review → decision known → reason code valid
 * for the decision → modification count well-formed (a non-negative integer) →
 * modifications paired correctly (approved_unchanged must carry none;
 * approved_with_edits must carry at least one — the kernel makes "edited but
 * recorded as unchanged" and "unchanged but recorded as edited" both
 * unrepresentable, which is what keeps the feedback data trustworthy) →
 * escalation has somewhere to go (an organization_owner-level item is at the
 * ceiling and CANNOT be escalated — `RVC_ESCALATION_CEILING`). An allowed
 * `escalated` result carries `escalatedToRole`, the raised floor the store
 * must persist.
 */
export function applyReviewDecision(input: ApplyReviewDecisionInput): ReviewDecisionResult {
  const base = {
    decision: input.decision,
    fromState: input.fromState,
    toState: input.fromState,
    ruleVersion: REVIEW_CENTER_RULES_VERSION,
  };
  const knownState = (REVIEW_ITEM_STATES as readonly string[]).includes(input.fromState);
  if (!knownState) return { ...base, allowed: false, reasonCode: "RVC_UNKNOWN_STATE" };
  if (input.fromState !== "awaiting_review") {
    return { ...base, allowed: false, reasonCode: "RVC_NOT_AWAITING_REVIEW" };
  }
  const knownDecision = (REVIEW_DECISIONS as readonly string[]).includes(input.decision);
  if (!knownDecision) return { ...base, allowed: false, reasonCode: "RVC_UNKNOWN_DECISION" };
  const decision = input.decision as ReviewDecision;
  if (!isDecisionReasonValid(decision, input.decisionReasonCode)) {
    return { ...base, allowed: false, reasonCode: "RVC_INVALID_REASON_CODE" };
  }
  if (!Number.isInteger(input.modifiedFieldCount) || input.modifiedFieldCount < 0) {
    return { ...base, allowed: false, reasonCode: "RVC_INVALID_MODIFICATION_COUNT" };
  }
  if (decision === "approved_unchanged" && input.modifiedFieldCount > 0) {
    return { ...base, allowed: false, reasonCode: "RVC_UNEXPECTED_MODIFICATIONS" };
  }
  if (decision === "approved_with_edits" && input.modifiedFieldCount === 0) {
    return { ...base, allowed: false, reasonCode: "RVC_MISSING_MODIFICATIONS" };
  }
  if (decision === "escalated") {
    const raised = escalateReviewerRole(input.requiredReviewerRole);
    if (raised === null) return { ...base, allowed: false, reasonCode: "RVC_ESCALATION_CEILING" };
    return {
      ...base,
      allowed: true,
      toState: DECISION_TO_STATE[decision],
      escalatedToRole: raised,
      reasonCode: DECISION_TO_CODE[decision],
    };
  }
  return {
    ...base,
    allowed: true,
    toState: DECISION_TO_STATE[decision],
    reasonCode: DECISION_TO_CODE[decision],
  };
}

// --- Reviewer policy --------------------------------------------------------

const ROLE_RANK: Record<ReviewerRole, number> = {
  staff: 0,
  organization_admin: 1,
  organization_owner: 2,
};

/** The next rank up for an escalation, or null at the ceiling (owner). */
export function escalateReviewerRole(current: ReviewerRole): ReviewerRole | null {
  const next = REVIEWER_ROLES[ROLE_RANK[current] + 1];
  return next ?? null;
}

export interface ReviewPolicy {
  riskClassification: ReviewRiskClass;
  requiredReviewerRole: ReviewerRole;
}

/**
 * Baseline policy per artifact type — the founder continuation directive's risk
 * tiers (FOUNDER_DIRECTIVE_2026-07-20 §9), verbatim: HIGH = readiness-stage
 * changes, credit-related guidance, financial-summary publication, document
 * interpretation, partner referral, stage advancement, and any legal-, tax-,
 * lending-, investment-, or eligibility-adjacent output. `partner_referral` is
 * the one queue Staff cannot approve — referral approval is OO/OA-reserved in
 * AUTHORIZATION_MATRIX §4.
 *
 * `roadmap_draft`, `client_communication`, and `quarterly_report` sit in or
 * above their directive tier (raising is always allowed; lowering never is).
 * `concierge_recommendation` is not named by §9 but is the flagship guidance
 * surface and routinely credit/eligibility-adjacent, so it defaults into the
 * §9 catch-all as HIGH — flagged for explicit founder confirmation; an org
 * override can only raise it further, and any lowering is a founder/kernel
 * decision, not configuration.
 */
export const DEFAULT_REVIEW_POLICIES: Record<ReviewArtifactType, ReviewPolicy> = {
  readiness_assessment: { riskClassification: "high", requiredReviewerRole: "staff" },
  roadmap_draft: { riskClassification: "high", requiredReviewerRole: "staff" },
  concierge_recommendation: { riskClassification: "high", requiredReviewerRole: "staff" },
  document_interpretation: { riskClassification: "high", requiredReviewerRole: "staff" },
  financial_summary: { riskClassification: "high", requiredReviewerRole: "staff" },
  educational_assignment: { riskClassification: "medium", requiredReviewerRole: "staff" },
  partner_referral: { riskClassification: "high", requiredReviewerRole: "organization_admin" },
  client_communication: { riskClassification: "high", requiredReviewerRole: "staff" },
  quarterly_report: { riskClassification: "high", requiredReviewerRole: "staff" },
  stage_advancement: { riskClassification: "high", requiredReviewerRole: "staff" },
};

const RISK_RANK: Record<ReviewRiskClass, number> = { low: 0, medium: 1, high: 2 };

/**
 * Resolve the effective policy for an artifact type. An org override may only
 * RAISE the floor (stricter risk class or higher required role) — a lowering
 * attempt is silently clamped to the kernel baseline, so no tenant
 * configuration can weaken the review gate.
 */
export function resolveReviewPolicy(
  artifactType: ReviewArtifactType,
  override?: Partial<ReviewPolicy>,
): ReviewPolicy {
  const base = DEFAULT_REVIEW_POLICIES[artifactType];
  const risk =
    override?.riskClassification !== undefined &&
    RISK_RANK[override.riskClassification] > RISK_RANK[base.riskClassification]
      ? override.riskClassification
      : base.riskClassification;
  const role =
    override?.requiredReviewerRole !== undefined &&
    ROLE_RANK[override.requiredReviewerRole] > ROLE_RANK[base.requiredReviewerRole]
      ? override.requiredReviewerRole
      : base.requiredReviewerRole;
  return { riskClassification: risk, requiredReviewerRole: role };
}

export interface CanReviewInput {
  riskClassification: ReviewRiskClass;
  requiredReviewerRole: ReviewerRole;
  /**
   * The reviewer's ORG MEMBERSHIP role, or null when the actor has none —
   * Worker service, Platform Admin (no tenant membership by design), and any
   * unauthenticated path all land here and are denied.
   */
  reviewerRole: string | null;
  reviewerMemberId: string;
  /** The item's author (null = system/orchestrator-created). */
  authorMemberId: string | null;
}

export interface CanReviewResult {
  allowed: boolean;
  reasonCode: ReviewCenterReasonCode;
  ruleVersion: string;
}

/**
 * Review-specific authorization policy, deny-by-default, applied ON TOP of the
 * authorization engine (which decides org membership and permissions first):
 * membership required → role must be a reviewer role → rank must meet the
 * floor → high-risk items enforce separation of duties (no self-review).
 */
export function canReview(input: CanReviewInput): CanReviewResult {
  const base = { ruleVersion: REVIEW_CENTER_RULES_VERSION };
  if (input.reviewerRole === null) {
    return { ...base, allowed: false, reasonCode: "RVC_REVIEWER_NOT_MEMBER" };
  }
  if (!(REVIEWER_ROLES as readonly string[]).includes(input.reviewerRole)) {
    return { ...base, allowed: false, reasonCode: "RVC_ROLE_NOT_REVIEWER" };
  }
  const rank = ROLE_RANK[input.reviewerRole as ReviewerRole];
  if (rank < ROLE_RANK[input.requiredReviewerRole]) {
    return { ...base, allowed: false, reasonCode: "RVC_INSUFFICIENT_ROLE" };
  }
  if (
    input.riskClassification === "high" &&
    input.authorMemberId !== null &&
    input.reviewerMemberId === input.authorMemberId
  ) {
    return { ...base, allowed: false, reasonCode: "RVC_SELF_REVIEW_DENIED" };
  }
  return { ...base, allowed: true, reasonCode: "RVC_REVIEW_ALLOWED" };
}
