import { LIFECYCLE_STAGES, type LifecycleStage } from "./lifecycle";
import {
  REVIEW_ARTIFACT_TYPES,
  REVIEW_ITEM_STATES,
  REVIEW_RISK_CLASSES,
  REVIEWER_ROLES,
  resolveReviewPolicy,
  type ReviewArtifactType,
  type ReviewItemState,
  type ReviewRiskClass,
  type ReviewerRole,
} from "./review-center";

/**
 * Professional Playbook kernel (playbook.v1.0.0) — Strategic Product
 * Differentiation directive 2026-07-20 + continuation 2026-07-22, Workstream A
 * slice 2. Playbooks are VERSIONED TENANT IP: the codified, reviewable form of
 * a professional's actual working method. Three deterministic machines:
 *
 *  1. PLAYBOOK VERSION LIFECYCLE — reuses the Review Center's state VOCABULARY
 *     verbatim (`PlaybookVersionStatus` IS `ReviewItemState`; one vocabulary,
 *     no drift) with its own allow-list and `PB_` codes. Same structural
 *     guarantees as review_center.v1.0.0: `published` is reachable ONLY
 *     through `approved`; terminals never exit; there is NO return-for-edits
 *     edge — revising a submitted/decided version means a NEW version (natural
 *     for append-only versioned content). Publishing version N+1 supersedes
 *     version N (the store performs both transitions atomically).
 *
 *  2. FIELD PROVENANCE — the anti-invention control (founder: "Do not invent
 *     Natalia's exact process"). Every content field carries exactly one of
 *     `confirmed` / `assumption` / `discovery_required` / `approved`;
 *     `validatePlaybookContent` rejects content whose provenance map is not
 *     exhaustive, and `contentBlocksApproval` names the fields that MUST be
 *     resolved before a version may be approved/published — a playbook can be
 *     drafted and edited full of open questions, but it can never present an
 *     unresolved question to staff as settled process.
 *
 *  3. WORKFLOW DISCOVERY — the queue of concrete questions for the founder
 *     (`open → answered → converted`; `dismissed`/reopen). Every
 *     `discovery_required` field is backed by a discovery item; `converted`
 *     records the playbook version that absorbed the answer.
 *
 * Pure and deterministic throughout; persistence, authorization (who may
 * author/approve — OA/OO approve per the matrix, final call founder-flagged in
 * the discovery queue), and store wiring land in later slices.
 */

export const PLAYBOOK_RULES_VERSION = "playbook.v1.0.0";

// --- 1. Version lifecycle ---------------------------------------------------

/** Same strings as ReviewItemState — one review vocabulary across the product. */
export const PLAYBOOK_VERSION_STATUSES = REVIEW_ITEM_STATES;
export type PlaybookVersionStatus = ReviewItemState;

export type PlaybookReasonCode =
  | "PB_SUBMITTED"
  | "PB_APPROVED"
  | "PB_REJECTED"
  | "PB_DEFERRED"
  | "PB_PUBLISHED"
  | "PB_WITHDRAWN"
  | "PB_SUPERSEDED"
  | "PB_SAME_STATUS"
  | "PB_UNKNOWN_STATUS"
  | "PB_ILLEGAL_TRANSITION"
  // Actor policy (founder decision 2026-07-23, #2 — author/approver
  // separation), emitted by `canActOnPlaybookVersion`:
  | "PB_ACTION_ALLOWED"
  | "PB_OWNER_OVERRIDE"
  | "PB_NO_MEMBERSHIP"
  | "PB_ROLE_INSUFFICIENT"
  | "PB_AUTHOR_PUBLISHER_SEPARATION"
  | "PB_AUTHOR_APPROVER_SEPARATION"
  | "PB_OVERRIDE_NOT_PERMITTED"
  | "PB_OVERRIDE_REASON_REQUIRED";

const ALLOWED: Record<PlaybookVersionStatus, Partial<Record<PlaybookVersionStatus, PlaybookReasonCode>>> = {
  draft: { awaiting_review: "PB_SUBMITTED", withdrawn: "PB_WITHDRAWN", superseded: "PB_SUPERSEDED" },
  awaiting_review: {
    approved: "PB_APPROVED",
    rejected: "PB_REJECTED",
    deferred: "PB_DEFERRED",
    withdrawn: "PB_WITHDRAWN",
    superseded: "PB_SUPERSEDED",
  },
  approved: { published: "PB_PUBLISHED", superseded: "PB_SUPERSEDED" },
  published: { superseded: "PB_SUPERSEDED" },
  rejected: {},
  deferred: {},
  withdrawn: {},
  superseded: {},
};

