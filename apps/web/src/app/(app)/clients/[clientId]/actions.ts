"use server";

import { revalidatePath } from "next/cache";
import { getStaffSession, store } from "@/lib/data";

/**
 * Staff readiness-assessment action. Tenant and actor identity come
 * exclusively from the server-side session (never the browser); the store
 * enforces eligibility (completed intake), runs the deterministic rules,
 * applies the review gate, records the result, and audits denials/blocks.
 */
export async function runReadinessAssessmentAction(clientId: string): Promise<void> {
  const session = await getStaffSession();
  store.runReadinessAssessment({
    organizationId: session.organizationId,
    clientId,
    actorStaffId: session.staffId,
  });
  revalidatePath(`/clients/${clientId}`);
  revalidatePath("/clients");
  revalidatePath("/dashboard");
}

/**
 * Monthly-action workflow actions (action.v1.0.0). The store validates
 * status transitions and creation input; denials are audited server-side.
 */
export async function transitionMonthlyActionAction(
  clientId: string,
  actionId: string,
  toStatus: "todo" | "in_progress" | "done",
): Promise<void> {
  const session = await getStaffSession();
  store.transitionMonthlyAction({
    organizationId: session.organizationId,
    actionId,
    toStatus,
    actorStaffId: session.staffId,
  });
  revalidatePath(`/clients/${clientId}`);
  revalidatePath("/clients");
  revalidatePath("/dashboard");
}

export async function addMonthlyActionAction(clientId: string, formData: FormData): Promise<void> {
  const session = await getStaffSession();
  store.addMonthlyAction({
    organizationId: session.organizationId,
    clientId,
    title: String(formData.get("title") ?? ""),
    category: String(formData.get("category") ?? "") as
      | "payment"
      | "savings"
      | "documentation"
      | "education"
      | "habit",
    dueDate: String(formData.get("dueDate") ?? ""),
    actorStaffId: session.staffId,
  });
  revalidatePath(`/clients/${clientId}`);
  revalidatePath("/clients");
  revalidatePath("/dashboard");
}

/**
 * Staff document/appointment/note workflow actions. The store validates
 * everything (document.v1.0.0, input checks) and audits denials; the UI
 * only offers rule-legal moves.
 */
export async function requestDocumentAction(clientId: string, formData: FormData): Promise<void> {
  const session = await getStaffSession();
  store.requestDocument({
    organizationId: session.organizationId,
    clientId,
    name: String(formData.get("name") ?? ""),
    docType: String(formData.get("docType") ?? "") as
      | "credit_report"
      | "income_verification"
      | "bank_statement"
      | "identification"
      | "other",
    actorStaffId: session.staffId,
  });
  revalidatePath(`/clients/${clientId}`);
  revalidatePath("/dashboard");
}

export async function transitionDocumentAction(
  clientId: string,
  documentId: string,
  toStatus: "requested" | "uploaded" | "in_review" | "approved" | "needs_attention",
): Promise<void> {
  const session = await getStaffSession();
  store.transitionDocument({
    organizationId: session.organizationId,
    documentId,
    toStatus,
    actorStaffId: session.staffId,
  });
  revalidatePath(`/clients/${clientId}`);
  revalidatePath("/dashboard");
}

export async function scheduleAppointmentAction(clientId: string, formData: FormData): Promise<void> {
  const session = await getStaffSession();
  store.scheduleAppointment({
    organizationId: session.organizationId,
    clientId,
    purpose: String(formData.get("purpose") ?? ""),
    scheduledAt: String(formData.get("scheduledAt") ?? ""),
    channel: String(formData.get("channel") ?? "") as "video" | "phone" | "in_person",
    actorStaffId: session.staffId,
  });
  revalidatePath(`/clients/${clientId}`);
  revalidatePath("/dashboard");
}

export async function addNoteAction(clientId: string, formData: FormData): Promise<void> {
  const session = await getStaffSession();
  store.addNote({
    organizationId: session.organizationId,
    clientId,
    body: String(formData.get("body") ?? ""),
    actorStaffId: session.staffId,
  });
  revalidatePath(`/clients/${clientId}`);
}

/**
 * Secure-messaging actions (messaging.v1.0.0). Staff↔client threads are shared
 * with the client — internal notes stay in the separate `notes` model. Tenant
 * and actor identity come only from the server session; the store re-verifies
 * the thread's org and validates the body. A denial is rejected fail-closed and
 * leaves no trace (no message, event, or audit); only a successful post is
 * audited (`message.posted`). The `threadId` arrives from the form but is
 * re-scoped to the session's org by the store, so a foreign id cannot match.
 */
export async function postStaffReplyAction(
  clientId: string,
  threadId: string,
  formData: FormData,
): Promise<void> {
  const session = await getStaffSession();
  store.postReply({
    organizationId: session.organizationId,
    threadId,
    senderRole: "staff",
    senderId: session.staffId,
    body: String(formData.get("body") ?? ""),
  });
  revalidatePath(`/clients/${clientId}`);
}

