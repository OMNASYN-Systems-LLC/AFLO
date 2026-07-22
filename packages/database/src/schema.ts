import { sql } from "drizzle-orm";
import {
  bigint,
  boolean,
  customType,
  date,
  index,
  integer,
  jsonb,
  numeric,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
  uuid,
  varchar,
} from "drizzle-orm/pg-core";
import {
  actionStatusEnum,
  agentNameEnum,
  agentStatusEnum,
  aiReviewStatusEnum,
  appointmentChannelEnum,
  appointmentStatusEnum,
  clientKindEnum,
  clientStatusEnum,
  clientUserLinkStatusEnum,
  communicationStatusEnum,
  consentTypeEnum,
  identityProviderEnum,
  invitationStatusEnum,
  invitationTypeEnum,
  invitedRoleEnum,
  messageSenderRoleEnum,
  threadStatusEnum,
  webhookEventStatusEnum,
  creditScoreSourceEnum,
  documentReviewStatusEnum,
  documentTypeEnum,
  educationReviewStatusEnum,
  goalCategoryEnum,
  incomeStabilityEnum,
  intakeStatusEnum,
  lifecycleStageEnum,
  memberRoleEnum,
  milestoneStatusEnum,
  monthlyActionCategoryEnum,
  notificationChannelEnum,
  notificationTypeEnum,
  outboxStatusEnum,
  partnerCategoryEnum,
  partnerReferralStatusEnum,
  referralOutcomeEnum,
  reportStatusEnum,
  roadmapStatusEnum,
} from "./enums";

/**
 * AFLO core schema (Drizzle, ADR-0005) — identity, tenancy, governance, CRM,
 * and the client-workflow tables. Reconciled to the implemented model. Phase A1
 * added the workflow tables for the already-implemented domains (readiness,
 * financial/credit profiles, goals, roadmaps + milestones, monthly actions,
 * documents, appointments, quarterly reports, notes, round-up simulator) and
 * Phase A1b added the sibling-package + AI tables (partners, referrals with the
 * inline neutrality record, education assignments, notification preferences,
 * communications log, ai_runs agent-envelope provenance, and signed handoff
 * packages). Tables for unbuilt domains (conversation/resolution/provider/card)
 * stay deferred. The Neon connection and repository swap are gated on
 * DATABASE_URL; RLS DDL is the next defense-in-depth slice.
 *
 * AFLO never stores raw PII: phone and date-of-birth columns are
 * application-layer-encrypted bytea (never plaintext), and no card, SSN, or
 * bank-account data is modeled at all (charter).
 */

/** Application-layer-encrypted binary column (ciphertext only, never plaintext PII). */
const encrypted = customType<{ data: Buffer; driverData: Buffer }>({
  dataType: () => "bytea",
});

const timestamps = {
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
};

export const organizations = pgTable("organizations", {
  id: uuid("id").primaryKey().defaultRandom(),
  name: text("name").notNull(),
  slug: text("slug").notNull().unique(),
  isActive: boolean("is_active").notNull().default(true),
  /** Configurable pipeline, intake, and other tenant settings (charter). */
  settings: jsonb("settings").notNull().default(sql`'{}'::jsonb`),
  ...timestamps,
});

export const users = pgTable("users", {
  id: uuid("id").primaryKey().defaultRandom(),
  /** Auth-provider subject (Clerk/Auth.js); null until auth integration. */
  authProviderId: text("auth_provider_id").unique(),
  email: text("email").notNull().unique(),
  displayName: text("display_name").notNull(),
  phoneEncrypted: encrypted("phone_encrypted"),
  /** Platform-level flag — Platform Admin is never a membership role. */
  isPlatformAdmin: boolean("is_platform_admin").notNull().default(false),
  isActive: boolean("is_active").notNull().default(true),
  /**
   * Session-revocation cutoff (ADR-0024/0035): a session issued before this
   * instant no longer resolves. NULL = nothing revoked. Set by disable-account
   * and sign-out-everywhere; read by the PrincipalDirectory on every request.
   */
  sessionsInvalidatedBefore: timestamp("sessions_invalidated_before", { withTimezone: true }),
  ...timestamps,
});

export const organizationMembers = pgTable(
  "organization_members",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    organizationId: uuid("organization_id")
      .notNull()
      .references(() => organizations.id, { onDelete: "cascade" }),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    role: memberRoleEnum("role").notNull(),
    title: text("title"),
    isActive: boolean("is_active").notNull().default(true),
    ...timestamps,
  },
  (t) => [
    uniqueIndex("uq_org_members_org_user").on(t.organizationId, t.userId),
    index("idx_org_members_org_role").on(t.organizationId, t.role),
    index("idx_org_members_user").on(t.userId),
  ],
);

export const consentRecords = pgTable(
  "consent_records",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    organizationId: uuid("organization_id")
      .notNull()
      .references(() => organizations.id, { onDelete: "restrict" }),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "restrict" }),
    consentType: consentTypeEnum("consent_type").notNull(),
    version: text("version").notNull(),
    granted: boolean("granted").notNull(),
    grantedAt: timestamp("granted_at", { withTimezone: true }).notNull().defaultNow(),
    revokedAt: timestamp("revoked_at", { withTimezone: true }),
    source: text("source").notNull(),
    /** Salted hash, never a raw IP. */
    ipHash: varchar("ip_hash", { length: 64 }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index("idx_consent_org_user").on(t.organizationId, t.userId, t.consentType)],
);