export interface PlaybookVersionTransitionResult {
  allowed: boolean;
  fromStatus: string;
  toStatus: string;
  reasonCode: PlaybookReasonCode;
  ruleVersion: string;
}

export function playbookVersionTransition(fromStatus: string, toStatus: string): PlaybookVersionTransitionResult {
  const base = { fromStatus, toStatus, ruleVersion: PLAYBOOK_RULES_VERSION };
  const known = (s: string): s is PlaybookVersionStatus =>
    (PLAYBOOK_VERSION_STATUSES as readonly string[]).includes(s);
  if (!known(fromStatus) || !known(toStatus)) {
    return { ...base, allowed: false, reasonCode: "PB_UNKNOWN_STATUS" };
  }
  if (fromStatus === toStatus) return { ...base, allowed: false, reasonCode: "PB_SAME_STATUS" };
  const code = ALLOWED[fromStatus][toStatus];
  if (!code) return { ...base, allowed: false, reasonCode: "PB_ILLEGAL_TRANSITION" };
  return { ...base, allowed: true, reasonCode: code };
}

export function playbookVersionTransitionsFrom(status: PlaybookVersionStatus): PlaybookVersionStatus[] {
  return Object.keys(ALLOWED[status]) as PlaybookVersionStatus[];
}

// --- 1b. Actor policy (founder decision 2026-07-23, #2 — verbatim) ----------
//
// "Staff Advisor may draft and revise. Organization Admin may review and
// approve. Organization Owner may publish organization-wide playbooks. The
// same person may not both author and publish a playbook version. High-impact
// playbooks require separate author and approver identities. Platform Admin
// may not approve or publish tenant content. Clients have no access to drafts
// or internal review state. Where a tenant has only one authorized operator,
// the system may allow a documented owner override only if: an explicit
// reason is recorded; the override is audited; the content is not regulated
// professional advice; the override is visible in review history; the
// organization policy permits it."

export const PLAYBOOK_ACTIONS = ["draft", "revise", "submit", "approve", "publish"] as const;
export type PlaybookAction = (typeof PLAYBOOK_ACTIONS)[number];

const PLAYBOOK_ROLE_RANK: Record<ReviewerRole, number> = {
  staff: 0,
  organization_admin: 1,
  organization_owner: 2,
};

/** Minimum membership rank per action: draft/revise/submit = staff+, approve = OA+, publish = OO. */
const PLAYBOOK_ACTION_FLOOR: Record<PlaybookAction, number> = {
  draft: PLAYBOOK_ROLE_RANK.staff,
  revise: PLAYBOOK_ROLE_RANK.staff,
  submit: PLAYBOOK_ROLE_RANK.staff,
  approve: PLAYBOOK_ROLE_RANK.organization_admin,
  publish: PLAYBOOK_ROLE_RANK.organization_owner,
};

/**
 * The documented single-operator owner override. `attestsNotRegulatedAdvice`
 * is the literal `true` — the type cannot even represent an override that
 * fails to attest the content is not regulated professional advice (the
 * runtime check still enforces it for untyped callers).
 */
export interface PlaybookOwnerOverride {
  reason: string;
  attestsNotRegulatedAdvice: true;
}

export interface CanActOnPlaybookVersionInput {
  action: PlaybookAction;
  /**
   * The actor's ORG MEMBERSHIP reviewer role, or null when the actor has no
   * qualifying membership — Worker service, Platform Admin (structurally no
   * tenant membership; may never approve or publish tenant content), clients,
   * and partner viewers all land here and are ALWAYS denied.
   */
  actorRole: ReviewerRole | null;
  /** Is the actor the version's author? */
  actorIsAuthor: boolean;
  /** High-impact iff the content carries any `high`-risk review checkpoint (see isHighImpactPlaybookContent). */
  highImpact: boolean;
  /** Non-null = the actor invokes the documented single-operator owner override. */
  ownerOverride: PlaybookOwnerOverride | null;
  /** The organization's `allowSingleOperatorPlaybookOverride` policy flag (default false). */
  orgPolicyPermitsOverride: boolean;
}