export async function openThreadAction(clientId: string, formData: FormData): Promise<void> {
  const session = await getStaffSession();
  store.openThread({
    organizationId: session.organizationId,
    clientId,
    subject: String(formData.get("subject") ?? ""),
    body: String(formData.get("body") ?? ""),
    actorStaffId: session.staffId,
  });
  revalidatePath(`/clients/${clientId}`);
}

/**
 * Staff marks a thread's client messages read (read receipts, messaging.v1.0.0).
 * Identity comes only from the session; the store re-verifies org membership,
 * marks only the counterparty's unread messages, emits MessageRead, and audits.
 * Idempotent — marking an already-read thread is a traceless no-op.
 */
export async function markThreadReadAction(clientId: string, threadId: string): Promise<void> {
  const session = await getStaffSession();
  store.markThreadRead({
    organizationId: session.organizationId,
    threadId,
    readerRole: "staff",
    readerId: session.staffId,
  });
  revalidatePath(`/clients/${clientId}`);
  revalidatePath("/dashboard");
}

/**
 * Goal workflow actions. Goals are staff-maintained; the store validates,
 * enforces a single primary, emits GoalCreated, and audits.
 */
export async function createGoalAction(clientId: string, formData: FormData): Promise<void> {
  const session = await getStaffSession();
  store.createGoal({
    organizationId: session.organizationId,
    clientId,
    title: String(formData.get("title") ?? ""),
    category: String(formData.get("category") ?? "") as
      | "credit"
      | "savings"
      | "debt"
      | "home_purchase"
      | "business_capital"
      | "other",
    targetDate: String(formData.get("targetDate") ?? ""),
    isPrimary: formData.get("isPrimary") === "on",
    actorStaffId: session.staffId,
  });
  revalidatePath(`/clients/${clientId}`);
  revalidatePath("/clients");
  revalidatePath("/dashboard");
}

export async function updateGoalProgressAction(clientId: string, goalId: string, formData: FormData): Promise<void> {
  const session = await getStaffSession();
  store.updateGoalProgress({
    organizationId: session.organizationId,
    goalId,
    progressPct: Number(formData.get("progressPct") ?? "0"),
    actorStaffId: session.staffId,
  });
  revalidatePath(`/clients/${clientId}`);
}

export async function setPrimaryGoalAction(clientId: string, goalId: string): Promise<void> {
  const session = await getStaffSession();
  store.setPrimaryGoal({
    organizationId: session.organizationId,
    goalId,
    actorStaffId: session.staffId,
  });
  revalidatePath(`/clients/${clientId}`);
  revalidatePath("/clients");
}

/**
 * ΛFLO Wealth Academy actions. Assignment is deterministic (education.v1.0.0);
 * completion is educational only and never gates a regulated product.
 */
export async function assignEducationAction(
  clientId: string,
  trigger:
    | "high_utilization"
    | "incomplete_intake"
    | "missing_document"
    | "missed_action"
    | "appointment_preparation"
    | "capital_readiness_preparation"
    | "possible_commingling"
    | "roadmap_approved",
): Promise<void> {
  const session = await getStaffSession();
  store.assignEducation({
    organizationId: session.organizationId,
    clientId,
    trigger,
    actorStaffId: session.staffId,
  });
  revalidatePath(`/clients/${clientId}`);
}

export async function completeEducationAction(clientId: string, assignmentId: string): Promise<void> {
  const session = await getStaffSession();
  store.completeEducation({
    organizationId: session.organizationId,
    assignmentId,
    actorStaffId: session.staffId,
  });
  revalidatePath(`/clients/${clientId}`);
}

/**
 * Notification-preference action. Preferences are granular per
 * (type, channel), revocable, audited, and enforced before the next send.
 */
export async function setNotificationPreferenceAction(
  clientId: string,
  notificationType:
    | "appointment_scheduled"
    | "roadmap_published"
    | "report_published"
    | "document_requested"
    | "task_assigned",
  channel: "in_app" | "email" | "sms",
  enabled: boolean,
): Promise<void> {
  const session = await getStaffSession();
  store.setNotificationPreference({
    organizationId: session.organizationId,
    clientId,
    notificationType,
    channel,
    enabled,
    actorStaffId: session.staffId,
  });
  revalidatePath(`/clients/${clientId}`);
}

/**
 * Round-up simulator action (simulation only — never moves money). The store
 * computes round-ups via roundup.v1.0.0 and validates all input.
 */
export async function addVirtualTransactionAction(clientId: string, formData: FormData): Promise<void> {
  const session = await getStaffSession();
  const dollars = Number(formData.get("amount") ?? "0");
  store.addVirtualTransaction({
    organizationId: session.organizationId,
    clientId,
    label: String(formData.get("label") ?? ""),
    amountCents: Math.round(dollars * 100),
    occurredOn: String(formData.get("occurredOn") ?? ""),
    actorStaffId: session.staffId,
  });
  revalidatePath(`/clients/${clientId}`);
}

/**
 * Quarterly-report workflow actions (report.v1.0.0). Generation draws only
 * on recorded facts; the store enforces eligibility, one report per
 * quarter, and the review workflow — denials are audited server-side.
 */