/** Rule metadata registry mirror (kernel is the runtime source of truth). */
export const ruleVersions = pgTable(
  "rule_versions",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    ruleId: text("rule_id").notNull(),
    version: text("version").notNull(),
    effectiveDate: timestamp("effective_date", { withTimezone: true }).notNull(),
    description: text("description").notNull(),
    definition: jsonb("definition").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [uniqueIndex("uq_rule_versions_rule_version").on(t.ruleId, t.version)],
);

/** Append-only audit trail (every material state change). */
export const auditEvents = pgTable(
  "audit_events",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    organizationId: uuid("organization_id")
      .notNull()
      .references(() => organizations.id, { onDelete: "restrict" }),
    actorMemberId: uuid("actor_member_id").references(() => organizationMembers.id, {
      onDelete: "set null",
    }),
    action: text("action").notNull(),
    targetType: text("target_type").notNull(),
    targetId: text("target_id").notNull(),
    detail: text("detail"),
    reasonCode: text("reason_code"),
    ruleVersion: text("rule_version"),
    occurredAt: timestamp("occurred_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index("idx_audit_org_occurred").on(t.organizationId, t.occurredAt)],
);

/** Transactional outbox — the only event dispatch mechanism in V1 (§9.4). */
export const outbox = pgTable(
  "outbox",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    eventId: uuid("event_id").notNull().unique(),
    eventType: text("event_type").notNull(),
    eventVersion: integer("event_version").notNull(),
    organizationId: uuid("organization_id").notNull(),
    aggregateType: text("aggregate_type").notNull(),
    aggregateId: text("aggregate_id").notNull(),
    payload: jsonb("payload").notNull(),
    status: outboxStatusEnum("status").notNull().default("pending"),
    attempts: integer("attempts").notNull().default(0),
    maxAttempts: integer("max_attempts").notNull().default(5),
    nextAttemptAt: timestamp("next_attempt_at", { withTimezone: true }).notNull().defaultNow(),
    lockedBy: text("locked_by"),
    lockedAt: timestamp("locked_at", { withTimezone: true }),
    lastError: text("last_error"),
    deadLetter: boolean("dead_letter").notNull().default(false),
    processedAt: timestamp("processed_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index("idx_outbox_status_next").on(t.status, t.nextAttemptAt)],
);

/**
 * Unified lead/client record (implemented model). A `lead` moves through the
 * configurable pipeline (`pipeline_stage_id`, resolved against
 * organizations.settings) and becomes a `client` at the terminal stage;
 * `client_status` is null until then.
 */
export const clients = pgTable(
  "clients",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    organizationId: uuid("organization_id")
      .notNull()
      .references(() => organizations.id, { onDelete: "cascade" }),
    userId: uuid("user_id").references(() => users.id, { onDelete: "set null" }),
    kind: clientKindEnum("kind").notNull().default("lead"),
    pipelineStageId: text("pipeline_stage_id").notNull(),
    clientStatus: clientStatusEnum("client_status"),
    firstName: text("first_name").notNull(),
    lastName: text("last_name").notNull(),
    email: text("email"),
    phoneEncrypted: encrypted("phone_encrypted"),
    dateOfBirthEncrypted: encrypted("date_of_birth_encrypted"),
    assignedMemberId: uuid("assigned_member_id").references(() => organizationMembers.id, {
      onDelete: "set null",
    }),
    source: text("source"),
    joinedAt: timestamp("joined_at", { withTimezone: true }).notNull().defaultNow(),
    lastActivityAt: timestamp("last_activity_at", { withTimezone: true }).notNull().defaultNow(),
    ...timestamps,
  },
  (t) => [
    index("idx_clients_org_kind").on(t.organizationId, t.kind),
    index("idx_clients_org_stage").on(t.organizationId, t.pipelineStageId),
    index("idx_clients_org_assigned").on(t.organizationId, t.assignedMemberId),
  ],
);

/** Structured intake progress; completion decided only by intake.completeness. */
export const intakes = pgTable(
  "intakes",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    organizationId: uuid("organization_id")
      .notNull()
      .references(() => organizations.id, { onDelete: "cascade" }),
    clientId: uuid("client_id")
      .notNull()
      .references(() => clients.id, { onDelete: "cascade" }),
    definitionId: text("definition_id").notNull(),
    status: intakeStatusEnum("status").notNull().default("in_progress"),
    completedSectionIds: jsonb("completed_section_ids").notNull().default(sql`'[]'::jsonb`),
    startedAt: timestamp("started_at", { withTimezone: true }).notNull().defaultNow(),
    completedAt: timestamp("completed_at", { withTimezone: true }),
    ...timestamps,
  },
  (t) => [
    uniqueIndex("uq_intakes_client").on(t.clientId),
    index("idx_intakes_org_status").on(t.organizationId, t.status),
  ],
);

// ===========================================================================
// Phase A1 — workflow tables for the already-implemented domains. Every
// tenant-owned row carries organization_id (RLS enforcement point). Money is
// integer cents (bigint) to match the domain *Cents fields. `ai_run_id`
// columns are plain nullable uuids for now; their FK to the `ai_runs` table
// lands with the AI/sibling tables in the follow-up slice.
// ===========================================================================

/**
 * Append-only recorded readiness assessments (readiness.v1.0.0). The latest
 * row per client is the standing assessment; history is never mutated. AI never
 * writes this table — deterministic rule output only.
 */