export interface CanActOnPlaybookVersionResult {
  allowed: boolean;
  reasonCode: PlaybookReasonCode;
  /**
   * True only when the allow came THROUGH the owner override
   * (reasonCode `PB_OWNER_OVERRIDE`) — the store MUST record the override
   * (reason + audit + review history) whenever this is set.
   */
  usedOwnerOverride: boolean;
  ruleVersion: string;
}

/**
 * Deterministic actor policy for playbook version actions, deny-by-default.
 * Order: membership required → role floor per action (never relaxed by the
 * override) → separation of duties: the author may NEVER publish their own
 * version (`PB_AUTHOR_PUBLISHER_SEPARATION`), and a HIGH-IMPACT version
 * requires an approver who is not its author (`PB_AUTHOR_APPROVER_SEPARATION`).
 * The owner override relaxes ONLY the separation rules, ONLY for an
 * `organization_owner`, and ONLY when the org policy permits it AND the
 * override carries a non-empty reason AND attests the content is not
 * regulated professional advice — allowed then as `PB_OWNER_OVERRIDE` with
 * `usedOwnerOverride: true` so the store records + audits it and it stays
 * visible in review history.
 */
export function canActOnPlaybookVersion(input: CanActOnPlaybookVersionInput): CanActOnPlaybookVersionResult {
  const base = { usedOwnerOverride: false, ruleVersion: PLAYBOOK_RULES_VERSION };
  if (input.actorRole === null || !(REVIEWER_ROLES as readonly string[]).includes(input.actorRole)) {
    return { ...base, allowed: false, reasonCode: "PB_NO_MEMBERSHIP" };
  }
  if (PLAYBOOK_ROLE_RANK[input.actorRole] < PLAYBOOK_ACTION_FLOOR[input.action]) {
    return { ...base, allowed: false, reasonCode: "PB_ROLE_INSUFFICIENT" };
  }

  const separationViolation: PlaybookReasonCode | null =
    input.action === "publish" && input.actorIsAuthor
      ? "PB_AUTHOR_PUBLISHER_SEPARATION"
      : input.action === "approve" && input.highImpact && input.actorIsAuthor
        ? "PB_AUTHOR_APPROVER_SEPARATION"
        : null;

  if (separationViolation === null) {
    return { ...base, allowed: true, reasonCode: "PB_ACTION_ALLOWED" };
  }

  // Only the documented owner override can relax a separation rule, and only
  // for an organization_owner (the single-operator case the founder named).
  if (input.ownerOverride === null || input.actorRole !== "organization_owner") {
    return { ...base, allowed: false, reasonCode: separationViolation };
  }
  if (!input.orgPolicyPermitsOverride) {
    return { ...base, allowed: false, reasonCode: "PB_OVERRIDE_NOT_PERMITTED" };
  }
  if (
    input.ownerOverride.reason.trim().length === 0 ||
    input.ownerOverride.attestsNotRegulatedAdvice !== true
  ) {
    return { ...base, allowed: false, reasonCode: "PB_OVERRIDE_REASON_REQUIRED" };
  }
  return { allowed: true, reasonCode: "PB_OWNER_OVERRIDE", usedOwnerOverride: true, ruleVersion: PLAYBOOK_RULES_VERSION };
}

/**
 * Deterministic high-impact definition (founder decision 2026-07-23, #2 —
 * resolved default): a playbook version is high-impact iff its content's
 * `humanReviewCheckpoints` contains any checkpoint with
 * `riskClassification: "high"`.
 */
export function isHighImpactPlaybookContent(content: PlaybookContent): boolean {
  return content.humanReviewCheckpoints.some((cp) => cp.riskClassification === "high");
}

// --- 2. Content + field provenance ------------------------------------------

/** The provenance of one playbook field (continuation directive §9, verbatim set). */
export const FIELD_PROVENANCE_STATES = ["confirmed", "assumption", "discovery_required", "approved"] as const;
export type FieldProvenance = (typeof FIELD_PROVENANCE_STATES)[number];

/** Every content field that carries provenance — exhaustive, validator-enforced. */
export const PLAYBOOK_CONTENT_FIELDS = [
  "purpose",
  "applicableStages",
  "triggeringConditions",
  "requiredFacts",
  "requiredDocuments",
  "calculations",
  "questionSequence",
  "educationContent",
  "recommendedActions",
  "prohibitedActions",
  "humanReviewCheckpoints",
  "escalationCriteria",
  "completionEvidence",
  "outcomeMetrics",
] as const;
export type PlaybookContentFieldKey = (typeof PLAYBOOK_CONTENT_FIELDS)[number];

