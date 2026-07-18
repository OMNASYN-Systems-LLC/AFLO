"use server";

import { revalidatePath } from "next/cache";
import { getStaffSession, store } from "@/lib/data";

/**
 * Staff pipeline actions. Tenant and actor identity come exclusively from
 * the server-side session (never the browser); the store enforces pipeline
 * rules, records audit entries, and emits outbox events.
 */
export async function advanceLeadAction(
  leadId: string,
  toStageId: string,
  reversal: boolean,
): Promise<void> {
  const session = getStaffSession();
  store.advanceLead({
    organizationId: session.organizationId,
    leadId,
    toStageId,
    actorStaffId: session.staffId,
    reversal,
  });
  // Denials are audited by the store and surface in the activity feed —
  // the UI only offers rule-legal moves, so no further routing is needed.
  revalidatePath("/leads");
  revalidatePath("/clients");
  revalidatePath(`/clients/${leadId}`);
  revalidatePath("/dashboard");
}