export const readinessAssessments = pgTable(
  "readiness_assessments",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    organizationId: uuid("organization_id")
      .notNull()
      .references(() => organizations.id, { onDelete: "restrict" }),
    clientId: uuid("client_id")
      .notNull()
      .references(() => clients.id, { onDelete: "cascade" }),
    stage: lifecycleStageEnum("stage").notNull(),
    previousStage: lifecycleStageEnum("previous_stage"),
    ruleVersion: text("rule_version").notNull(),
    factsUsed: jsonb("facts_used").notNull().default(sql`'[]'::jsonb`),
    reasonCodes: jsonb("reason_codes").notNull().default(sql`'[]'::jsonb`),
    proposedNextAction: text("proposed_next_action").notNull().default(""),
    requiresHumanReview: boolean("requires_human_review").notNull().default(false),
    reviewReasonCodes: jsonb("review_reason_codes").notNull().default(sql`'[]'::jsonb`),
    assessedByMemberId: uuid("assessed_by_member_id").references(() => organizationMembers.id, {
      onDelete: "set null",
    }),
    assessedAt: timestamp("assessed_at", { withTimezone: true }).notNull().defaultNow(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index("idx_readiness_org_client_assessed").on(t.organizationId, t.clientId, t.assessedAt)],
);

/** Self-/staff-reported financial facts (one per client). Money is integer cents. */
export const financialProfiles = pgTable(
  "financial_profiles",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    organizationId: uuid("organization_id")
      .notNull()
      .references(() => organizations.id, { onDelete: "cascade" }),
    clientId: uuid("client_id")
      .notNull()
      .references(() => clients.id, { onDelete: "cascade" }),
    monthlyIncomeCents: bigint("monthly_income_cents", { mode: "number" }).notNull(),
    monthlyDebtPaymentsCents: bigint("monthly_debt_payments_cents", { mode: "number" }).notNull(),
    liquidSavingsCents: bigint("liquid_savings_cents", { mode: "number" }).notNull(),
    monthlyEssentialExpensesCents: bigint("monthly_essential_expenses_cents", { mode: "number" }).notNull(),
    incomeStability: incomeStabilityEnum("income_stability").notNull(),
    ...timestamps,
  },
  (t) => [uniqueIndex("uq_financial_profiles_client").on(t.clientId)],
);

/**
 * Credit profile — manual score entry or uploaded report only, no bureau pull
 * (charter). No SSN or raw bureau data is stored. One per client.
 */
export const creditProfiles = pgTable(
  "credit_profiles",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    organizationId: uuid("organization_id")
      .notNull()
      .references(() => organizations.id, { onDelete: "cascade" }),
    clientId: uuid("client_id")
      .notNull()
      .references(() => clients.id, { onDelete: "cascade" }),
    score: integer("score"),
    scoreSource: creditScoreSourceEnum("score_source").notNull(),
    scoreAsOf: date("score_as_of"),
    revolvingBalanceCents: bigint("revolving_balance_cents", { mode: "number" }).notNull(),
    revolvingLimitCents: bigint("revolving_limit_cents", { mode: "number" }).notNull(),
    openTradelines: integer("open_tradelines").notNull(),
    derogatoryMarks: integer("derogatory_marks").notNull(),
    /** 0..1 over trailing 24 months. */
    onTimePaymentRate: numeric("on_time_payment_rate", { precision: 4, scale: 3 }).notNull(),
    ...timestamps,
  },
  (t) => [uniqueIndex("uq_credit_profiles_client").on(t.clientId)],
);

/** Client goals (staff-maintained). At most one primary goal per client. */
export const goals = pgTable(
  "goals",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    organizationId: uuid("organization_id")
      .notNull()
      .references(() => organizations.id, { onDelete: "cascade" }),
    clientId: uuid("client_id")
      .notNull()
      .references(() => clients.id, { onDelete: "cascade" }),
    title: text("title").notNull(),
    category: goalCategoryEnum("category").notNull(),
    targetDate: date("target_date").notNull(),
    /** 0..100, staff-maintained (range enforced by the rules layer). */
    progressPct: integer("progress_pct").notNull().default(0),
    isPrimary: boolean("is_primary").notNull().default(false),
    ...timestamps,
  },
  (t) => [
    index("idx_goals_org_client").on(t.organizationId, t.clientId),
    // At most one primary goal per client.
    uniqueIndex("uq_goals_client_primary").on(t.clientId).where(sql`${t.isPrimary}`),
  ],
);

/**
 * Client roadmap moving through the approval workflow (roadmap.v1.0.0). Status
 * transitions are governed by the rules; `approved`/`published` carry the
 * approving member and timestamp.
 */
export const roadmaps = pgTable(
  "roadmaps",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    organizationId: uuid("organization_id")
      .notNull()
      .references(() => organizations.id, { onDelete: "cascade" }),
    clientId: uuid("client_id")
      .notNull()
      .references(() => clients.id, { onDelete: "cascade" }),
    title: text("title").notNull(),
    status: roadmapStatusEnum("status").notNull().default("draft"),
    stageAtCreation: lifecycleStageEnum("stage_at_creation").notNull(),
    /** Provenance when drafted by the roadmap-agent (ai_runs); null = manually authored. */
    aiRunId: uuid("ai_run_id").references(() => aiRuns.id, { onDelete: "set null" }),
    createdByMemberId: uuid("created_by_member_id")
      .notNull()
      .references(() => organizationMembers.id, { onDelete: "restrict" }),
    approvedByMemberId: uuid("approved_by_member_id").references(() => organizationMembers.id, {
      onDelete: "set null",
    }),
    approvedAt: timestamp("approved_at", { withTimezone: true }),
    publishedAt: timestamp("published_at", { withTimezone: true }),
    ...timestamps,
  },
  (t) => [index("idx_roadmaps_org_client_status").on(t.organizationId, t.clientId, t.status)],
);

