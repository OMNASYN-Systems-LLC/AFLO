import type { ReportStatusId, ReviewArtifactType, ReviewItemState, RoadmapStatus } from "@aflo/rules";
import type { QuarterlyReport, Roadmap } from "../domain/types";

/**
 * Domain → Review Center bridges (ADR-0049, Workstream A domain-bridges
 * slice 1): pure, org-independent mapping functions between the roadmap and
 * quarterly-report domain kernels and the Review Center kernel.
 *
 * AUTHORITY (ADR-0034, verbatim): domain status authoritative for bridged
 * types; ReviewItem authoritative for native types. A bridged ReviewItem is a
 * same-mutation SHADOW the store derives inside `transitionRoadmap` /
 * `transitionReport` — never a second decision surface. These functions are
 * the ONLY place the two vocabularies meet (design brief §6.5 mitigation b:
 * shadow transitions are DERIVED, never free-form).
 *
 * Everything here is pure and I/O-free (no clock, no crypto — the canonical
 * serializers return STRINGS; digesting happens where node:crypto is
 * available, i.e. the server-side store and tests).
 */

/** The artifact types bridged in this slice — their ReviewItems are shadows. */
export const BRIDGED_ARTIFACT_TYPES = ["roadmap_draft", "quarterly_report"] as const;
export type BridgedArtifactType = (typeof BRIDGED_ARTIFACT_TYPES)[number];

/** Is this artifact type a bridged (domain-authoritative) type? */
export function isBridgedArtifactType(type: string): type is BridgedArtifactType {
  return (BRIDGED_ARTIFACT_TYPES as readonly string[]).includes(type);
}

/**
 * The shadow revision for bridged artifacts. Neither `Roadmap` nor
 * `QuarterlyReport` carries a version column, and the store has NO content-edit
 * path for either row (titles/highlights are fixed at creation), so the
 * monotonic revision stays at "1" for the row's lifetime. A future domain edit
 * path MUST bump this revision and supersede the open shadow — a new artifact
 * version requires a new review (founder decision 3, ADR-0043).
 */
export const BRIDGED_ARTIFACT_REVISION = "1";

/**
 * roadmap.v1.0.0 status → review_center.v1.0.0 shadow state.
 *
 *   draft        → draft
 *   staff_review → awaiting_review
 *   approved     → approved
 *   published    → published
 *   archived     → superseded   (terminal: an archived roadmap's open or
 *                                published shadow is superseded)
 *
 * Every roadmap status maps; null only for unknown input (cast-hardening).
 * Domain REGRESSIONS (RM_RETURNED staff_review→draft, RM_REOPENED
 * approved→draft) still map to `draft`, but the kernel has NO return edges
 * (awaiting_review→draft and approved→draft do not exist in the allow-list —
 * verified): the store realizes the regression through the kernel's own
 * revision path — supersede the open shadow and mint a NEW linked draft item
 * in the same mutation. The mapping names the target; the walk uses only
 * legal edges (lockstep-tested).
 */
export function reviewStateForRoadmapStatus(status: RoadmapStatus): ReviewItemState | null {
  switch (status) {
    case "draft":
      return "draft";
    case "staff_review":
      return "awaiting_review";
    case "approved":
      return "approved";
    case "published":
      return "published";
    case "archived":
      return "superseded";
    default:
      return null;
  }
}

/**
 * report.v1.0.0 status → review_center.v1.0.0 shadow state.
 *
 *   draft            → draft
 *   ready_for_review → awaiting_review
 *   published        → published
 *
 * The report machine has NO approved intermediate: publishing from
 * ready_for_review carries the shadow through awaiting_review → approved →
 * published — two legal kernel edges applied atomically inside the ONE
 * `transitionReport` call, with the approve leg's decision record stamped to
 * the acting staff member. report.v1.0.0 itself is NOT modified.
 */
export function reviewStateForReportStatus(status: ReportStatusId): ReviewItemState | null {
  switch (status) {
    case "draft":
      return "draft";
    case "ready_for_review":
      return "awaiting_review";
    case "published":
      return "published";
    default:
      return null;
  }
}

/** The artifact type a bridged domain row shadows under. */
export const ROADMAP_ARTIFACT_TYPE: ReviewArtifactType = "roadmap_draft";
export const REPORT_ARTIFACT_TYPE: ReviewArtifactType = "quarterly_report";

/**
 * Canonical serialization of a roadmap's review-relevant fields — the ONE
 * serializer for the type (design brief: stable key order; ids/enums and the
 * reviewed content the row itself holds). The sha256 of this string is the
 * shadow's `artifactDigest` — the DIGEST is stored, never this content.
 *
 * Deliberately EXCLUDED: `status` and the workflow stamps
 * (approvedByStaffId/approvedAt/publishedAt) — the digest identifies the
 * reviewed CONTENT and must be stable across workflow transitions, or every
 * move would invalidate its own review — and `createdAt` (volatile metadata,
 * not reviewed content).
 */
export function canonicalRoadmapSerialization(
  roadmap: Pick<Roadmap, "id" | "clientId" | "title" | "stageAtCreation" | "aiRunId" | "createdByStaffId">,
): string {
  return `AFLO-BRIDGE-ROADMAP.v1::${JSON.stringify({
    id: roadmap.id,
    clientId: roadmap.clientId,
    title: roadmap.title,
    stageAtCreation: roadmap.stageAtCreation,
    aiRunId: roadmap.aiRunId,
    createdByStaffId: roadmap.createdByStaffId,
  })}`;
}

/**
 * Canonical serialization of a quarterly report's review-relevant fields —
 * the ONE serializer for the type. Same exclusion rule: `status` and volatile
 * timestamps (`generatedAt`) stay out so the digest is stable across workflow
 * transitions; highlights/focus ARE the reviewed content the row holds.
 */
export function canonicalReportSerialization(
  report: Pick<
    QuarterlyReport,
    "id" | "clientId" | "quarter" | "stageAtGeneration" | "highlights" | "focusForNextQuarter"
  >,
): string {
  return `AFLO-BRIDGE-REPORT.v1::${JSON.stringify({
    id: report.id,
    clientId: report.clientId,
    quarter: report.quarter,
    stageAtGeneration: report.stageAtGeneration,
    highlights: report.highlights,
    focusForNextQuarter: report.focusForNextQuarter,
  })}`;
}
