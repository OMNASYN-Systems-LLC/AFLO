import { ACTION_RULES_VERSION } from "./action";
import { DOCUMENT_RULES_VERSION } from "./document";
import { ENGAGEMENT_RULES_VERSION } from "./engagement";
import { INTAKE_RULES_VERSION } from "./intake";
import { MESSAGING_RULES_VERSION } from "./messaging";
import { PIPELINE_RULES_VERSION } from "./pipeline";
import { REPORT_RULES_VERSION } from "./report";
import { ROUNDUP_RULES_VERSION } from "./roundup";
import { REVIEW_REASON_DESCRIPTIONS, REVIEW_RULES_VERSION } from "./review";
import { ROADMAP_RULES_VERSION } from "./roadmap";
import { READINESS_RULES_VERSION, REASON_CODE_DESCRIPTIONS } from "./readiness";
import { RESOLUTION_RULES_VERSION } from "./resolution";

/**
 * Rule metadata registry (Product Charter, "Deterministic rules engine").
 *
 * Every deterministic rule ships with a stable identifier, version,
 * effective date, description, declared inputs/output, reason codes, and a
 * change history. Versions here are asserted against the implementation
 * constants by test/registry.test.ts so metadata cannot drift from code.
 *
 * None of these rules encode regulatory or tax thresholds; thresholds are
 * product policy for Golden Key Wealth coaching. Any future rule that does
 * depend on a regulatory value must cite its source and effective date in
 * `sources` before it may ship (charter review control).
 */

export interface RuleChangeEntry {
  version: string;
  date: string; // ISO date the version became effective
  note: string;
}

export interface RuleDefinition {
  /** Stable identifier — never reused for a different rule. */
  id: string;
  /** Current version, matching the implementation's exported constant. */
  version: string;
  effectiveDate: string; // ISO date
  description: string;
  inputs: string[];
  output: string;
  reasonCodes: string[];
  /** Regulatory/tax sources, required when thresholds are not product policy. */
  sources: string[];
  changeHistory: RuleChangeEntry[];
}

