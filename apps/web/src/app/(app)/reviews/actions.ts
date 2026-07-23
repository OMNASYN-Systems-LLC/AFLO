"use server";

import { revalidatePath } from "next/cache";
import type { ReviewItemActionResult } from "@aflo/shared";
import { getStaffSession, store } from "@/lib/data";
import { currentArtifactStateFor } from "@/lib/review-artifacts";
import {
  REVIEW_DENIAL_CODE_MESSAGES,
  REVIEW_DENIAL_MESSAGES,
  type ReviewActionState,
} from "@/lib/review-format";

/**
 * Human Review Center staff actions. Tenant and actor identity come
 * exclusively from the server-side session (never the browser); the STORE is
 * the single authority — it applies the review kernel, the reviewer policy
 * (role floors, self-review separation, assignment qualifier), the
 * publication floor, and the stale-artifact invariant, and audits every
 * denial. These actions only translate the store result into a serializable
 * state so the form can render the denial inline — no authorization logic
 * lives here (ADR-0045).
 */

function describeDenial(result: ReviewItemActionResult): string {
  const byReason = result.reasonCode ? REVIEW_DENIAL_MESSAGES[result.reasonCode] : undefined;
  if (byReason) return byReason;
  const byDenial = result.denialCode ? REVIEW_DENIAL_CODE_MESSAGES[result.denialCode] : undefined;
  if (byDenial) return byDenial;
  return "The store denied this action.";
}

function toActionState(result: ReviewItemActionResult, successMessage: string): ReviewActionState {
  if (result.ok) return { status: "success", message: successMessage };
  const code = result.reasonCode ?? result.denialCode ?? null;
  return {
    status: "denied",
    code,
    stale: result.reasonCode === "RVC_STALE_ARTIFACT" || result.denialCode === "STALE_ARTIFACT",
    inputErrors: result.inputErrors ?? [],
    message: describeDenial(result),
  };
}

function revalidateReviewPaths(reviewItemId: string): void {
  revalidatePath("/reviews");
  revalidatePath(`/reviews/${reviewItemId}`);
}

/** Record one of the five structured decisions (recordReviewDecision). */
export async function recordReviewDecisionAction(
  _prev: ReviewActionState,
  formData: FormData,
): Promise<ReviewActionState> {
  const session = await getStaffSession();
  const reviewItemId = String(formData.get("reviewItemId") ?? "");
  const detail = String(formData.get("detail") ?? "").trim();
  // Field NAMES only — never values (the store input contract).
  const editedFields = String(formData.get("editedFields") ?? "")
    .split(/[\n,]/)
    .map((s) => s.trim())
    .filter((s) => s.length > 0);

  const result = store.recordReviewDecision({
    organizationId: session.organizationId,
    reviewItemId,
    actorStaffId: session.staffId,
    decision: String(formData.get("decision") ?? ""),
    decisionReasonCode: String(formData.get("decisionReasonCode") ?? ""),
    editedFields,
    detail: detail.length > 0 ? detail : null,
  });
  revalidateReviewPaths(reviewItemId);
  return toActionState(
    result,
    result.item
      ? `Decision recorded — the item is now ${result.item.state.replace("_", " ")}.`
      : "Decision recorded.",
  );
}

/** Assign or reassign a reviewer (assignReviewer — organization_admin+ per the store). */
export async function assignReviewerAction(
  _prev: ReviewActionState,
  formData: FormData,
): Promise<ReviewActionState> {
  const session = await getStaffSession();
  const reviewItemId = String(formData.get("reviewItemId") ?? "");
  const result = store.assignReviewer({
    organizationId: session.organizationId,
    reviewItemId,
    reviewerStaffId: String(formData.get("reviewerStaffId") ?? ""),
    actorStaffId: session.staffId,
  });
  revalidateReviewPaths(reviewItemId);
  return toActionState(result, "Reviewer assigned.");
}

/**
 * Publish an approved item to the client surface (publishReviewItem). The
 * artifact's CURRENT version + digest come from the server-side demo artifact
 * source — never from the browser — so the store's stale-artifact check runs
 * against the real current state. A stale denial leaves the item approved;
 * the recovery path is supersession + a fresh review of the new version.
 */
export async function publishReviewItemAction(
  _prev: ReviewActionState,
  formData: FormData,
): Promise<ReviewActionState> {
  const session = await getStaffSession();
  const reviewItemId = String(formData.get("reviewItemId") ?? "");
  const item = store
    .staffReviewQueue(session.organizationId)
    .find((i) => i.id === reviewItemId);
  if (!item) {
    return {
      status: "denied",
      code: "REVIEW_ITEM_NOT_FOUND",
      stale: false,
      inputErrors: [],
      message: "Review item not found in this organization.",
    };
  }
  const current = currentArtifactStateFor(item);
  const result = store.publishReviewItem({
    organizationId: session.organizationId,
    reviewItemId,
    actorStaffId: session.staffId,
    currentArtifactVersion: current.version,
    currentArtifactDigest: current.digest,
    publishedResultRef: `${item.artifactType}/${item.artifactId}`,
  });
  revalidateReviewPaths(reviewItemId);
  return toActionState(result, "Published to the client surface.");
}