export const PLAYBOOK_TRIGGER_KINDS = ["reason_code", "engagement_status", "fact_threshold", "manual"] as const;
export type PlaybookTriggerKind = (typeof PLAYBOOK_TRIGGER_KINDS)[number];

export interface PlaybookTrigger {
  kind: PlaybookTriggerKind;
  value: string;
  /** Registry rule id backing a `fact_threshold` trigger (required for that kind). */
  ruleId?: string;
}

export interface PlaybookReviewCheckpoint {
  id: string;
  /**
   * The content step this checkpoint follows — must reference an existing
   * recommendedActions id or questionSequence id (validator-enforced).
   */
  afterStep: string;
  artifactType: ReviewArtifactType;
  riskClassification: ReviewRiskClass;
  requiredReviewerRole: ReviewerRole;
}

export interface PlaybookEscalationCriterion {
  id: string;
  condition: string;
  escalateToRole: ReviewerRole;
}

/**
 * The typed playbook content (the founder's field list). Vocabulary notes:
 * `requiredDocuments` carries `document_type` values and `recommendedActions`
 * category carries `MonthlyActionCategory` values — both owned by @aflo/shared,
 * so they are validated as non-empty strings HERE and against their
 * vocabularies at the store boundary (rules cannot depend on shared).
 */
export interface PlaybookContent {
  purpose: string;
  applicableStages: LifecycleStage[];
  triggeringConditions: PlaybookTrigger[];
  requiredFacts: string[];
  requiredDocuments: string[];
  /** Registry rule ids ONLY (e.g. "readiness.utilization") — never inline math. */
  calculations: string[];
  questionSequence: { id: string; prompt: string; capturesFactKey: string | null }[];
  educationContent: string[];
  recommendedActions: { id: string; summary: string; category: string }[];
  prohibitedActions: string[];
  humanReviewCheckpoints: PlaybookReviewCheckpoint[];
  escalationCriteria: PlaybookEscalationCriterion[];
  completionEvidence: string[];
  outcomeMetrics: string[];
  /** Exactly one provenance per content field — the anti-invention record. */
  fieldProvenance: Record<PlaybookContentFieldKey, FieldProvenance>;
}

/**
 * Structural validation (the `validatePipelineDefinition` idiom): returns a
 * list of human-readable errors; empty = structurally valid. Registry-id
 * existence for `calculations` is checked at the store boundary (the registry
 * lives beside this kernel, but seed content must validate before the registry
 * grows every referenced rule — the store re-validates with `getRule`).
 */