export const RULE_REGISTRY: readonly RuleDefinition[] = [
  {
    id: "readiness.stage",
    version: READINESS_RULES_VERSION,
    effectiveDate: "2026-07-17",
    description:
      "Assigns the financial lifecycle stage by ordered gate evaluation over verified facts (income stability, payment history, derogatories, DTI, reserves, score, utilization). First failing gate fixes the stage; V1 tops out at acquisition.",
    inputs: [
      "creditScore",
      "utilizationPct",
      "dtiPct",
      "reserveMonths",
      "derogatoryMarks",
      "onTimePaymentRate",
      "incomeStability",
    ],
    output: "ReadinessAssessment { stage, ruleVersion, reasonCodes, factsUsed }",
    reasonCodes: Object.keys(REASON_CODE_DESCRIPTIONS),
    sources: [],
    changeHistory: [
      { version: "readiness.v1.0.0", date: "2026-07-17", note: "Initial gate set for the first visual slice." },
    ],
  },
  {
    id: "readiness.utilization",
    version: READINESS_RULES_VERSION,
    effectiveDate: "2026-07-17",
    description:
      "Deterministic revolving-utilization calculator. Zero limit with zero balance is 0%; positive balance on a zero limit is fully utilized (100%).",
    inputs: ["revolvingBalanceCents", "revolvingLimitCents"],
    output: "utilization percentage (0..100, one decimal)",
    reasonCodes: [],
    sources: [],
    changeHistory: [
      { version: "readiness.v1.0.0", date: "2026-07-17", note: "Initial calculator; zero-limit semantics fixed in review." },
    ],
  },
  {
    id: "readiness.dti",
    version: READINESS_RULES_VERSION,
    effectiveDate: "2026-07-17",
    description:
      "Deterministic debt-to-income calculator as a percentage; non-positive income pins to 100.",
    inputs: ["monthlyDebtPaymentsCents", "monthlyIncomeCents"],
    output: "DTI percentage (0..100+, one decimal)",
    reasonCodes: [],
    sources: [],
    changeHistory: [
      { version: "readiness.v1.0.0", date: "2026-07-17", note: "Initial calculator." },
    ],
  },
  {
    id: "readiness.reserves",
    version: READINESS_RULES_VERSION,
    effectiveDate: "2026-07-17",
    description:
      "Deterministic liquid-reserve coverage in months of essential expenses.",
    inputs: ["liquidSavingsCents", "monthlyEssentialExpensesCents"],
    output: "reserve months (one decimal)",
    reasonCodes: [],
    sources: [],
    changeHistory: [
      { version: "readiness.v1.0.0", date: "2026-07-17", note: "Initial calculator." },
    ],
  },
  {
    id: "pipeline.transition",
    version: PIPELINE_RULES_VERSION,
    effectiveDate: "2026-07-18",
    description:
      "Lead→client pipeline transition rules over configurable stage definitions: forward moves may never silently skip required stages; backward moves are allowed only as explicitly flagged staff corrections (PL_REVERSED); the terminal activation stage hands off to the client lifecycle.",
    inputs: ["pipelineDefinition", "fromStageId", "toStageId", "options.reversal?"],
    output: "PipelineTransitionResult { allowed, reasonCode, skippedRequiredStageIds }",
    reasonCodes: [
      "PL_OK",
      "PL_REVERSED",
      "PL_UNKNOWN_STAGE",
      "PL_SAME_STAGE",
      "PL_REQUIRED_STAGE_SKIPPED",
      "PL_TERMINAL_STAGE",
      "PL_REVERSAL_NOT_ALLOWED",
      "PL_INVALID_DEFINITION",
    ],
    sources: [],
    changeHistory: [
      { version: "pipeline.v1.0.0", date: "2026-07-18", note: "Initial configurable pipeline state machine (founder workstream slice C)." },
    ],
  },
  {
    id: "readiness.review_gate",
    version: REVIEW_RULES_VERSION,
    effectiveDate: "2026-07-18",
    description:
      "Staff-review gate over recorded readiness assessments: a first assessment stands on its own; a stage regression or a multi-stage advance (two or more steps) in a single assessment requires human review before downstream consumption. The readiness engine never silently overrides human-approved exceptions.",
    inputs: ["previousStage", "nextStage"],
    output: "ReviewGateResult { requiresHumanReview, reasonCodes }",
    reasonCodes: Object.keys(REVIEW_REASON_DESCRIPTIONS),
    sources: [],
    changeHistory: [
      { version: "review.v1.0.0", date: "2026-07-18", note: "Initial gate (founder workstream slice E)." },
    ],
  },
  {
    id: "intake.completeness",
    version: INTAKE_RULES_VERSION,
    effectiveDate: "2026-07-18",
    description:
      "Client-intake completeness over configurable section definitions: sections may only be marked complete once and must exist in the definition; the intake completes only when every required section is complete. Unknown completed section ids fail closed. Section data lives in the domain records the sections feed, never in the rules.",
    inputs: ["intakeDefinition", "completedSectionIds", "sectionId (per-section check)"],
    output:
      "IntakeSectionResult { allowed, reasonCode } / IntakeCompletenessResult { complete, missingRequiredSectionIds, reasonCode }",
    reasonCodes: [
      "IN_OK",
      "IN_COMPLETE",
      "IN_MISSING_REQUIRED",
      "IN_UNKNOWN_SECTION",
      "IN_SECTION_ALREADY_COMPLETE",
      "IN_INVALID_DEFINITION",
    ],
    sources: [],
    changeHistory: [
      { version: "intake.v1.0.0", date: "2026-07-18", note: "Initial founder-required section set (founder workstream slice D)." },
    ],
  },
  {
    id: "action.transition",
    version: ACTION_RULES_VERSION,
    effectiveDate: "2026-07-18",
    description:
      "Monthly-action status workflow over an allow-list: todo → in_progress → done, direct completion allowed, pauses explicit, and reopening a completed action is a distinct flagged move (AC_REOPENED) so completion history is never silently rewritten.",
    inputs: ["fromStatus", "toStatus"],
    output: "ActionTransitionResult { allowed, reasonCode }",
    reasonCodes: [
      "AC_STARTED",
      "AC_COMPLETED",
      "AC_PAUSED",
      "AC_REOPENED",
      "AC_SAME_STATUS",
      "AC_UNKNOWN_STATUS",
      "AC_ILLEGAL_TRANSITION",
    ],
    sources: [],
    changeHistory: [
      { version: "action.v1.0.0", date: "2026-07-18", note: "Initial status workflow (founder workstream slice G)." },
    ],
  },
  {
    id: "roadmap.transition",
    version: ROADMAP_RULES_VERSION,
    effectiveDate: "2026-07-18",
    description:
      "Roadmap approval workflow over an allow-list state machine: Draft → Staff Review → Approved → Published, with explicit returns (review → draft), reopens (approved → draft), and archival. Anything unlisted is denied. Submission, approval, and publication are human staff actions — AI may draft language but can never move a roadmap through this workflow.",
    inputs: ["fromStatus", "toStatus"],
    output: "RoadmapTransitionResult { allowed, reasonCode }",
    reasonCodes: [
      "RM_SUBMITTED",
      "RM_APPROVED",
      "RM_RETURNED",
      "RM_PUBLISHED",
      "RM_REOPENED",
      "RM_ARCHIVED",
      "RM_SAME_STATUS",
      "RM_UNKNOWN_STATUS",
      "RM_ILLEGAL_TRANSITION",
    ],
    sources: [],
    changeHistory: [
      { version: "roadmap.v1.0.0", date: "2026-07-18", note: "Initial founder-required approval path (founder workstream slice F)." },
    ],
  },
  {
    id: "document.transition",
    version: DOCUMENT_RULES_VERSION,
    effectiveDate: "2026-07-18",
    description:
      "Document review-state workflow over an allow-list: requested → uploaded → in_review → approved or needs_attention, with re-entry via re-upload. Approved is terminal — an approved document is a verified fact; replacement means a new request, never a silent downgrade. Metadata workflow only; file contents live behind external signed-URL storage.",
    inputs: ["fromStatus", "toStatus"],
    output: "DocumentTransitionResult { allowed, reasonCode }",
    reasonCodes: [
      "DOC_UPLOADED",
      "DOC_REVIEW_STARTED",
      "DOC_APPROVED",
      "DOC_FLAGGED",
      "DOC_RESUBMITTED",
      "DOC_SAME_STATUS",
      "DOC_UNKNOWN_STATUS",
      "DOC_ILLEGAL_TRANSITION",
    ],
    sources: [],
    changeHistory: [
      { version: "document.v1.0.0", date: "2026-07-18", note: "Initial review-state workflow (founder workstream slice J)." },
    ],
  },
  {
    id: "report.transition",
    version: REPORT_RULES_VERSION,
    effectiveDate: "2026-07-18",
    description:
      "Quarterly-report workflow over an allow-list: Draft → Ready for review → Published, with explicit returns to draft. Published is terminal — a delivered report is never edited in place. Reports generate from verified, recorded facts; AI may later draft narrative language but can never move a report through this workflow.",
    inputs: ["fromStatus", "toStatus"],
    output: "ReportTransitionResult { allowed, reasonCode }",
    reasonCodes: [
      "RP_SUBMITTED",
      "RP_RETURNED",
      "RP_PUBLISHED",
      "RP_SAME_STATUS",
      "RP_UNKNOWN_STATUS",
      "RP_ILLEGAL_TRANSITION",
    ],
    sources: [],
    changeHistory: [
      { version: "report.v1.0.0", date: "2026-07-18", note: "Initial workflow (founder workstream slice H)." },
    ],
  },
  {
    id: "roundup.calculator",
    version: ROUNDUP_RULES_VERSION,
    effectiveDate: "2026-07-18",
    description:
      "Deterministic virtual round-up / micro-allocation calculator (SIMULATION ONLY — never moves money or touches a real account). Rounds a transaction up to the next configured boundary times a multiplier in integer cents; totals and projects hypothetical monthly savings for goal visualization and education.",
    inputs: ["amountCents", "roundToCents", "multiplier", "windowDays"],
    output: "roundUpAmountCents / totalRoundUpCents / projectedMonthlySavingsCents",
    reasonCodes: [],
    sources: [],
    changeHistory: [
      { version: "roundup.v1.0.0", date: "2026-07-18", note: "Initial simulation calculator (charter round-up module)." },
    ],
  },
  {
    id: "resolution.input_completeness",
    version: RESOLUTION_RULES_VERSION,
    effectiveDate: "2026-07-19",
    description:
      "Deterministic 'understand' substrate for the Financial Resolution Concierge loop: over the seven verified readiness inputs, reports which are captured, which are still missing, and which missing ones BLOCK the diagnosis. The credit score is non-blocking (thin-file clients remain assessable); the other six are required and mirror the verified-facts half of the store's run precondition (both profiles present) — intake completion is a separate gate. Produces no stage and no recommendation — it composes, never overrides, the readiness diagnosis.",
    inputs: ["readinessInputPresence (creditScore, utilizationPct, dtiPct, reserveMonths, derogatoryMarks, onTimePaymentRate, incomeStability)"],
    output:
      "ReadinessInputCompleteness { capturedKeys, missingKeys, blockingMissingKeys, canDiagnose, completionPct, ruleVersion }",
    reasonCodes: [],
    sources: [],
    changeHistory: [
      { version: "resolution.v1.0.0", date: "2026-07-19", note: "Initial understand-stage completeness primitive (Financial Resolution Concierge substrate)." },
    ],
  },
  {
    id: "messaging.thread",
    version: MESSAGING_RULES_VERSION,
    effectiveDate: "2026-07-19",
    description:
      "Deterministic validation for staff↔client secure-messaging threads: a message draft is well-formed only with a sender, an open thread, and a non-empty body within the length cap; thread status moves open⇄closed only by the legal action. Governs message well-formedness and thread state, never visibility — client-facing visibility is a structural property of the domain projection (a client thread is built only from Messages, so internal AdminNotes cannot appear).",
    inputs: ["MessageDraft (senderId, senderRole, body)", "ThreadStatus", "ThreadAction (close | reopen)"],
    output: "MessageValidation { ok, reasonCode, ruleVersion, normalizedBody } | ThreadTransition { ok, reasonCode, ruleVersion, status }",
    reasonCodes: ["MSG_OK", "MSG_EMPTY_BODY", "MSG_BODY_TOO_LONG", "MSG_MISSING_SENDER", "MSG_THREAD_CLOSED", "MSG_ILLEGAL_THREAD_TRANSITION"],
    sources: [],
    changeHistory: [
      { version: "messaging.v1.0.0", date: "2026-07-19", note: "Initial secure-messaging validation + thread-status transitions." },
    ],
  },
  {
    id: "engagement.status",
    version: ENGAGEMENT_RULES_VERSION,
    effectiveDate: "2026-07-17",
    description:
      "Classifies client engagement from days since last recorded activity: <14 active, <30 cooling, <60 at_risk, otherwise dormant. Rejects unparseable timestamps.",
    inputs: ["lastActivityAt", "now"],
    output: "EngagementAssessment { status, daysSinceLastActivity, ruleVersion }",
    reasonCodes: [],
    sources: [],
    changeHistory: [
      { version: "engagement.v1.0.0", date: "2026-07-17", note: "Initial thresholds for the first visual slice." },
    ],
  },
] as const;

export function getRule(id: string): RuleDefinition | undefined {
  return RULE_REGISTRY.find((r) => r.id === id);
}