/** Ordered roadmap milestones (strict children of a roadmap). */
export const roadmapMilestones = pgTable(
  "roadmap_milestones",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    organizationId: uuid("organization_id")
      .notNull()
      .references(() => organizations.id, { onDelete: "cascade" }),
    clientId: uuid("client_id")
      .notNull()
      .references(() => clients.id, { onDelete: "cascade" }),
    roadmapId: uuid("roadmap_id")
      .notNull()
      .references(() => roadmaps.id, { onDelete: "cascade" }),
    sortOrder: integer("sort_order").notNull().default(0),
    title: text("title").notNull(),
    description: text("description").notNull().default(""),
    status: milestoneStatusEnum("status").notNull().default("upcoming"),
    targetMonth: text("target_month").notNull(),
    ...timestamps,
  },
  (t) => [index("idx_milestones_org_roadmap_order").on(t.organizationId, t.roadmapId, t.sortOrder)],
);

/** Monthly action-plan items (action.v1.0.0). */
export const monthlyActions = pgTable(
  "monthly_actions",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    organizationId: uuid("organization_id")
      .notNull()
      .references(() => organizations.id, { onDelete: "cascade" }),
    clientId: uuid("client_id")
      .notNull()
      .references(() => clients.id, { onDelete: "cascade" }),
    month: text("month").notNull(),
    title: text("title").notNull(),
    category: monthlyActionCategoryEnum("category").notNull(),
    status: actionStatusEnum("status").notNull().default("todo"),
    dueDate: date("due_date"),
    ...timestamps,
  },
  (t) => [index("idx_monthly_actions_org_client_month").on(t.organizationId, t.clientId, t.month)],
);

/**
 * Document metadata and review state (document.v1.0.0). File bytes live in
 * Blob/S3 (encrypted storage key only); never the DB. No card/SSN/bank data.
 */
export const documents = pgTable(
  "documents",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    organizationId: uuid("organization_id")
      .notNull()
      .references(() => organizations.id, { onDelete: "restrict" }),
    clientId: uuid("client_id")
      .notNull()
      .references(() => clients.id, { onDelete: "restrict" }),
    name: text("name").notNull(),
    docType: documentTypeEnum("doc_type").notNull(),
    reviewStatus: documentReviewStatusEnum("review_status").notNull().default("requested"),
    /** App-encrypted Blob/S3 key (ciphertext only), never the file bytes. */
    storagePathEncrypted: encrypted("storage_path_encrypted"),
    checksumSha256: varchar("checksum_sha256", { length: 64 }),
    reviewedByMemberId: uuid("reviewed_by_member_id").references(() => organizationMembers.id, {
      onDelete: "set null",
    }),
    reviewedAt: timestamp("reviewed_at", { withTimezone: true }),
    uploadedByUserId: uuid("uploaded_by_user_id").references(() => users.id, { onDelete: "set null" }),
    ...timestamps,
  },
  (t) => [index("idx_documents_org_client_status").on(t.organizationId, t.clientId, t.reviewStatus)],
);

/** Appointments and reminders. The domain has no status field — none modeled. */
export const appointments = pgTable(
  "appointments",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    organizationId: uuid("organization_id")
      .notNull()
      .references(() => organizations.id, { onDelete: "cascade" }),
    clientId: uuid("client_id")
      .notNull()
      .references(() => clients.id, { onDelete: "cascade" }),
    memberId: uuid("member_id").references(() => organizationMembers.id, { onDelete: "set null" }),
    purpose: text("purpose").notNull(),
    scheduledAt: timestamp("scheduled_at", { withTimezone: true }).notNull(),
    channel: appointmentChannelEnum("channel").notNull(),
    reminderSentAt: timestamp("reminder_sent_at", { withTimezone: true }),
    ...timestamps,
  },
  (t) => [
    index("idx_appointments_org_scheduled").on(t.organizationId, t.scheduledAt),
    index("idx_appointments_org_client").on(t.organizationId, t.clientId),
  ],
);

/** Quarterly progress reports (report.v1.0.0). One per client per quarter. */
export const quarterlyReports = pgTable(
  "quarterly_reports",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    organizationId: uuid("organization_id")
      .notNull()
      .references(() => organizations.id, { onDelete: "restrict" }),
    clientId: uuid("client_id")
      .notNull()
      .references(() => clients.id, { onDelete: "restrict" }),
    quarter: text("quarter").notNull(),
    status: reportStatusEnum("status").notNull().default("draft"),
    stageAtGeneration: lifecycleStageEnum("stage_at_generation").notNull(),
    highlights: jsonb("highlights").notNull().default(sql`'[]'::jsonb`),
    focusForNextQuarter: text("focus_for_next_quarter").notNull().default(""),
    /** Provenance when drafted by the report-agent (ai_runs); null = manually authored. */
    aiRunId: uuid("ai_run_id").references(() => aiRuns.id, { onDelete: "set null" }),
    approvedByMemberId: uuid("approved_by_member_id").references(() => organizationMembers.id, {
      onDelete: "set null",
    }),
    approvedAt: timestamp("approved_at", { withTimezone: true }),
    generatedAt: timestamp("generated_at", { withTimezone: true }).notNull().defaultNow(),
    ...timestamps,
  },
  (t) => [uniqueIndex("uq_reports_client_quarter").on(t.clientId, t.quarter)],
);

