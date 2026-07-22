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
  | "PB_ILLEGAL_TRANSITION";

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
  /** The content step this checkpoint follows (question/action/calculation id). */
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
    if (trigger.kind === "fact_threshold" && !trigger.ruleId) {
      errors.push("triggeringConditions: fact_threshold triggers must name a backing ruleId");
    }
  }

  for (const calc of content.calculations) {
    if (calc.trim().length === 0) errors.push("calculations: rule id must be non-empty");
  }

  const questionIds = new Set<string>();
  for (const q of content.questionSequence) {
    if (q.prompt.trim().length === 0) errors.push(`questionSequence: prompt for "${q.id}" must be non-empty`);
    if (questionIds.has(q.id)) errors.push(`questionSequence: duplicate id "${q.id}"`);
    questionIds.add(q.id);
  }

  if (content.prohibitedActions.length === 0) {
    errors.push("prohibitedActions must be non-empty (every playbook names what it must never do)");
  }

  for (const cp of content.humanReviewCheckpoints) {
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

  for (const esc of content.escalationCriteria) {
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
