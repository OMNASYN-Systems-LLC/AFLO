import { sql } from "drizzle-orm";
import {
  boolean,
  customType,
  index,
  integer,
  jsonb,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
  uuid,
  varchar,
} from "drizzle-orm/pg-core";
import {
  appointmentStatusEnum,
  clientKindEnum,
  clientStatusEnum,
  consentTypeEnum,
  intakeStatusEnum,
  memberRoleEnum,
  outboxStatusEnum,
} from "./enums";

/**
 * AFLO core schema (Drizzle, ADR-0005) — identity, tenancy, governance, and
 * CRM. Reconciled to the implemented model (slices C–M). Workflow tables
 * (readiness_assessments, roadmaps, monthly_actions, documents, appointments,
 * quarterly_reports, notes, communications) land in the follow-up slice; the
 * Neon connection and repository swap are gated on DATABASE_URL.
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
    nextAttemptAt: timestamp("next_attempt_at", { withTimezone: true }).notNull().defaultNow(),
    lockedBy: text("locked_by"),
    lockedAt: timestamp("locked_at", { withTimezone: true }),
    lastError: text("last_error"),
    deadLetter: boolean("dead_letter").notNull().default(false),
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

// Referenced by later-slice tables; exported so migrations stay append-only.
export { appointmentStatusEnum };
