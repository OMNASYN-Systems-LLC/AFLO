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
