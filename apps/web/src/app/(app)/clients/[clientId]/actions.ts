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
