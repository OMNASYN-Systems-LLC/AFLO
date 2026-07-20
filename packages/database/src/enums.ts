import { pgEnum } from "drizzle-orm/pg-core";
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
import { AGENT_NAMES } from "@aflo/ai";
import {
  PARTNER_CATEGORIES,
  PARTNER_REFERRAL_STATUSES,
  REFERRAL_OUTCOMES,
} from "@aflo/partner-marketplace";

/**
 * Postgres enum types (Drizzle, ADR-0005).
 *
 * Where an enum is owned by the deterministic kernel, the pgEnum is built
 * directly from the kernel's constant array — the database and the rules can
 * never disagree, because they are the same source. Enums with no kernel
 * array are declared here as the canonical list and lockstep-tested.
 *
 * Reconciled to the IMPLEMENTED model (slices C–M), which supersedes the
 * original schema-proposal enums: leads and clients are one table keyed by
 * `client_kind` with a configurable `pipeline_stage_id` (no `lead_status`
 * enum); documents and tasks use the kernel review/status vocabularies.
 */

const tuple = <T extends readonly string[]>(values: T): [string, ...string[]] =>
  values as unknown as [string, ...string[]];

// --- Kernel-owned (built from the deterministic constants) ---
export const lifecycleStageEnum = pgEnum("lifecycle_stage", tuple(LIFECYCLE_STAGES));
export const roadmapStatusEnum = pgEnum("roadmap_status", tuple(ROADMAP_STATUSES));
export const reportStatusEnum = pgEnum("report_status", tuple(REPORT_STATUSES));
export const documentReviewStatusEnum = pgEnum("document_review_status", tuple(DOCUMENT_REVIEW_STATUSES));
export const actionStatusEnum = pgEnum("action_status", tuple(ACTION_STATUSES));
export const consentTypeEnum = pgEnum("consent_type", tuple(CONSENT_TYPES));

// --- Canonical here (lockstep-tested against the domain types) ---

/** Lead vs activated client — one `clients` table, discriminated by kind. */
export const clientKindEnum = pgEnum("client_kind", ["lead", "client"]);

/** Post-activation lifecycle status (domain ClientStatus); null while a lead. */
export const clientStatusEnum = pgEnum("client_status", ["active", "paused"]);

/** Structured-intake status (domain IntakeStatus). */
export const intakeStatusEnum = pgEnum("intake_status", ["in_progress", "completed"]);

/** Engagement classification (rules EngagementStatus). */
export const engagementStatusEnum = pgEnum("engagement_status", [
  "active",
  "cooling",
  "at_risk",
  "dormant",
]);

/**
 * Organization member roles. The DB carries the full V1 set (client and
 * partner_viewer principals are modeled as memberships when their slices
 * land); the staff-facing domain type is the first three. Platform Admin is a
 * user flag, never a role.
 */
export const memberRoleEnum = pgEnum("member_role", [
  "organization_owner",
  "organization_admin",
  "staff",
  "client",
  "partner_viewer",
]);

/** Appointment lifecycle (charter appointment states). */
export const appointmentStatusEnum = pgEnum("appointment_status", [
  "scheduled",
  "completed",
  "cancelled",
  "no_show",
]);

/** Outbox record lifecycle (DATABASE_SCHEMA.md §9.4). */
export const outboxStatusEnum = pgEnum("outbox_status", [
  "pending",
  "processing",
  "processed",
  "failed",
  "dead_letter",
]);

/** Communication delivery outcome (notification.v1.0.0 log). */
export const communicationStatusEnum = pgEnum("communication_status", ["sent", "suppressed"]);

// --- Phase A1: workflow-table enums (canonical here; lockstep-tested against
//     the domain field types via indexed access, e.g. Goal["category"][]). ---

/** Self-/staff-reported income stability (FinancialProfile.incomeStability). */
export const incomeStabilityEnum = pgEnum("income_stability", ["stable", "variable", "unstable"]);

/** Credit-score provenance — manual entry or uploaded report only, no bureau (CreditProfile.scoreSource). */
export const creditScoreSourceEnum = pgEnum("credit_score_source", ["manual_entry", "uploaded_report"]);

/** Goal category (Goal.category). */
export const goalCategoryEnum = pgEnum("goal_category", [
  "credit",
  "savings",
  "debt",
  "home_purchase",
  "business_capital",
  "other",
]);

/** Roadmap-milestone status (RoadmapMilestone.status = MilestoneStatus). Distinct from action_status. */
export const milestoneStatusEnum = pgEnum("milestone_status", ["upcoming", "in_progress", "completed"]);

