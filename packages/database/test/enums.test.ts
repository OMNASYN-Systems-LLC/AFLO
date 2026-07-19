import { describe, expect, it } from "vitest";
import {
  ACTION_STATUSES,
  DOCUMENT_REVIEW_STATUSES,
  LIFECYCLE_STAGES,
  REPORT_STATUSES,
  ROADMAP_STATUSES,
} from "@aflo/rules";
import { CONSENT_TYPES } from "@aflo/notifications";
import type {
  Appointment,
  ClientDocument,
  ClientStatus,
  CreditProfile,
  FinancialProfile,
  Goal,
  IntakeStatus,
  MemberRole,
  MilestoneStatus,
  MonthlyAction,
} from "@aflo/shared";
import {
  actionStatusEnum,
  appointmentChannelEnum,
  clientStatusEnum,
  consentTypeEnum,
  creditScoreSourceEnum,
  documentReviewStatusEnum,
  documentTypeEnum,
  goalCategoryEnum,
  incomeStabilityEnum,
  intakeStatusEnum,
  lifecycleStageEnum,
  memberRoleEnum,
  milestoneStatusEnum,
  monthlyActionCategoryEnum,
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

/**
 * Phase A1 workflow enums. These have no exported named type alias, so they
 * are asserted via indexed access into the domain interface — a change to the
 * domain union becomes a compile error in the literal array here, forcing the
 * enum (and its migration) to be updated in lockstep.
 */
describe("Phase A1 workflow enums cover the domain field types", () => {
  it("income_stability == FinancialProfile.incomeStability", () => {
    const all: FinancialProfile["incomeStability"][] = ["stable", "variable", "unstable"];
    expect(incomeStabilityEnum.enumValues).toEqual(all);
  });

  it("credit_score_source == CreditProfile.scoreSource", () => {
    const all: CreditProfile["scoreSource"][] = ["manual_entry", "uploaded_report"];
    expect(creditScoreSourceEnum.enumValues).toEqual(all);
  });

  it("goal_category == Goal.category", () => {
    const all: Goal["category"][] = [
      "credit",
      "savings",
      "debt",
      "home_purchase",
      "business_capital",
      "other",
    ];
    expect(goalCategoryEnum.enumValues).toEqual(all);
  });

  it("milestone_status == MilestoneStatus (distinct from action_status)", () => {
    const all: MilestoneStatus[] = ["upcoming", "in_progress", "completed"];
    expect(milestoneStatusEnum.enumValues).toEqual(all);
    expect(milestoneStatusEnum.enumValues).not.toContain("todo");
  });

  it("monthly_action_category == MonthlyAction.category", () => {
    const all: MonthlyAction["category"][] = ["payment", "savings", "documentation", "education", "habit"];
    expect(monthlyActionCategoryEnum.enumValues).toEqual(all);
  });

  it("document_type == ClientDocument.docType", () => {
    const all: ClientDocument["docType"][] = [
      "credit_report",
      "income_verification",
      "bank_statement",
      "identification",
      "other",
    ];
    expect(documentTypeEnum.enumValues).toEqual(all);
  });

  it("appointment_channel == Appointment.channel", () => {
    const all: Appointment["channel"][] = ["video", "phone", "in_person"];
    expect(appointmentChannelEnum.enumValues).toEqual(all);
  });
});
