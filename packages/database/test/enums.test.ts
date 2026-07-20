import { describe, expect, it } from "vitest";
import {
  ACTION_STATUSES,
  DOCUMENT_REVIEW_STATUSES,
  LIFECYCLE_STAGES,
  MESSAGE_SENDER_ROLES,
  REPORT_STATUSES,
  ROADMAP_STATUSES,
  THREAD_STATUSES,
} from "@aflo/rules";
import { CONSENT_TYPES, NOTIFICATION_CHANNELS, NOTIFICATION_TYPES } from "@aflo/notifications";
import { AGENT_NAMES, type AgentStatus, type ReviewStatus } from "@aflo/ai";
import {
  PARTNER_CATEGORIES,
  PARTNER_REFERRAL_STATUSES,
  REFERRAL_OUTCOMES,
} from "@aflo/partner-marketplace";
import type {
  Appointment,
  ClientDocument,
  ClientStatus,
  CreditProfile,
  EducationAssignment,
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
  agentNameEnum,
  agentStatusEnum,
  aiReviewStatusEnum,
  educationReviewStatusEnum,
  memberRoleEnum,
  messageSenderRoleEnum,
  milestoneStatusEnum,
  monthlyActionCategoryEnum,
  threadStatusEnum,
  notificationChannelEnum,
  notificationTypeEnum,
  partnerCategoryEnum,
  partnerReferralStatusEnum,
  referralOutcomeEnum,
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

  it("thread_status == THREAD_STATUSES (messaging kernel)", () => {
    expect(threadStatusEnum.enumValues).toEqual([...THREAD_STATUSES]);
    expect(threadStatusEnum.enumValues).toEqual(["open", "closed"]);
  });

  it("message_sender_role == MESSAGE_SENDER_ROLES (messaging kernel)", () => {
    expect(messageSenderRoleEnum.enumValues).toEqual([...MESSAGE_SENDER_ROLES]);
    expect(messageSenderRoleEnum.enumValues).toEqual(["staff", "client"]);
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

/**
 * Phase A1b enums. Package-array-derived enums are built from the source
 * `as const` arrays and asserted equal to them; the AI status enums are
 * canonical here and asserted via indexed access into the @aflo/ai unions.
 */
describe("Phase A1b sibling-package + AI enums", () => {
  it("partner_category == PARTNER_CATEGORIES", () => {
    expect(partnerCategoryEnum.enumValues).toEqual([...PARTNER_CATEGORIES]);
  });

  it("partner_referral_status == PARTNER_REFERRAL_STATUSES", () => {
    expect(partnerReferralStatusEnum.enumValues).toEqual([...PARTNER_REFERRAL_STATUSES]);
  });

  it("referral_outcome == REFERRAL_OUTCOMES", () => {
    expect(referralOutcomeEnum.enumValues).toEqual([...REFERRAL_OUTCOMES]);
  });

  it("notification_type == NOTIFICATION_TYPES", () => {
    expect(notificationTypeEnum.enumValues).toEqual([...NOTIFICATION_TYPES]);
  });

  it("notification_channel == NOTIFICATION_CHANNELS", () => {
    expect(notificationChannelEnum.enumValues).toEqual([...NOTIFICATION_CHANNELS]);
  });

  it("agent_name == AGENT_NAMES (the 12 sub-agents)", () => {
    expect(agentNameEnum.enumValues).toEqual([...AGENT_NAMES]);
    expect(agentNameEnum.enumValues).toHaveLength(12);
  });

  it("education_review_status == EducationAssignment.staffReviewStatus", () => {
    const all: EducationAssignment["staffReviewStatus"][] = ["not_required", "pending_review", "approved"];
    expect(educationReviewStatusEnum.enumValues).toEqual(all);
  });

  it("agent_status == AgentStatus", () => {
    const all: AgentStatus[] = ["ok", "needs_clarification", "insufficient_data", "blocked"];
    expect(agentStatusEnum.enumValues).toEqual(all);
  });

  it("ai_review_status == ReviewStatus", () => {
    const all: ReviewStatus[] = ["pending_review", "approved", "rejected", "auto_published"];
    expect(aiReviewStatusEnum.enumValues).toEqual(all);
  });
});
