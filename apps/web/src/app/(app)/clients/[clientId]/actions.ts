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
  const session = getStaffSession();
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
  const session = getStaffSession();
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
  const session = getStaffSession();
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
 * Roadmap approval-workflow action (roadmap.v1.0.0). The store validates
 * the transition; the UI only offers rule-legal moves, and denials are
 * audited server-side either way.
 */
export async function transitionRoadmapAction(
  clientId: string,
  roadmapId: string,
  toStatus: "draft" | "staff_review" | "approved" | "published" | "archived",
): Promise<void> {
  const session = getStaffSession();
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
