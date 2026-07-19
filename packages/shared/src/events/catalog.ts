/**
 * AFLO domain event catalog (client-lifecycle foundation, slice A).
 *
 * The canonical list of lifecycle events the platform emits. Names are
 * PascalCase business facts in the past tense. Every event flows through the
 * PostgreSQL outbox (DATABASE_SCHEMA.md §9.4) — no external broker in V1.
 */

export const EVENT_TYPES = [
  "LeadCreated",
  "LeadStatusChanged",
  "IntakeStarted",
  "IntakeSectionCompleted",
  "IntakeCompleted",
  "ClientActivated",
  "FinancialProfileUpdated",
  "CreditProfileUpdated",
  "GoalCreated",
  "ReadinessAssessed",
  "RoadmapDrafted",
  "RoadmapApproved",
  "RoadmapPublished",
  "MilestoneActivated",
  "TaskAssigned",
  "TaskCompleted",
  "DocumentRequested",
  "DocumentUploaded",
  "DocumentReviewed",
  "AppointmentScheduled",
  "EngagementRiskDetected",
  "ProgressReportGenerated",
  "ProgressReportPublished",
  "EducationAssigned",
  "EducationCompleted",
  "PartnerReferralCreated",
  "ConsentGranted",
  "ConsentRevoked",
  "MessagePosted",
  "MessageRead",
] as const;

export type EventType = (typeof EVENT_TYPES)[number];

/** Aggregate kinds an event may attach to. */
export const AGGREGATE_TYPES = [
  "lead",
  "client",
  "financial_profile",
  "credit_profile",
  "goal",
  "readiness_assessment",
  "roadmap",
  "milestone",
  "task",
  "document",
  "appointment",
  "report",
  "education_assignment",
  "referral",
  "consent",
  "conversation",
] as const;

export type AggregateType = (typeof AGGREGATE_TYPES)[number];

/** The aggregate type each event must attach to — validated at creation. */
export const EVENT_AGGREGATE: Record<EventType, AggregateType> = {
  LeadCreated: "lead",
  LeadStatusChanged: "lead",
  IntakeStarted: "client",
  IntakeSectionCompleted: "client",
  IntakeCompleted: "client",
  ClientActivated: "client",
  FinancialProfileUpdated: "financial_profile",
  CreditProfileUpdated: "credit_profile",
  GoalCreated: "goal",
  ReadinessAssessed: "readiness_assessment",
  RoadmapDrafted: "roadmap",
  RoadmapApproved: "roadmap",
  RoadmapPublished: "roadmap",
  MilestoneActivated: "milestone",
  TaskAssigned: "task",
  TaskCompleted: "task",
  DocumentRequested: "document",
  DocumentUploaded: "document",
  DocumentReviewed: "document",
  AppointmentScheduled: "appointment",
  EngagementRiskDetected: "client",
  ProgressReportGenerated: "report",
  ProgressReportPublished: "report",
  EducationAssigned: "education_assignment",
  EducationCompleted: "education_assignment",
  PartnerReferralCreated: "referral",
  ConsentGranted: "consent",
  ConsentRevoked: "consent",
  MessagePosted: "conversation",
  MessageRead: "conversation",
};

/**
 * Per-type schema version. Bump when a payload shape changes incompatibly;
 * consumers use (event_type, event_version) to select a decoder. All types
 * start at 1.
 */
export const EVENT_VERSIONS: Record<EventType, number> = {
  LeadCreated: 1,
  LeadStatusChanged: 1,
  IntakeStarted: 1,
  IntakeSectionCompleted: 1,
  IntakeCompleted: 1,
  ClientActivated: 1,
  FinancialProfileUpdated: 1,
  CreditProfileUpdated: 1,
  GoalCreated: 1,
  ReadinessAssessed: 1,
  RoadmapDrafted: 1,
  RoadmapApproved: 1,
  RoadmapPublished: 1,
  MilestoneActivated: 1,
  TaskAssigned: 1,
  TaskCompleted: 1,
  DocumentRequested: 1,
  DocumentUploaded: 1,
  DocumentReviewed: 1,
  AppointmentScheduled: 1,
  EngagementRiskDetected: 1,
  ProgressReportGenerated: 1,
  ProgressReportPublished: 1,
  EducationAssigned: 1,
  EducationCompleted: 1,
  PartnerReferralCreated: 1,
  ConsentGranted: 1,
  ConsentRevoked: 1,
  MessagePosted: 1,
  MessageRead: 1,
};