export function validatePlaybookContent(content: PlaybookContent): string[] {
  const errors: string[] = [];

  if (content.purpose.trim().length === 0) errors.push("purpose must be non-empty");

  if (content.applicableStages.length === 0) errors.push("applicableStages must be non-empty");
  for (const stage of content.applicableStages) {
    if (!(LIFECYCLE_STAGES as readonly string[]).includes(stage)) {
      errors.push(`applicableStages: unknown lifecycle stage "${stage}"`);
    }
  }

  for (const trigger of content.triggeringConditions) {
    if (!(PLAYBOOK_TRIGGER_KINDS as readonly string[]).includes(trigger.kind)) {
      errors.push(`triggeringConditions: unknown kind "${trigger.kind}"`);
    }
    if (trigger.value.trim().length === 0) errors.push("triggeringConditions: value must be non-empty");
    if (trigger.kind === "fact_threshold" && (trigger.ruleId === undefined || trigger.ruleId.trim().length === 0)) {
      errors.push("triggeringConditions: fact_threshold triggers must name a backing ruleId");
    }
  }

  // Every string-list field must contain trimmed-non-empty entries — the
  // contract the PlaybookContent doc comment promises (vocabulary membership
  // for shared-owned strings is checked at the store boundary).
  const stringLists: [string, string[]][] = [
    ["requiredFacts", content.requiredFacts],
    ["requiredDocuments", content.requiredDocuments],
    ["educationContent", content.educationContent],
    ["completionEvidence", content.completionEvidence],
    ["outcomeMetrics", content.outcomeMetrics],
    ["prohibitedActions", content.prohibitedActions],
  ];
  for (const [field, entries] of stringLists) {
    for (const entry of entries) {
      if (entry.trim().length === 0) errors.push(`${field}: entries must be non-empty`);
    }
  }

  for (const calc of content.calculations) {
    if (calc.trim().length === 0) errors.push("calculations: rule id must be non-empty");
  }

  const questionIds = new Set<string>();
  for (const q of content.questionSequence) {
    if (q.id.trim().length === 0) errors.push("questionSequence: id must be non-empty");
    if (q.prompt.trim().length === 0) errors.push(`questionSequence: prompt for "${q.id}" must be non-empty`);
    if (questionIds.has(q.id)) errors.push(`questionSequence: duplicate id "${q.id}"`);
    questionIds.add(q.id);
  }

  const actionIds = new Set<string>();
  for (const action of content.recommendedActions) {
    if (action.id.trim().length === 0) errors.push("recommendedActions: id must be non-empty");
    if (action.summary.trim().length === 0) {
      errors.push(`recommendedActions: summary for "${action.id}" must be non-empty`);
    }
    if (action.category.trim().length === 0) {
      errors.push(`recommendedActions: category for "${action.id}" must be non-empty`);
    }
    if (actionIds.has(action.id)) errors.push(`recommendedActions: duplicate id "${action.id}"`);
    actionIds.add(action.id);
  }

  if (content.prohibitedActions.length === 0) {
    errors.push("prohibitedActions must be non-empty (every playbook names what it must never do)");
  }

  const checkpointIds = new Set<string>();
  for (const cp of content.humanReviewCheckpoints) {
    if (cp.id.trim().length === 0) errors.push("humanReviewCheckpoints: id must be non-empty");
    if (checkpointIds.has(cp.id)) errors.push(`humanReviewCheckpoints: duplicate id "${cp.id}"`);
    checkpointIds.add(cp.id);
    if (cp.afterStep.trim().length === 0) {
      errors.push(`humanReviewCheckpoints: afterStep for "${cp.id}" must be non-empty`);
    } else if (!actionIds.has(cp.afterStep) && !questionIds.has(cp.afterStep)) {
      errors.push(
        `humanReviewCheckpoints: afterStep "${cp.afterStep}" of "${cp.id}" does not reference a known action or question id`,
      );
    }
    if (!(REVIEW_ARTIFACT_TYPES as readonly string[]).includes(cp.artifactType)) {
      errors.push(`humanReviewCheckpoints: unknown artifact type "${cp.artifactType}"`);
      continue;
    }
    if (!(REVIEW_RISK_CLASSES as readonly string[]).includes(cp.riskClassification)) {
      errors.push(`humanReviewCheckpoints: unknown risk class "${cp.riskClassification}"`);
      continue;
    }
    if (!(REVIEWER_ROLES as readonly string[]).includes(cp.requiredReviewerRole)) {
      errors.push(`humanReviewCheckpoints: unknown reviewer role "${cp.requiredReviewerRole}"`);
      continue;
    }
    // A checkpoint may only RAISE the kernel's review floor, never lower it —
    // the same upward-only rule as org policy overrides (resolveReviewPolicy
    // clamps silently; here a lowering attempt is an authoring ERROR so it is
    // surfaced instead of silently corrected).
    const effective = resolveReviewPolicy(cp.artifactType, {
      riskClassification: cp.riskClassification,
      requiredReviewerRole: cp.requiredReviewerRole,
    });
    if (
      effective.riskClassification !== cp.riskClassification ||
      effective.requiredReviewerRole !== cp.requiredReviewerRole
    ) {
      errors.push(
        `humanReviewCheckpoints: "${cp.id}" sets ${cp.riskClassification}/${cp.requiredReviewerRole} below the kernel floor for ${cp.artifactType}`,
      );
    }
  }

  const escalationIds = new Set<string>();
  for (const esc of content.escalationCriteria) {
    if (esc.id.trim().length === 0) errors.push("escalationCriteria: id must be non-empty");
    if (escalationIds.has(esc.id)) errors.push(`escalationCriteria: duplicate id "${esc.id}"`);
    escalationIds.add(esc.id);
    if (esc.condition.trim().length === 0) errors.push(`escalationCriteria: condition for "${esc.id}" must be non-empty`);
    if (!(REVIEWER_ROLES as readonly string[]).includes(esc.escalateToRole)) {
      errors.push(`escalationCriteria: unknown reviewer role "${esc.escalateToRole}"`);
    }
  }

  for (const field of PLAYBOOK_CONTENT_FIELDS) {
    const provenance = content.fieldProvenance[field];
    if (provenance === undefined) {
      errors.push(`fieldProvenance: missing entry for "${field}"`);
    } else if (!(FIELD_PROVENANCE_STATES as readonly string[]).includes(provenance)) {
      errors.push(`fieldProvenance: unknown provenance "${provenance}" for "${field}"`);
    }
  }
  for (const key of Object.keys(content.fieldProvenance)) {
    if (!(PLAYBOOK_CONTENT_FIELDS as readonly string[]).includes(key)) {
      errors.push(`fieldProvenance: unknown field "${key}"`);
    }
  }

  return errors;
}