/** Internal admin notes — never surfaced in the client portal. Insert-only. */
export const notes = pgTable(
  "notes",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    organizationId: uuid("organization_id")
      .notNull()
      .references(() => organizations.id, { onDelete: "cascade" }),
    clientId: uuid("client_id")
      .notNull()
      .references(() => clients.id, { onDelete: "cascade" }),
    authorMemberId: uuid("author_member_id")
      .notNull()
      .references(() => organizationMembers.id, { onDelete: "restrict" }),
    body: text("body").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index("idx_notes_org_client_created").on(t.organizationId, t.clientId, t.createdAt)],
);

/** Round-up simulator config (SIMULATION ONLY — never moves money). One per client. */
export const simulationSettings = pgTable(
  "simulation_settings",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    organizationId: uuid("organization_id")
      .notNull()
      .references(() => organizations.id, { onDelete: "cascade" }),
    clientId: uuid("client_id")
      .notNull()
      .references(() => clients.id, { onDelete: "cascade" }),
    roundToCents: integer("round_to_cents").notNull().default(100),
    multiplier: numeric("multiplier", { precision: 4, scale: 2 }).notNull().default("1.00"),
    enabled: boolean("enabled").notNull().default(true),
    ...timestamps,
  },
  (t) => [uniqueIndex("uq_simulation_settings_client").on(t.clientId)],
);

/**
 * Hypothetical round-up transactions (SIMULATION ONLY — never a real purchase).
 * `round_up_amount_cents` is the deterministic calculator output.
 */
export const virtualTransactions = pgTable(
  "virtual_transactions",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    organizationId: uuid("organization_id")
      .notNull()
      .references(() => organizations.id, { onDelete: "cascade" }),
    clientId: uuid("client_id")
      .notNull()
      .references(() => clients.id, { onDelete: "cascade" }),
    label: text("label").notNull(),
    amountCents: bigint("amount_cents", { mode: "number" }).notNull(),
    roundUpAmountCents: bigint("round_up_amount_cents", { mode: "number" }).notNull(),
    occurredOn: date("occurred_on").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index("idx_vtx_org_client_occurred").on(t.organizationId, t.clientId, t.occurredOn)],
);

// ===========================================================================
// Phase A1b — sibling-package + AI tables (partner directory/referrals,
// education, notifications/communications, agent-envelope provenance, and
// signed handoff packages). Every tenant-owned row carries organization_id.
// ===========================================================================

/**
 * Agent-envelope provenance (Credit Intelligence Engine). One row per agent
 * run, storing the full canonical AgentEnvelope. INVARIANT (enforced by the
 * orchestrator, mirrored here): a non-empty `prohibited_actions_detected`
 * forces `status = 'blocked'`, writes an audit event, and keeps the output out
 * of every review queue. Agents never mutate verified facts or execute
 * regulated actions.
 */
export const aiRuns = pgTable(
  "ai_runs",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    organizationId: uuid("organization_id")
      .notNull()
      .references(() => organizations.id, { onDelete: "restrict" }),
    clientId: uuid("client_id")
      .notNull()
      .references(() => clients.id, { onDelete: "restrict" }),
    agentName: agentNameEnum("agent_name").notNull(),
    agentVersion: text("agent_version").notNull(),
    status: agentStatusEnum("status").notNull(),
    confidence: numeric("confidence", { precision: 4, scale: 3 }).notNull(),
    factsUsed: jsonb("facts_used").notNull().default(sql`'[]'::jsonb`),
    missingFacts: jsonb("missing_facts").notNull().default(sql`'[]'::jsonb`),
    ruleVersionsUsed: jsonb("rule_versions_used").notNull().default(sql`'[]'::jsonb`),
    reasonCodes: jsonb("reason_codes").notNull().default(sql`'[]'::jsonb`),
    proposedActions: jsonb("proposed_actions").notNull().default(sql`'[]'::jsonb`),
    prohibitedActionsDetected: jsonb("prohibited_actions_detected").notNull().default(sql`'[]'::jsonb`),
    requiresHumanReview: boolean("requires_human_review").notNull().default(true),
    reviewStatus: aiReviewStatusEnum("review_status").notNull().default("pending_review"),
    /** The full canonical AgentEnvelope (single source of truth for the run). */
    responseEnvelope: jsonb("response_envelope").notNull(),
    reviewedByMemberId: uuid("reviewed_by_member_id").references(() => organizationMembers.id, {
      onDelete: "set null",
    }),
    reviewedAt: timestamp("reviewed_at", { withTimezone: true }),
    ...timestamps,
  },
  (t) => [index("idx_ai_runs_org_client").on(t.organizationId, t.clientId, t.reviewStatus)],
);

/**
 * Partner directory. Synthetic in dev — no real partner names or compensation
 * figures in code (ADR-0007). `non_commercial` marks options AFLO earns nothing
 * from (surfaced first by the neutrality engine).
 */