/** Monthly-action category (MonthlyAction.category). */
export const monthlyActionCategoryEnum = pgEnum("monthly_action_category", [
  "payment",
  "savings",
  "documentation",
  "education",
  "habit",
]);

/** Document type (ClientDocument.docType). Metadata only; file bytes never in the DB. */
export const documentTypeEnum = pgEnum("document_type", [
  "credit_report",
  "income_verification",
  "bank_statement",
  "identification",
  "other",
]);

/** Appointment channel (Appointment.channel). */
export const appointmentChannelEnum = pgEnum("appointment_channel", ["video", "phone", "in_person"]);

// --- Phase A1b: sibling-package + AI enums. Package-array-derived ones are
//     built from the source `as const` arrays (tuple) so they can never drift;
//     the AI status enums are canonical here, lockstep-tested via indexed
//     access into the @aflo/ai unions. ---

/** Partner category (@aflo/partner-marketplace PARTNER_CATEGORIES). */
export const partnerCategoryEnum = pgEnum("partner_category", tuple(PARTNER_CATEGORIES));

/** Referral lifecycle status (@aflo/partner-marketplace PARTNER_REFERRAL_STATUSES). */
export const partnerReferralStatusEnum = pgEnum("partner_referral_status", tuple(PARTNER_REFERRAL_STATUSES));

/** Staff-observed referral outcome (@aflo/partner-marketplace REFERRAL_OUTCOMES). */
export const referralOutcomeEnum = pgEnum("referral_outcome", tuple(REFERRAL_OUTCOMES));

/** Notification type (@aflo/notifications NOTIFICATION_TYPES). */
export const notificationTypeEnum = pgEnum("notification_type", tuple(NOTIFICATION_TYPES));

/** Notification/delivery channel (@aflo/notifications NOTIFICATION_CHANNELS). */
export const notificationChannelEnum = pgEnum("notification_channel", tuple(NOTIFICATION_CHANNELS));

/** Credit-intelligence sub-agent name (@aflo/ai AGENT_NAMES — the 12 agents). */
export const agentNameEnum = pgEnum("agent_name", tuple(AGENT_NAMES));

/** Education assignment staff-review status (EducationAssignment.staffReviewStatus). */
export const educationReviewStatusEnum = pgEnum("education_review_status", [
  "not_required",
  "pending_review",
  "approved",
]);

/** Agent envelope status (@aflo/ai AgentStatus). Non-empty prohibited actions force `blocked`. */
export const agentStatusEnum = pgEnum("agent_status", [
  "ok",
  "needs_clarification",
  "insufficient_data",
  "blocked",
]);

/** Agent output human-review status (@aflo/ai ReviewStatus). */
export const aiReviewStatusEnum = pgEnum("ai_review_status", [
  "pending_review",
  "approved",
  "rejected",
  "auto_published",
]);

// --- Auth persistence (Production Cutover PHASE 2) ---

/** External identity provider (Clerk owns identity; extend by migration). */
export const identityProviderEnum = pgEnum("identity_provider", ["clerk"]);

/** Invitation lifecycle (@aflo/auth InvitationStatus). */
export const invitationStatusEnum = pgEnum("invitation_status", [
  "pending",
  "accepted",
  "revoked",
  "expired",
]);

/** Which side an invitation onboards (staff membership vs client link). */
export const invitationTypeEnum = pgEnum("invitation_type", ["staff", "client"]);

/**
 * The role an invitation grants — the @aflo/auth authorization Role vocabulary of
 * the four INVITABLE roles (platform_admin / partner_viewer are never invited).
 */
export const invitedRoleEnum = pgEnum("invited_role", [
  "organization_owner",
  "organization_admin",
  "staff_advisor",
  "client",
]);

/** Client↔user link lifecycle (@aflo/auth: a client is linked to exactly one active user). */
export const clientUserLinkStatusEnum = pgEnum("client_user_link_status", ["active", "revoked"]);

/** Provider webhook receipt processing status (@aflo/auth WebhookProcessingStatus). */
export const webhookEventStatusEnum = pgEnum("webhook_event_status", [
  "received",
  "processed",
  "failed",
]);

// --- Secure messaging (Production Cutover PHASE 10) ---
// Kernel-owned: built from the @aflo/rules messaging constants, so the DB enum
// and the deterministic messaging kernel can never disagree.

/** Secure-thread lifecycle (@aflo/rules THREAD_STATUSES: open | closed). */
export const threadStatusEnum = pgEnum("thread_status", tuple(THREAD_STATUSES));

/** Which side authored a message (@aflo/rules MESSAGE_SENDER_ROLES: staff | client). */
export const messageSenderRoleEnum = pgEnum("message_sender_role", tuple(MESSAGE_SENDER_ROLES));
