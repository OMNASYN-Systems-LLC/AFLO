import { describe, expect, it } from "vitest";
import {
  REPORT_STATUSES,
  ROADMAP_STATUSES,
  reportTransition,
  reviewItemTransition,
  roadmapTransition,
  roadmapTransitionsFrom,
  type ReportStatusId,
  type ReviewItemState,
  type RoadmapStatus,
} from "@aflo/rules";
import {
  BRIDGED_ARTIFACT_TYPES,
  BRIDGED_ARTIFACT_REVISION,
  canonicalReportSerialization,
  canonicalRoadmapSerialization,
  isBridgedArtifactType,
  reviewStateForReportStatus,
  reviewStateForRoadmapStatus,
} from "../src/store/review-bridges";

/**
 * ADR-0049 pure bridge tests — the §6.5 mitigations (b) and (c):
 *
 *   (b) shadow states are DERIVED via the two pure mapping functions —
 *       exhaustively pinned here, null only for unknown input;
 *   (c) LOCKSTEP — for EVERY legal domain transition, the derived shadow move
 *       is realizable exclusively through legal review_center.v1.0.0 edges:
 *       forward moves walk the spine one legal edge at a time, regressions to
 *       `draft` use the kernel's own revision path (supersede + a NEW item
 *       born in a legal birth state — the kernel has NO return edges, which
 *       this file proves rather than assumes), and archival maps to a single
 *       legal `superseded` edge. No mapped pair ever requires an edge the
 *       kernel does not allow-list.
 */

const ROADMAP_MAPPING: Record<RoadmapStatus, ReviewItemState> = {
  draft: "draft",
  staff_review: "awaiting_review",
  approved: "approved",
  published: "published",
  archived: "superseded",
};

const REPORT_MAPPING: Record<ReportStatusId, ReviewItemState> = {
  draft: "draft",
  ready_for_review: "awaiting_review",
  published: "published",
};

describe("bridged type roster", () => {
  it("bridges exactly roadmap_draft and quarterly_report in this slice", () => {
    expect(BRIDGED_ARTIFACT_TYPES).toEqual(["roadmap_draft", "quarterly_report"]);
    expect(isBridgedArtifactType("roadmap_draft")).toBe(true);
    expect(isBridgedArtifactType("quarterly_report")).toBe(true);
    for (const native of [
      "readiness_assessment",
      "concierge_recommendation",
      "document_interpretation",
      "financial_summary",
      "educational_assignment",
      "partner_referral",
      "client_communication",
      "stage_advancement",
      "",
      "roadmap",
    ]) {
      expect(isBridgedArtifactType(native), native).toBe(false);
    }
  });

  it("the bridged revision is the documented monotonic starting revision", () => {
    expect(BRIDGED_ARTIFACT_REVISION).toBe("1");
  });
});

describe("reviewStateForRoadmapStatus — exhaustive", () => {
  it("maps every roadmap.v1.0.0 status (null only for unknown input)", () => {
    for (const status of ROADMAP_STATUSES) {
      expect(reviewStateForRoadmapStatus(status), status).toBe(ROADMAP_MAPPING[status]);
    }
    expect(reviewStateForRoadmapStatus("bogus" as RoadmapStatus)).toBeNull();
  });
});

describe("reviewStateForReportStatus — exhaustive", () => {
  it("maps every report.v1.0.0 status (null only for unknown input)", () => {
    for (const status of REPORT_STATUSES) {
      expect(reviewStateForReportStatus(status), status).toBe(REPORT_MAPPING[status]);
    }
    expect(reviewStateForReportStatus("bogus" as ReportStatusId)).toBeNull();
  });
});

/**
 * The shadow-walk SPEC (mirrors the store's `syncBridgedShadow` exactly):
 * returns the ordered list of kernel edges the bridge applies for one domain
 * transition, where a `["*", "draft"]` entry means "mint a NEW item born
 * draft" (creation, not a transition — legal birth states are draft and
 * awaiting_review only, the C1 gate).
 */
function shadowEdges(from: ReviewItemState, to: ReviewItemState): Array<[ReviewItemState | "*", ReviewItemState]> {
  if (from === to) return [];
  if (to === "superseded") return [[from, "superseded"]];
  if (to === "draft") return [[from, "superseded"], ["*", "draft"]]; // revision path
  const SPINE: ReviewItemState[] = ["draft", "awaiting_review", "approved", "published"];
  const edges: Array<[ReviewItemState, ReviewItemState]> = [];
  for (let i = SPINE.indexOf(from); i < SPINE.indexOf(to); i += 1) {
    edges.push([SPINE[i]!, SPINE[i + 1]!]);
  }
  return edges;
}