export const partners = pgTable(
  "partners",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    organizationId: uuid("organization_id")
      .notNull()
      .references(() => organizations.id, { onDelete: "cascade" }),
    name: text("name").notNull(),
    category: partnerCategoryEnum("category").notNull(),
    licensingNote: text("licensing_note").notNull().default(""),
    nonCommercial: boolean("non_commercial").notNull().default(false),
    compensationDisclosure: text("compensation_disclosure").notNull().default(""),
    eligibilityCriteria: text("eligibility_criteria").notNull().default(""),
    estimatedUserCost: text("estimated_user_cost").notNull().default(""),
    keyRisks: text("key_risks").notNull().default(""),
    active: boolean("active").notNull().default(true),
    ...timestamps,
  },
  (t) => [index("idx_partners_org_active").on(t.organizationId, t.active)],
);

/**
 * Tracked partner referrals (partner.v1.0.0). The eight-field neutrality record
 * (ADR-0007 §3) is captured immutably at creation as inline jsonb; the store
 * refuses creation without a complete validated record. `outcome` is a
 * staff observation, never an approval. Compensation never touches readiness.
 */
export const partnerReferrals = pgTable(
  "partner_referrals",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    organizationId: uuid("organization_id")
      .notNull()
      .references(() => organizations.id, { onDelete: "cascade" }),
    clientId: uuid("client_id")
      .notNull()
      .references(() => clients.id, { onDelete: "cascade" }),
    partnerId: uuid("partner_id")
      .notNull()
      .references(() => partners.id, { onDelete: "restrict" }),
    status: partnerReferralStatusEnum("status").notNull().default("suggested"),
    /** The eight-field NeutralityRecord, immutable after creation. */
    neutrality: jsonb("neutrality").notNull(),
    outcome: referralOutcomeEnum("outcome"),
    outcomeNote: text("outcome_note"),
    createdByMemberId: uuid("created_by_member_id")
      .notNull()
      .references(() => organizationMembers.id, { onDelete: "restrict" }),
    sharedAt: timestamp("shared_at", { withTimezone: true }),
    ...timestamps,
  },
  (t) => [index("idx_referrals_org_client").on(t.organizationId, t.clientId)],
);

/**
 * ΛFLO Wealth Academy assignments with full provenance. Completion is
 * educational only — it never gates any regulated product. One assignment per
 * lesson per client (content_version records the version given).
 */
export const educationAssignments = pgTable(
  "education_assignments",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    organizationId: uuid("organization_id")
      .notNull()
      .references(() => organizations.id, { onDelete: "cascade" }),
    clientId: uuid("client_id")
      .notNull()
      .references(() => clients.id, { onDelete: "cascade" }),
    lessonId: text("lesson_id").notNull(),
    contentVersion: text("content_version").notNull(),
    trigger: text("trigger").notNull(),
    reasonCode: text("reason_code").notNull(),
    ruleVersion: text("rule_version").notNull(),
    aiRunId: uuid("ai_run_id").references(() => aiRuns.id, { onDelete: "set null" }),
    assignedAt: timestamp("assigned_at", { withTimezone: true }).notNull().defaultNow(),
    completedAt: timestamp("completed_at", { withTimezone: true }),
    /** 0..1 fraction, or null if the lesson has no knowledge check. */
    knowledgeCheckScore: numeric("knowledge_check_score", { precision: 4, scale: 3 }),
    staffReviewStatus: educationReviewStatusEnum("staff_review_status").notNull().default("not_required"),
    ...timestamps,
  },
  (t) => [uniqueIndex("uq_education_client_lesson").on(t.clientId, t.lessonId)],
);

/**
 * User-controlled notification-channel preferences (append-only, latest-wins
 * per (user, type, channel)). Enriched with organization_id for RLS, as the
 * consent_records table does over the leaner runtime record.
 */
export const notificationPreferences = pgTable(
  "notification_preferences",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    organizationId: uuid("organization_id")
      .notNull()
      .references(() => organizations.id, { onDelete: "restrict" }),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "restrict" }),
    notificationType: notificationTypeEnum("notification_type").notNull(),
    channel: notificationChannelEnum("channel").notNull(),
    enabled: boolean("enabled").notNull(),
    recordedAt: timestamp("recorded_at", { withTimezone: true }).notNull().defaultNow(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index("idx_notif_pref_org_user").on(t.organizationId, t.userId, t.notificationType, t.channel)],
);

/**
 * Communication history / delivery log (append-only). A suppressed row carries
 * no rendered subject — only the reason it was withheld. Full message bodies
 * stay with the provider (Resend), never the DB.
 */
export const communications = pgTable(
  "communications",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    organizationId: uuid("organization_id")
      .notNull()
      .references(() => organizations.id, { onDelete: "cascade" }),
    clientId: uuid("client_id")
      .notNull()
      .references(() => clients.id, { onDelete: "cascade" }),
    notificationType: notificationTypeEnum("notification_type").notNull(),
    channel: notificationChannelEnum("channel").notNull(),
    status: communicationStatusEnum("status").notNull(),
    subject: text("subject"),
    suppressionReason: text("suppression_reason"),
    occurredAt: timestamp("occurred_at", { withTimezone: true }).notNull().defaultNow(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index("idx_comms_org_client_occurred").on(t.organizationId, t.clientId, t.occurredAt)],
);

/**
 * Signed verification handoff packages (security.v1.0.0). The signed content
 * (payload/digest/signature/key_id/algorithm) is immutable; only revoked_at
 * mutates in place, matching the domain. `payload_digest` is NOT unique — a
 * re-issue of an identical payload after revocation shares the same SHA-256 and
 * must not collide. `consent_scope` is a scope descriptor string, not a FK.
 * Payload is verified facts only — no SSN/bank/raw-credit data.
 */
