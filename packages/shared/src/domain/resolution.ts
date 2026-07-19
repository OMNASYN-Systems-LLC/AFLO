import {
  READINESS_RULES_VERSION,
  RESOLUTION_RULES_VERSION,
  dtiPct,
  readinessInputCompleteness,
  utilizationPct,
  type EngagementAssessment,
  type EngagementStatus,
  type LifecycleStage,
  type ReadinessInputCompleteness,
  type ReadinessInputPresence,
  type ReasonCode,
} from "@aflo/rules";
import type { ClientDocument, CreditProfile, FinancialProfile, Goal, ReadinessAssessmentRecord } from "./types";

/**
 * The deterministic READ-MODEL substrate for the Financial Resolution
 * Concierge loop (understand → diagnose → organize → …). It is intentionally
 * distinct from the staff `ClientDetail` aggregate (a UI read of everything)
 * and the client `PortalView` (a published-only projection): the readout is
 * compact and decision-oriented — the governed INPUT CONTRACT the future
 * orchestration loop consumes — and it COMPOSES existing kernel/workflow
 * outputs rather than recomputing them. No AI, no mutation, no new facts.
 */

/**
 * Adapt the two verified profiles into readiness-input presence. A fact is
 * present only when its source profile exists; the credit score is present
 * only when the credit profile carries a non-null score (a thin file).
 */
export function toReadinessInputPresence(
  financial: FinancialProfile | null,
  credit: CreditProfile | null,
): ReadinessInputPresence {
  return {
    creditScore: credit != null && credit.score != null,
    utilizationPct: credit != null,
    dtiPct: financial != null,
    reserveMonths: financial != null,
    derogatoryMarks: credit != null,
    onTimePaymentRate: credit != null,
    incomeStability: financial != null,
  };
}

export interface ResolutionDiagnosis {
  stage: LifecycleStage;
  reasonCodes: ReasonCode[];
  /** The binding blocker: the first reason code (the store selects the proposed action from it). Null if none. */
  bindingBlocker: ReasonCode | null;
  proposedNextAction: string;
  requiresHumanReview: boolean;
  assessedAt: string;
}

export interface ResolutionObligations {
  monthlyIncomeCents: number;
  monthlyDebtPaymentsCents: number;
  dtiPct: number;
  revolvingBalanceCents: number;
  revolvingLimitCents: number;
  utilizationPct: number;
}

export interface ResolutionDocumentReadiness {
  total: number;
  approved: number;
  needsAttention: number;
  /** requested / uploaded / in_review — awaiting a terminal review state. */
  pending: number;
}

export interface ResolutionReadout {
  clientId: string;
  generatedAt: string; // ISO datetime

  /** UNDERSTAND — verified inputs captured vs. still needed. */
  understanding: ReadinessInputCompleteness;
  /** Whether structured intake has been declared complete by the intake rules. */
  intakeComplete: boolean;
  /**
   * Whether the readiness diagnosis may actually RUN: the required facts are
   * captured AND intake is complete — the store's full run precondition. Gate
   * a "Run assessment" affordance on THIS, never on `understanding.canDiagnose`
   * alone (which is the facts half only).
   */
  canRunDiagnosis: boolean;

  /** DIAGNOSE — the latest RECORDED assessment, never recomputed here; null before the first run. */
  diagnosis: ResolutionDiagnosis | null;

  /** ORGANIZE — obligation snapshot from verified facts; null when either profile is missing. */
  obligations: ResolutionObligations | null;

  /** Context the loop tracks. */
  engagement: { status: EngagementStatus; daysSinceLastActivity: number };
  primaryGoal: { title: string; category: Goal["category"]; targetDate: string; progressPct: number } | null;
  documentReadiness: ResolutionDocumentReadiness;

  /** Provenance: the deterministic rule versions this readout was composed from. */
  ruleVersions: string[];
}

export interface ResolutionReadoutInput {
  clientId: string;
  financial: FinancialProfile | null;
  credit: CreditProfile | null;
  /** Latest recorded readiness assessment (workflow fact); null before the first run. */
  latestAssessment: ReadinessAssessmentRecord | null;
  intakeComplete: boolean;
  engagement: EngagementAssessment;
  primaryGoal: Goal | null;
  documents: readonly ClientDocument[];
  now: Date;
}

function summarizeDocumentReadiness(documents: readonly ClientDocument[]): ResolutionDocumentReadiness {
  let approved = 0;
  let needsAttention = 0;
  let pending = 0;
  for (const d of documents) {
    if (d.reviewStatus === "approved") approved += 1;
    else if (d.reviewStatus === "needs_attention") needsAttention += 1;
    else pending += 1; // requested / uploaded / in_review
  }
  return { total: documents.length, approved, needsAttention, pending };
}

/**
 * Compose a governed resolution readout from already-verified facts. Pure and
 * deterministic: it reuses the readiness diagnosis that was recorded (never
 * re-runs it), the engagement assessment the caller passed, and the
 * completeness/utilization/DTI kernels — so it cannot introduce a new fact or
 * contradict an existing one.
 */
export function buildResolutionReadout(input: ResolutionReadoutInput): ResolutionReadout {
  const { clientId, financial, credit, latestAssessment, intakeComplete, engagement, primaryGoal, documents, now } =
    input;

  const understanding = readinessInputCompleteness(toReadinessInputPresence(financial, credit));

  const diagnosis: ResolutionDiagnosis | null = latestAssessment
    ? {
        stage: latestAssessment.stage,
        reasonCodes: latestAssessment.reasonCodes,
        bindingBlocker: latestAssessment.reasonCodes[0] ?? null,
        proposedNextAction: latestAssessment.proposedNextAction,
        requiresHumanReview: latestAssessment.requiresHumanReview,
        assessedAt: latestAssessment.assessedAt,
      }
    : null;

  const obligations: ResolutionObligations | null =
    financial && credit
      ? {
          monthlyIncomeCents: financial.monthlyIncomeCents,
          monthlyDebtPaymentsCents: financial.monthlyDebtPaymentsCents,
          dtiPct: dtiPct(financial.monthlyDebtPaymentsCents, financial.monthlyIncomeCents),
          revolvingBalanceCents: credit.revolvingBalanceCents,
          revolvingLimitCents: credit.revolvingLimitCents,
          utilizationPct: utilizationPct(credit.revolvingBalanceCents, credit.revolvingLimitCents),
        }
      : null;

  const ruleVersions = [
    ...new Set([
      RESOLUTION_RULES_VERSION,
      engagement.ruleVersion,
      // The obligations snapshot is computed with the readiness utilization/DTI
      // kernels, so their version is part of provenance whenever obligations
      // exist — independent of whether an assessment has been recorded yet.
      ...(obligations ? [READINESS_RULES_VERSION] : []),
      ...(latestAssessment ? [latestAssessment.ruleVersion] : []),
    ]),
  ];

  return {
    clientId,
    generatedAt: now.toISOString(),
    understanding,
    intakeComplete,
    canRunDiagnosis: understanding.canDiagnose && intakeComplete,
    diagnosis,
    obligations,
    engagement: { status: engagement.status, daysSinceLastActivity: engagement.daysSinceLastActivity },
    primaryGoal: primaryGoal
      ? {
          title: primaryGoal.title,
          category: primaryGoal.category,
          targetDate: primaryGoal.targetDate,
          progressPct: primaryGoal.progressPct,
        }
      : null,
    documentReadiness: summarizeDocumentReadiness(documents),
    ruleVersions,
  };
}