/**
 * The fields that BLOCK approval/publication: anything still
 * `discovery_required`. A draft may carry open questions freely; an approved
 * or published version may not present an unresolved question as process.
 * (`assumption` fields do not block — they are visibly labeled scaffolding a
 * reviewer explicitly accepts; converting them to `confirmed`/`approved` is
 * the discovery queue's job.)
 *
 * Enforcement boundary: `playbookVersionTransition` is content-blind — the
 * STORE (design-brief PR-5) MUST consult `contentBlocksApproval` and deny
 * awaiting_review→approved / approved→published while it returns a non-empty
 * list.
 */
export function contentBlocksApproval(content: PlaybookContent): PlaybookContentFieldKey[] {
  return PLAYBOOK_CONTENT_FIELDS.filter((f) => content.fieldProvenance[f] === "discovery_required");
}

// --- 3. Workflow discovery --------------------------------------------------

export const WORKFLOW_DISCOVERY_STATUSES = ["open", "answered", "converted", "dismissed"] as const;
export type WorkflowDiscoveryStatus = (typeof WORKFLOW_DISCOVERY_STATUSES)[number];

export type WorkflowDiscoveryReasonCode =
  | "WD_ANSWERED"
  | "WD_CONVERTED"
  | "WD_DISMISSED"
  | "WD_REOPENED"
  | "WD_SAME_STATUS"
  | "WD_UNKNOWN_STATUS"
  | "WD_ILLEGAL_TRANSITION";

const DISCOVERY_ALLOWED: Record<
  WorkflowDiscoveryStatus,
  Partial<Record<WorkflowDiscoveryStatus, WorkflowDiscoveryReasonCode>>
> = {
  open: { answered: "WD_ANSWERED", dismissed: "WD_DISMISSED" },
  // An answer may be revised (reopen) until it is CONVERTED into a version.
  answered: { converted: "WD_CONVERTED", open: "WD_REOPENED" },
  dismissed: { open: "WD_REOPENED" },
  converted: {}, // terminal — the answer is absorbed into a playbook version
};

export interface WorkflowDiscoveryTransitionResult {
  allowed: boolean;
  fromStatus: string;
  toStatus: string;
  reasonCode: WorkflowDiscoveryReasonCode;
  ruleVersion: string;
}

export function workflowDiscoveryTransition(fromStatus: string, toStatus: string): WorkflowDiscoveryTransitionResult {
  const base = { fromStatus, toStatus, ruleVersion: PLAYBOOK_RULES_VERSION };
  const known = (s: string): s is WorkflowDiscoveryStatus =>
    (WORKFLOW_DISCOVERY_STATUSES as readonly string[]).includes(s);
  if (!known(fromStatus) || !known(toStatus)) {
    return { ...base, allowed: false, reasonCode: "WD_UNKNOWN_STATUS" };
  }
  if (fromStatus === toStatus) return { ...base, allowed: false, reasonCode: "WD_SAME_STATUS" };
  const code = DISCOVERY_ALLOWED[fromStatus][toStatus];
  if (!code) return { ...base, allowed: false, reasonCode: "WD_ILLEGAL_TRANSITION" };
  return { ...base, allowed: true, reasonCode: code };
}

export function workflowDiscoveryTransitionsFrom(status: WorkflowDiscoveryStatus): WorkflowDiscoveryStatus[] {
  return Object.keys(DISCOVERY_ALLOWED[status]) as WorkflowDiscoveryStatus[];
}