export const handoffPackages = pgTable(
  "handoff_packages",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    organizationId: uuid("organization_id")
      .notNull()
      .references(() => organizations.id, { onDelete: "restrict" }),
    clientId: uuid("client_id")
      .notNull()
      .references(() => clients.id, { onDelete: "restrict" }),
    schemaVersion: text("schema_version").notNull(),
    recipientScope: text("recipient_scope").notNull(),
    /** Scope descriptor for the authorizing consent (e.g. "partner_data_sharing@…"). */
    consentScope: text("consent_scope").notNull(),
    /** HandoffFacts — verified facts only, never raw regulated data. */
    payload: jsonb("payload").notNull(),
    /** SHA-256 hex of the canonical payload (integrity, not the signature). Non-unique. */
    payloadDigest: varchar("payload_digest", { length: 64 }).notNull(),
    signature: text("signature").notNull(),
    keyId: text("key_id").notNull(),
    algorithm: text("algorithm").notNull(),
    issuedAt: timestamp("issued_at", { withTimezone: true }).notNull(),
    expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
    revokedAt: timestamp("revoked_at", { withTimezone: true }),
    ruleVersion: text("rule_version").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index("idx_handoff_org_client_digest").on(t.organizationId, t.clientId, t.payloadDigest)],
);

// Referenced by later-slice tables; exported so migrations stay append-only.
export { appointmentStatusEnum };

// ============================================================================
// Auth persistence (Production Cutover PHASE 2)
//
// The identity bridge: Clerk identity → AFLO user → membership / client link,
// plus invitations, verified webhook receipts, and session revocation. Three of
// these are read by the auth resolver BEFORE an org context exists (a user's
// identity mapping, their revocations) or across orgs (provider webhook
// receipts), so — like `organizations`/`users`/`rule_versions` — they are NOT
// org-RLS-scoped; access is via the privileged auth-resolver/service path. The
// tenant-owned ones (`invitations`, `client_user_links`) carry `organization_id`
// and get FORCE RLS in the same migration. Tokens/secrets are stored as digests
// only, never plaintext.
// ============================================================================

/** Maps an external provider identity (Clerk subject) to an AFLO user. NOT org-scoped. */
export const identityProviderAccounts = pgTable(
  "identity_provider_accounts",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    provider: identityProviderEnum("provider").notNull(),
    providerUserId: text("provider_user_id").notNull(),
    afloUserId: uuid("aflo_user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    ...timestamps,
  },
  (t) => [
    uniqueIndex("uq_idp_provider_user").on(t.provider, t.providerUserId),
    index("idx_idp_aflo_user").on(t.afloUserId),
  ],
);

/** Staff/client invitations. Org-scoped (RLS). Token stored as a digest only. */
export const invitations = pgTable(
  "invitations",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    organizationId: uuid("organization_id")
      .notNull()
      .references(() => organizations.id, { onDelete: "cascade" }),
    /** Normalized (lowercase) invitee email. */
    email: text("email").notNull(),
    invitationType: invitationTypeEnum("invitation_type").notNull(),
    intendedRole: invitedRoleEnum("intended_role").notNull(),
    /** The reserved client record for a client invitation (null for staff). */
    intendedClientId: uuid("intended_client_id").references(() => clients.id, { onDelete: "cascade" }),
    /** SHA-256 hex of the raw invite token — never the raw token. */
    tokenDigest: varchar("token_digest", { length: 64 }).notNull(),
    status: invitationStatusEnum("status").notNull().default("pending"),
    expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
    acceptedAt: timestamp("accepted_at", { withTimezone: true }),
    revokedAt: timestamp("revoked_at", { withTimezone: true }),
    /** The member who issued it (null if that membership is later removed). */
    createdByMemberId: uuid("created_by_member_id").references(() => organizationMembers.id, {
      onDelete: "set null",
    }),
    /** The user who accepted it. */
    acceptedByUserId: uuid("accepted_by_user_id").references(() => users.id, { onDelete: "set null" }),
    ...timestamps,
  },
  (t) => [
    // GLOBAL unique: a token identifies exactly ONE invitation. The accept-by-token
    // lookup reads by token_digest alone (before an org context exists), so per-org
    // uniqueness would be ambiguous. Tokens are 32 random bytes — collision is
    // cryptographically infeasible; this makes the token→invitation invariant explicit.
    uniqueIndex("uq_invitations_token").on(t.tokenDigest),
    // At most one PENDING invitation per (org, email).
    uniqueIndex("uq_invitations_pending_email")
      .on(t.organizationId, t.email)
      .where(sql`status = 'pending'`),
    index("idx_invitations_org_status").on(t.organizationId, t.status),
  ],
);

/** Links a Clerk-authenticated user to exactly one active client record. Org-scoped (RLS). */
export const clientUserLinks = pgTable(
  "client_user_links",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    organizationId: uuid("organization_id")
      .notNull()
      .references(() => organizations.id, { onDelete: "cascade" }),
    clientId: uuid("client_id")
      .notNull()
      .references(() => clients.id, { onDelete: "cascade" }),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    status: clientUserLinkStatusEnum("status").notNull().default("active"),
    linkedAt: timestamp("linked_at", { withTimezone: true }).notNull().defaultNow(),
    revokedAt: timestamp("revoked_at", { withTimezone: true }),
    ...timestamps,
  },
  (t) => [
    // A client has at most one ACTIVE user; a user maps to at most one ACTIVE client per org.
    uniqueIndex("uq_client_links_active_client")
      .on(t.organizationId, t.clientId)
      .where(sql`status = 'active'`),
    uniqueIndex("uq_client_links_active_user")
      .on(t.organizationId, t.userId)
      .where(sql`status = 'active'`),
  ],
);

