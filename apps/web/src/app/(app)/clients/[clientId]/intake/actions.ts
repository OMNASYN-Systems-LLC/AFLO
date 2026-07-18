"use server";

import { revalidatePath } from "next/cache";
import { getStaffSession, store } from "@/lib/data";

/**
 * Staff intake actions. Tenant and actor identity come exclusively from the
 * server-side session (never the browser); the store enforces the intake
 * rules, records audit entries, and emits outbox events. Denials are audited
 * by the store and surface in the workspace activity feed — the UI only
 * offers rule-legal actions.
 */

function revalidate(clientId: string): void {
  revalidatePath(`/clients/${clientId}/intake`);
  revalidatePath(`/clients/${clientId}`);
  revalidatePath("/clients");
  revalidatePath("/leads");
  revalidatePath("/dashboard");
}

export async function completeIntakeSectionAction(
  clientId: string,
  sectionId: string,
): Promise<void> {
  const session = await getStaffSession();
  store.completeIntakeSection({
    organizationId: session.organizationId,
    clientId,
    sectionId,
    actorStaffId: session.staffId,
  });
  revalidate(clientId);
}

export async function completeIntakeAction(clientId: string): Promise<void> {
  const session = await getStaffSession();
  store.completeIntake({
    organizationId: session.organizationId,
    clientId,
    actorStaffId: session.staffId,
  });
  revalidate(clientId);
}
