import { describe, expect, it } from "vitest";
import {
  ACTION_STATUSES,
  DOCUMENT_REVIEW_STATUSES,
  LIFECYCLE_STAGES,
  REPORT_STATUSES,
  ROADMAP_STATUSES,
} from "@aflo/rules";
import { CONSENT_TYPES } from "@aflo/notifications";
import type { ClientStatus, IntakeStatus, MemberRole } from "@aflo/shared";
import {
  actionStatusEnum,
  clientStatusEnum,
  consentTypeEnum,
  documentReviewStatusEnum,
  intakeStatusEnum,
  lifecycleStageEnum,
  memberRoleEnum,
  reportStatusEnum,
  roadmapStatusEnum,
} from "../src/enums";

/**
 * Lockstep: the Postgres enums must match the implemented kernel/domain
 * vocabularies exactly. Kernel-owned enums are built FROM the constant
 * arrays, so these assert the derivation held; the domain-owned enums are
 * asserted against the domain types via representative value sets.
 */

describe("kernel-owned enums are the kernel arrays", () => {
  it("lifecycle_stage == LIFECYCLE_STAGES (order preserved)", () => {
    expect(lifecycleStageEnum.enumValues).toEqual([...LIFECYCLE_STAGES]);
  });

  it("roadmap_status == ROADMAP_STATUSES", () => {
    expect(roadmapStatusEnum.enumValues).toEqual([...ROADMAP_STATUSES]);
  });

  it("report_status == REPORT_STATUSES", () => {
    expect(reportStatusEnum.enumValues).toEqual([...REPORT_STATUSES]);
  });

  it("document_review_status == DOCUMENT_REVIEW_STATUSES (implemented vocabulary, not the stale proposal)", () => {
    expect(documentReviewStatusEnum.enumValues).toEqual([...DOCUMENT_REVIEW_STATUSES]);
    // Guard against regressing to the original proposal's enum.
    expect(documentReviewStatusEnum.enumValues).toContain("requested");
    expect(documentReviewStatusEnum.enumValues).toContain("needs_attention");
  });

  it("action_status == ACTION_STATUSES", () => {
    expect(actionStatusEnum.enumValues).toEqual([...ACTION_STATUSES]);
  });

  it("consent_type == CONSENT_TYPES", () => {
    expect(consentTypeEnum.enumValues).toEqual([...CONSENT_TYPES]);
  });
});

describe("domain-owned enums cover the domain types exactly", () => {
  it("client_status covers ClientStatus", () => {
    const all: ClientStatus[] = ["active", "paused"];
    expect(clientStatusEnum.enumValues).toEqual(all);
  });

  it("intake_status covers IntakeStatus", () => {
    const all: IntakeStatus[] = ["in_progress", "completed"];
    expect(intakeStatusEnum.enumValues).toEqual(all);
  });

  it("member_role is a superset of the staff-facing MemberRole", () => {
    const staffFacing: MemberRole[] = ["organization_owner", "organization_admin", "staff"];
    for (const role of staffFacing) expect(memberRoleEnum.enumValues).toContain(role);
    // Client and partner_viewer principals are DB-modeled ahead of their slices.
    expect(memberRoleEnum.enumValues).toContain("client");
    expect(memberRoleEnum.enumValues).toContain("partner_viewer");
  });
});