/** Verified provider webhook receipts (idempotency + audit). NOT org-scoped. */
export const providerWebhookEvents = pgTable(
  "provider_webhook_events",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    provider: identityProviderEnum("provider").notNull(),
    /** The provider/Svix message id — the idempotency key. */
    providerEventId: text("provider_event_id").notNull(),
    eventType: text("event_type").notNull(),
    /** SHA-256 hex of the raw payload (never the payload or the signing secret). */
    payloadDigest: varchar("payload_digest", { length: 64 }).notNull(),
    receivedAt: timestamp("received_at", { withTimezone: true }).notNull().defaultNow(),
    processedAt: timestamp("processed_at", { withTimezone: true }),
    status: webhookEventStatusEnum("status").notNull().default("received"),
    attempts: integer("attempts").notNull().default(0),
    lastErrorCode: text("last_error_code"),
    ...timestamps,
  },
  (t) => [uniqueIndex("uq_webhook_provider_event").on(t.provider, t.providerEventId)],
);

/** Session-revocation records (disable / sign-out-everywhere). User-scoped, org optional. NOT org-RLS. */
export const sessionRevocations = pgTable(
  "session_revocations",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    /** Optional org scope (null = platform-wide for this user). */
    organizationId: uuid("organization_id").references(() => organizations.id, { onDelete: "set null" }),
    /** SHA-256 hex of a specific provider session id, or null to revoke all sessions. */
    providerSessionIdDigest: varchar("provider_session_id_digest", { length: 64 }),
    reasonCode: text("reason_code").notNull(),
    revokedAt: timestamp("revoked_at", { withTimezone: true }).notNull().defaultNow(),
    /** Optional expiry after which the revocation no longer applies. */
    expiresAt: timestamp("expires_at", { withTimezone: true }),
    createdByUserId: uuid("created_by_user_id").references(() => users.id, { onDelete: "set null" }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    index("idx_session_revocations_user").on(t.userId),
    index("idx_session_revocations_user_revoked").on(t.userId, t.revokedAt),
  ],
);

// ============================================================================
// Secure messaging persistence (Production Cutover PHASE 10)
//
// Durable staff↔client conversation threads and their messages. Both are
// tenant-owned (carry organization_id) and get FORCE RLS in the same migration.
//
// SAFETY BOUNDARIES:
//  - Message bodies are stored ONLY as application-layer ciphertext
//    (`body_encrypted` bytea) — there is NO plaintext body column. The repository
//    encrypts on write and decrypts on read; the DB never holds a readable body.
//  - Internal staff notes are a SEPARATE table (`notes`) and are NOT modeled
//    here, so an internal note can never leak into a client thread view — the
//    same structural boundary the domain projection (`toClientThreadView`) keeps.
//  - Message bodies must never be copied into the outbox payload (outbox rows are
//    delivery metadata only); enforced by the producer/repository, not this DDL.
// ============================================================================

/** A staff↔client conversation thread. Org-scoped (RLS). */
export const conversationThreads = pgTable(
  "conversation_threads",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    organizationId: uuid("organization_id")
      .notNull()
      .references(() => organizations.id, { onDelete: "cascade" }),
    clientId: uuid("client_id")
      .notNull()
      .references(() => clients.id, { onDelete: "cascade" }),
    subject: text("subject").notNull(),
    status: threadStatusEnum("status").notNull().default("open"),
    /** ISO datetime of the most recent message; null for an empty thread. */
    lastMessageAt: timestamp("last_message_at", { withTimezone: true }),
    ...timestamps,
  },
  (t) => [
    index("idx_threads_org_client").on(t.organizationId, t.clientId),
    index("idx_threads_org_status").on(t.organizationId, t.status),
  ],
);

/** One message within a thread. Org-scoped (RLS). Body is ciphertext only. */
export const messages = pgTable(
  "messages",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    organizationId: uuid("organization_id")
      .notNull()
      .references(() => organizations.id, { onDelete: "cascade" }),
    threadId: uuid("thread_id")
      .notNull()
      .references(() => conversationThreads.id, { onDelete: "cascade" }),
    clientId: uuid("client_id")
      .notNull()
      .references(() => clients.id, { onDelete: "cascade" }),
    senderRole: messageSenderRoleEnum("sender_role").notNull(),
    /**
     * Polymorphic sender: an organization_members.id when a staff member sent it,
     * or the clients.id when the client did (discriminated by sender_role). No FK
     * because it references two tables — same pattern as the nullable ai_run_id
     * columns before their table landed.
     */
    senderId: uuid("sender_id").notNull(),
    /** Application-layer ciphertext of the body — NEVER plaintext. */
    bodyEncrypted: encrypted("body_encrypted").notNull(),
    /** The domain send time (may differ from the DB insert time). */
    sentAt: timestamp("sent_at", { withTimezone: true }).notNull().defaultNow(),
    readByClientAt: timestamp("read_by_client_at", { withTimezone: true }),
    readByStaffAt: timestamp("read_by_staff_at", { withTimezone: true }),
    ...timestamps,
  },
  (t) => [
    index("idx_messages_org_thread_sent").on(t.organizationId, t.threadId, t.sentAt),
    index("idx_messages_org_client").on(t.organizationId, t.clientId),
  ],
);