export async function generateReportAction(clientId: string): Promise<void> {
  const session = await getStaffSession();
  store.generateQuarterlyReport({
    organizationId: session.organizationId,
    clientId,
    actorStaffId: session.staffId,
  });
  revalidatePath(`/clients/${clientId}`);
  revalidatePath("/clients");
  revalidatePath("/dashboard");
}

export async function transitionReportAction(
  clientId: string,
  reportId: string,
  toStatus: "draft" | "ready_for_review" | "published",
): Promise<void> {
  const session = await getStaffSession();
  store.transitionReport({
    organizationId: session.organizationId,
    reportId,
    toStatus,
    actorStaffId: session.staffId,
  });
  revalidatePath(`/clients/${clientId}`);
  revalidatePath("/clients");
  revalidatePath("/dashboard");
}

/**
 * Signed verification handoff actions (security.v1.0.0). The store enforces a
 * server-verified actor, active partner-data-sharing consent, and a recorded
 * readiness assessment before assembling and signing a package; denials are
 * audited. Revocation is one-way. Recipient identity comes from the form; org
 * and actor identity come only from the server session.
 */
export async function generateHandoffAction(clientId: string, formData: FormData): Promise<void> {
  const session = await getStaffSession();
  store.generateHandoffPackage({
    organizationId: session.organizationId,
    clientId,
    recipientScope: String(formData.get("recipientScope") ?? "").trim(),
    actorStaffId: session.staffId,
  });
  revalidatePath(`/clients/${clientId}`);
}

export async function revokeHandoffAction(clientId: string, packageId: string): Promise<void> {
  const session = await getStaffSession();
  store.revokeHandoffPackage({
    organizationId: session.organizationId,
    packageId,
    actorStaffId: session.staffId,
  });
  revalidatePath(`/clients/${clientId}`);
}

/**
 * Roadmap approval-workflow action (roadmap.v1.0.0). The store validates
 * the transition; the UI only offers rule-legal moves, and denials are
 * audited server-side either way.
 */
export async function transitionRoadmapAction(
  clientId: string,
  roadmapId: string,
  toStatus: "draft" | "staff_review" | "approved" | "published" | "archived",
): Promise<void> {
  const session = await getStaffSession();
  store.transitionRoadmap({
    organizationId: session.organizationId,
    roadmapId,
    toStatus,
    actorStaffId: session.staffId,
  });
  revalidatePath(`/clients/${clientId}`);
  revalidatePath("/clients");
  revalidatePath("/dashboard");
}

/**
 * Partner-referral actions (partner.v1.0.0). Tenant/actor identity come only
 * from the session. The neutrality record combines staff-authored fields (why
 * shown, alternatives, review acknowledgment) with the selected partner's own
 * disclosures; the store refuses a referral without a complete record and
 * audits every denial. Partner compensation never touches readiness.
 */
export async function createReferralAction(clientId: string, formData: FormData): Promise<void> {
  const session = await getStaffSession();
  const partnerId = String(formData.get("partnerId") ?? "");
  const partner = store.partnersFor(session.organizationId).find((p) => p.id === partnerId);
  const alternatives = String(formData.get("eligibleAlternatives") ?? "")
    .split(/[\n,]/)
    .map((s) => s.trim())
    .filter((s) => s.length > 0);
  const nonCommercialOptionExists = store
    .partnersFor(session.organizationId)
    .some((p) => p.nonCommercial);

  store.createReferral({
    organizationId: session.organizationId,
    clientId,
    partnerId,
    neutrality: {
      whyShown: String(formData.get("whyShown") ?? "").trim(),
      eligibleAlternatives: alternatives,
      compensationDisclosure: partner?.compensationDisclosure ?? "",
      nonCommercialOptionExists,
      estimatedUserCost: partner?.estimatedUserCost ?? "",
      keyRisks: partner?.keyRisks ?? "",
      eligibilityCriteria: partner?.eligibilityCriteria ?? "",
      staffReviewed: formData.get("staffReviewed") === "on",
    },
    actorStaffId: session.staffId,
  });
  revalidatePath(`/clients/${clientId}`);
}

export async function transitionReferralAction(
  clientId: string,
  referralId: string,
  toStatus: "shared_with_client" | "client_engaged" | "declined",
): Promise<void> {
  const session = await getStaffSession();
  store.transitionReferral({
    organizationId: session.organizationId,
    referralId,
    toStatus,
    actorStaffId: session.staffId,
  });
  revalidatePath(`/clients/${clientId}`);
}

export async function recordReferralOutcomeAction(
  clientId: string,
  referralId: string,
  formData: FormData,
): Promise<void> {
  const session = await getStaffSession();
  store.recordReferralOutcome({
    organizationId: session.organizationId,
    referralId,
    outcome: String(formData.get("outcome") ?? "") as
      | "engaged_supported_readiness"
      | "engaged_no_change"
      | "not_pursued",
    note: String(formData.get("note") ?? ""),
    actorStaffId: session.staffId,
  });
  revalidatePath(`/clients/${clientId}`);
}