describe("LOCKSTEP — every legal domain transition derives a shadow path of legal kernel edges", () => {
  it("proves the kernel has NO return edges (the regression path is required, not chosen)", () => {
    expect(reviewItemTransition("awaiting_review", "draft").allowed).toBe(false);
    expect(reviewItemTransition("approved", "draft").allowed).toBe(false);
    expect(reviewItemTransition("published", "draft").allowed).toBe(false);
  });

  it("roadmap.v1.0.0: every allow-listed move maps to legal kernel edges only", () => {
    let checkedPairs = 0;
    for (const from of ROADMAP_STATUSES) {
      for (const to of roadmapTransitionsFrom(from)) {
        expect(roadmapTransition(from, to).allowed, `${from}→${to}`).toBe(true); // domain leg legal
        const srcState = reviewStateForRoadmapStatus(from)!;
        const dstState = reviewStateForRoadmapStatus(to)!;
        for (const [edgeFrom, edgeTo] of shadowEdges(srcState, dstState)) {
          if (edgeFrom === "*") {
            // Creation leg: must be a legal BIRTH state (C1 gate), never an edge.
            expect(["draft", "awaiting_review"], `${from}→${to} birth`).toContain(edgeTo);
          } else {
            expect(
              reviewItemTransition(edgeFrom, edgeTo).allowed,
              `${from}→${to} shadow edge ${edgeFrom}→${edgeTo}`,
            ).toBe(true);
          }
        }
        checkedPairs += 1;
      }
    }
    expect(checkedPairs).toBe(7); // the exact size of the roadmap allow-list
  });

  it("report.v1.0.0: every allow-listed move maps to legal kernel edges only (publish carries two)", () => {
    const REPORT_ALLOWED: Array<[ReportStatusId, ReportStatusId]> = [
      ["draft", "ready_for_review"],
      ["ready_for_review", "published"],
      ["ready_for_review", "draft"],
    ];
    for (const [from, to] of REPORT_ALLOWED) {
      expect(reportTransition(from, to).allowed, `${from}→${to}`).toBe(true);
      const edges = shadowEdges(reviewStateForReportStatus(from)!, reviewStateForReportStatus(to)!);
      for (const [edgeFrom, edgeTo] of edges) {
        if (edgeFrom === "*") {
          expect(["draft", "awaiting_review"], `${from}→${to} birth`).toContain(edgeTo);
        } else {
          expect(
            reviewItemTransition(edgeFrom, edgeTo).allowed,
            `${from}→${to} shadow edge ${edgeFrom}→${edgeTo}`,
          ).toBe(true);
        }
      }
    }
    // The carry-through, explicitly: report publish = TWO legal kernel edges.
    expect(shadowEdges("awaiting_review", "published")).toEqual([
      ["awaiting_review", "approved"],
      ["approved", "published"],
    ]);
  });

  it("domain regressions never attempt an illegal shadow move: published domain rows cannot regress", () => {
    // roadmap published→draft and report published→anything are NOT legal
    // domain moves, so the bridge is never asked for a shadow regression from
    // published (published→superseded on archive is the only exit and IS legal).
    expect(roadmapTransition("published", "draft").allowed).toBe(false);
    expect(reportTransition("published", "draft").allowed).toBe(false);
    expect(reportTransition("published", "ready_for_review").allowed).toBe(false);
    expect(reviewItemTransition("published", "superseded").allowed).toBe(true);
  });
});

describe("canonical serializers — ONE per type, stable, content-only", () => {
  const roadmap = {
    id: "r-c-x",
    clientId: "c-x",
    title: "Utilization under 30%",
    stageAtCreation: "credit_readiness" as const,
    aiRunId: null,
    createdByStaffId: "s-boyd",
  };

  it("roadmap serialization is deterministic, prefixed, and ignores workflow state", () => {
    const a = canonicalRoadmapSerialization(roadmap);
    expect(a).toBe(canonicalRoadmapSerialization({ ...roadmap }));
    expect(a.startsWith("AFLO-BRIDGE-ROADMAP.v1::")).toBe(true);
    // Workflow position and stamps are NOT part of the reviewed content: two
    // rows differing only in status/approval/publication stamps serialize
    // identically (the digest must be stable across workflow transitions).
    const withWorkflowNoise = {
      ...roadmap,
      status: "published",
      approvedByStaffId: "s-mercer",
      approvedAt: "2026-07-01T00:00:00.000Z",
      publishedAt: "2026-07-02T00:00:00.000Z",
      createdAt: "2026-06-01T00:00:00.000Z",
    };
    expect(canonicalRoadmapSerialization(withWorkflowNoise)).toBe(a);
    // Content changes DO change it.
    expect(canonicalRoadmapSerialization({ ...roadmap, title: "Other" })).not.toBe(a);
    expect(canonicalRoadmapSerialization({ ...roadmap, aiRunId: "airun-1" })).not.toBe(a);
  });

  const report = {
    id: "qr-c-x-q2",
    clientId: "c-x",
    quarter: "2026-Q2",
    stageAtGeneration: "stabilization" as const,
    highlights: ["One", "Two"],
    focusForNextQuarter: "Hold the reserve floor.",
  };

  it("report serialization is deterministic, prefixed, and ignores workflow state", () => {
    const a = canonicalReportSerialization(report);
    expect(a).toBe(canonicalReportSerialization({ ...report, highlights: [...report.highlights] }));
    expect(a.startsWith("AFLO-BRIDGE-REPORT.v1::")).toBe(true);
    const withWorkflowNoise = { ...report, status: "published", generatedAt: "2026-07-01T00:00:00.000Z" };
    expect(canonicalReportSerialization(withWorkflowNoise)).toBe(a);
    expect(canonicalReportSerialization({ ...report, highlights: ["One"] })).not.toBe(a);
    expect(canonicalReportSerialization({ ...report, focusForNextQuarter: "Other." })).not.toBe(a);
  });

  it("the two serializers are domain-separated (same-shaped content can never collide)", () => {
    expect(canonicalRoadmapSerialization(roadmap)).not.toBe(
      canonicalReportSerialization({
        id: roadmap.id,
        clientId: roadmap.clientId,
        quarter: "2026-Q2",
        stageAtGeneration: "stabilization",
        highlights: [],
        focusForNextQuarter: "",
      }),
    );
  });
});
