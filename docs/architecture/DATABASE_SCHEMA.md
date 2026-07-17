# AFLO V1 Database Schema Proposal

Status: **Proposal** (design document, not a migration)
Target: Neon PostgreSQL 16+
Scope: Golden Key Wealth V1 — multi-tenant financial-readiness, retention, and workflow platform.

This document proposes the relational schema for the domains defined in
[`INITIAL_ARCHITECTURE.md`](./INITIAL_ARCHITECTURE.md). It is the input to the first
migration set in `packages/database`; DDL below is illustrative and will be refined
during implementation review.

---

## 1. Conventions

| Convention | Rule |
|---|---|
| Primary keys | `uuid` via `gen_random_uuid()` (`pgcrypto`) |
| Tenancy | Every tenant-owned table carries `organization_id uuid NOT NULL` with an FK to `organizations` |
| Timestamps | `created_at` / `updated_at` as `timestamptz NOT NULL DEFAULT now()`; `updated_at` maintained by a shared trigger |
| Soft state | Prefer status enums over boolean flags; prefer archival over hard deletes for client-facing records |
| Deletes | `ON DELETE CASCADE` only for strict child rows (e.g., milestones under a roadmap); `ON DELETE RESTRICT` where history must survive (e.g., audit, referrals); `ON DELETE SET NULL` for optional back-references |
| Sensitive fields | Application-layer encrypted `BYTEA` columns suffixed `_encrypted` (e.g., `phone_encrypted`). No SSNs, bank credentials, or raw credit reports are stored in V1 at all |
| Money | `numeric(12,2)`; percentages/ratios `numeric(5,2)`; confidence `numeric(4,3)` |
| Indexes | Composite indexes lead with `organization_id` to match tenant-scoped access paths |
| Synthetic data | All seed data is synthetic; no production PII enters any environment before pilot controls exist |

```sql
CREATE EXTENSION IF NOT EXISTS pgcrypto;

-- Shared updated_at trigger, attached to every table with updated_at.
CREATE OR REPLACE FUNCTION set_updated_at() RETURNS trigger AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;
```

### Enum types

```sql
-- Platform Admin is intentionally absent: it is a platform-level flag on
-- users (users.is_platform_admin), never a membership role.
CREATE TYPE member_role AS ENUM (
  'organization_owner', 'staff', 'client', 'partner_viewer'
);

-- The eight lifecycle stages. Stage transitions are decided by versioned
-- deterministic rules (rule_versions), never by free-form LLM output.
CREATE TYPE lifecycle_stage AS ENUM (
  'recovery', 'stabilization', 'credit_readiness', 'capital_readiness',
  'acquisition', 'maintenance', 'growth', 'legacy'
);

CREATE TYPE lead_status AS ENUM ('new', 'contacted', 'qualified', 'converted', 'lost');
CREATE TYPE client_status AS ENUM ('onboarding', 'active', 'paused', 'completed', 'archived');
CREATE TYPE goal_status AS ENUM ('draft', 'active', 'achieved', 'abandoned');
CREATE TYPE payment_history_status AS ENUM ('on_time', 'late_30', 'late_60', 'late_90', 'missed');
CREATE TYPE payment_history_source AS ENUM ('manual_entry', 'uploaded_report');
CREATE TYPE roadmap_status AS ENUM ('draft', 'pending_review', 'approved', 'superseded', 'archived');
CREATE TYPE task_status AS ENUM ('pending', 'in_progress', 'completed', 'skipped');
CREATE TYPE document_review_status AS ENUM (
  'uploaded', 'pending_review', 'approved', 'rejected', 'expired'
);
CREATE TYPE appointment_status AS ENUM ('scheduled', 'completed', 'cancelled', 'no_show');
CREATE TYPE referral_status AS ENUM ('draft', 'sent', 'accepted', 'declined', 'completed');
CREATE TYPE engagement_risk_level AS ENUM ('low', 'medium', 'high');
CREATE TYPE report_status AS ENUM ('requested', 'draft', 'pending_review', 'approved', 'delivered');
CREATE TYPE ai_run_status AS ENUM ('queued', 'running', 'succeeded', 'failed', 'cancelled');
CREATE TYPE ai_run_outcome AS ENUM (
  'ok', 'needs_clarification', 'insufficient_data',
  'validation_failed', 'provider_error', 'prohibited_action'
);
CREATE TYPE ai_review_status AS ENUM ('not_required', 'pending_review', 'approved', 'rejected');
-- Per-recommendation review state; 'auto_published' is allowed only for
-- low-impact informational output (mirrors the shared ReviewStatus type).
CREATE TYPE recommendation_review_status AS ENUM (
  'pending_review', 'approved', 'rejected', 'auto_published'
);
CREATE TYPE consent_type AS ENUM (
  'terms_of_service', 'privacy_policy', 'data_processing',
  'communication', 'partner_data_sharing'
);
CREATE TYPE outbox_status AS ENUM ('pending', 'processing', 'processed', 'failed', 'dead_letter');
```

---

## 2. Identity and Tenancy

`users` are global identities (mapped to the auth provider when Clerk/Auth.js lands);
`organization_members` binds a user to a tenant with a role. All tenant authorization
is evaluated per membership, never per user alone; the sole exception is the
cross-tenant Platform Admin flag (`users.is_platform_admin`), which is never a
membership. Session storage is owned by the auth provider (Clerk, or Auth.js adapter
tables), so there is no custom `sessions` table in V1.

```sql
CREATE TABLE organizations (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name          text NOT NULL,
  slug          text NOT NULL UNIQUE,
  is_active     boolean NOT NULL DEFAULT true,
  settings      jsonb NOT NULL DEFAULT '{}',
  created_at    timestamptz NOT NULL DEFAULT now(),
  updated_at    timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE users (
  id                 uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  auth_provider_id   text UNIQUE,           -- Clerk/Auth.js subject; NULL until auth integration
  email              text NOT NULL UNIQUE,  -- login/lookup identifier
  display_name       text NOT NULL,
  phone_encrypted    bytea,                 -- application-layer encrypted
  is_platform_admin  boolean NOT NULL DEFAULT false,  -- platform-level flag; Platform Admin is never a membership (AUTHORIZATION_MATRIX.md §1)
  is_active          boolean NOT NULL DEFAULT true,
  created_at         timestamptz NOT NULL DEFAULT now(),
  updated_at         timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE organization_members (
  id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id  uuid NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  user_id          uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  role             member_role NOT NULL,
  is_active        boolean NOT NULL DEFAULT true,
  created_at       timestamptz NOT NULL DEFAULT now(),
  updated_at       timestamptz NOT NULL DEFAULT now(),
  UNIQUE (organization_id, user_id)
);

CREATE INDEX idx_org_members_org_role ON organization_members (organization_id, role);
CREATE INDEX idx_org_members_user ON organization_members (user_id);

CREATE TABLE consent_records (
  id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id  uuid NOT NULL REFERENCES organizations(id) ON DELETE RESTRICT,
  user_id          uuid NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
  consent_type     consent_type NOT NULL,
  version          text NOT NULL,             -- policy/document version consented to
  granted          boolean NOT NULL,
  granted_at       timestamptz NOT NULL DEFAULT now(),
  revoked_at       timestamptz,
  source           text NOT NULL,             -- e.g. 'onboarding_form', 'settings_page'
  ip_hash          varchar(64),               -- salted hash, never raw IP
  created_at       timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX idx_consent_org_user ON consent_records (organization_id, user_id, consent_type);
```

Consent records are append-only: revocation writes a new row (`granted = false`) rather
than mutating the grant.

---

## 3. CRM and Client Operations

A `client` may optionally link to a `user` (portal login comes later; staff-facing V1
can manage clients who never sign in).

```sql
CREATE TABLE leads (
  id                uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id   uuid NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  full_name         text NOT NULL,
  email             text,
  phone_encrypted   bytea,
  source            text,                       -- e.g. 'referral', 'web_form', 'event'
  status            lead_status NOT NULL DEFAULT 'new',
  assigned_to       uuid REFERENCES organization_members(id) ON DELETE SET NULL,
  converted_client_id uuid,                     -- FK added after clients table exists
  notes_summary     text,
  created_at        timestamptz NOT NULL DEFAULT now(),
  updated_at        timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX idx_leads_org_status ON leads (organization_id, status);
CREATE INDEX idx_leads_org_assigned ON leads (organization_id, assigned_to);

CREATE TABLE clients (
  id                uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id   uuid NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  user_id           uuid REFERENCES users(id) ON DELETE SET NULL,  -- optional portal login
  lead_id           uuid REFERENCES leads(id) ON DELETE SET NULL,
  full_name         text NOT NULL,
  email             text,
  phone_encrypted   bytea,
  date_of_birth_encrypted bytea,
  status            client_status NOT NULL DEFAULT 'onboarding',
  current_stage     lifecycle_stage NOT NULL DEFAULT 'recovery',   -- denormalized from latest readiness_assessment
  onboarding_completed_at timestamptz,
  created_at        timestamptz NOT NULL DEFAULT now(),
  updated_at        timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE leads
  ADD CONSTRAINT fk_leads_converted_client
  FOREIGN KEY (converted_client_id) REFERENCES clients(id) ON DELETE SET NULL;

CREATE INDEX idx_clients_org_status ON clients (organization_id, status);
CREATE INDEX idx_clients_org_stage ON clients (organization_id, current_stage);

CREATE TABLE client_assignments (
  id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id  uuid NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  client_id        uuid NOT NULL REFERENCES clients(id) ON DELETE CASCADE,
  member_id        uuid NOT NULL REFERENCES organization_members(id) ON DELETE CASCADE,
  is_primary       boolean NOT NULL DEFAULT false,
  created_at       timestamptz NOT NULL DEFAULT now(),
  updated_at       timestamptz NOT NULL DEFAULT now(),
  UNIQUE (client_id, member_id)
);

CREATE INDEX idx_assignments_org_member ON client_assignments (organization_id, member_id);

CREATE TABLE notes (
  id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id  uuid NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  client_id        uuid REFERENCES clients(id) ON DELETE CASCADE,
  lead_id          uuid REFERENCES leads(id) ON DELETE CASCADE,
  author_member_id uuid NOT NULL REFERENCES organization_members(id) ON DELETE RESTRICT,
  body             text NOT NULL,
  is_pinned        boolean NOT NULL DEFAULT false,
  created_at       timestamptz NOT NULL DEFAULT now(),
  updated_at       timestamptz NOT NULL DEFAULT now(),
  CHECK (client_id IS NOT NULL OR lead_id IS NOT NULL)
);

CREATE INDEX idx_notes_org_client ON notes (organization_id, client_id, created_at DESC);

CREATE TABLE communications (
  id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id  uuid NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  client_id        uuid REFERENCES clients(id) ON DELETE CASCADE,
  lead_id          uuid REFERENCES leads(id) ON DELETE CASCADE,
  member_id        uuid REFERENCES organization_members(id) ON DELETE SET NULL,
  channel          text NOT NULL,      -- 'email', 'sms', 'phone', 'in_person'
  direction        text NOT NULL,      -- 'inbound', 'outbound'
  subject          text,
  body_summary     text,               -- summary/reference; full email bodies live with the provider (Resend)
  occurred_at      timestamptz NOT NULL DEFAULT now(),
  created_at       timestamptz NOT NULL DEFAULT now(),
  CHECK (client_id IS NOT NULL OR lead_id IS NOT NULL)
);

CREATE INDEX idx_comms_org_client ON communications (organization_id, client_id, occurred_at DESC);

CREATE TABLE appointments (
  id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id  uuid NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  client_id        uuid NOT NULL REFERENCES clients(id) ON DELETE CASCADE,
  member_id        uuid REFERENCES organization_members(id) ON DELETE SET NULL,
  title            text NOT NULL,
  scheduled_at     timestamptz NOT NULL,
  duration_minutes integer NOT NULL DEFAULT 30,
  location         text,               -- 'video', 'office', address text
  status           appointment_status NOT NULL DEFAULT 'scheduled',
  reminder_sent_at timestamptz,
  created_at       timestamptz NOT NULL DEFAULT now(),
  updated_at       timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX idx_appts_org_time ON appointments (organization_id, scheduled_at);
CREATE INDEX idx_appts_org_client ON appointments (organization_id, client_id, scheduled_at DESC);
```

---

## 4. Financial Readiness

Financial facts are **user-entered or staff-entered and verified** in V1 — there are no
bureau pulls and no bank feeds. AI never writes to these tables; only application
services acting on staff/user input do.

```sql
CREATE TABLE financial_profiles (
  id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id  uuid NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  client_id        uuid NOT NULL UNIQUE REFERENCES clients(id) ON DELETE CASCADE,
  monthly_income   numeric(12,2),
  monthly_expenses numeric(12,2),
  liquid_savings   numeric(12,2),
  emergency_fund_months numeric(5,2),
  housing_status   text,                -- 'rent', 'own', 'other'
  dependents       integer,
  verified_by      uuid REFERENCES organization_members(id) ON DELETE SET NULL,
  verified_at      timestamptz,
  created_at       timestamptz NOT NULL DEFAULT now(),
  updated_at       timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE income_sources (
  id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id  uuid NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  client_id        uuid NOT NULL REFERENCES clients(id) ON DELETE CASCADE,
  source_type      text NOT NULL,       -- 'w2', '1099', 'business', 'benefits', 'other'
  label            text NOT NULL,
  monthly_amount   numeric(12,2) NOT NULL,
  is_variable      boolean NOT NULL DEFAULT false,
  created_at       timestamptz NOT NULL DEFAULT now(),
  updated_at       timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX idx_income_org_client ON income_sources (organization_id, client_id);

CREATE TABLE debts (
  id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id  uuid NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  client_id        uuid NOT NULL REFERENCES clients(id) ON DELETE CASCADE,
  debt_type        text NOT NULL,       -- 'credit_card', 'auto', 'student', 'personal', 'mortgage', 'collection', 'other'
  creditor_label   text NOT NULL,       -- display label only; no account numbers
  balance          numeric(12,2) NOT NULL,
  credit_limit     numeric(12,2),       -- revolving accounts; feeds utilization calculator
  apr              numeric(5,2),
  minimum_payment  numeric(12,2),
  is_delinquent    boolean NOT NULL DEFAULT false,
  is_closed        boolean NOT NULL DEFAULT false,
  created_at       timestamptz NOT NULL DEFAULT now(),
  updated_at       timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX idx_debts_org_client ON debts (organization_id, client_id) WHERE NOT is_closed;

-- Manually entered or report-derived payment history. Append-only; feeds the
-- deterministic kernel's recency/frequency metrics consumed by the
-- payment-history-agent (which summarizes — it never drafts disputes).
CREATE TABLE payment_history_entries (
  id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id  uuid NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  client_id        uuid NOT NULL REFERENCES clients(id) ON DELETE CASCADE,
  debt_id          uuid REFERENCES debts(id) ON DELETE SET NULL,   -- NULL = not tied to a tracked debt
  period           date NOT NULL,       -- first day of the reported month
  status           payment_history_status NOT NULL,
  source           payment_history_source NOT NULL,
  entered_by       uuid REFERENCES organization_members(id) ON DELETE SET NULL,
  created_at       timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX idx_payment_history_org_client ON payment_history_entries (organization_id, client_id, period DESC);

-- Credit profile: manual score entry + uploaded report documents. No bureau API.
CREATE TABLE credit_profiles (
  id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id  uuid NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  client_id        uuid NOT NULL UNIQUE REFERENCES clients(id) ON DELETE CASCADE,
  open_accounts    integer,
  derogatory_marks integer,
  oldest_account_years numeric(5,2),
  notes            text,
  created_at       timestamptz NOT NULL DEFAULT now(),
  updated_at       timestamptz NOT NULL DEFAULT now()
);

-- Score history is append-only; each row is a manual entry with provenance.
CREATE TABLE credit_score_entries (
  id                uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id   uuid NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  credit_profile_id uuid NOT NULL REFERENCES credit_profiles(id) ON DELETE CASCADE,
  score             integer NOT NULL CHECK (score BETWEEN 300 AND 850),
  score_model       text NOT NULL DEFAULT 'unknown',   -- 'fico8', 'vantage3', 'unknown'
  source            text NOT NULL,                     -- 'client_reported', 'staff_entered', 'uploaded_report'
  source_document_id uuid,                             -- FK to documents added in §6
  as_of_date        date NOT NULL,
  entered_by        uuid REFERENCES organization_members(id) ON DELETE SET NULL,
  created_at        timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX idx_scores_org_profile ON credit_score_entries (organization_id, credit_profile_id, as_of_date DESC);

CREATE TABLE goals (
  id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id  uuid NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  client_id        uuid NOT NULL REFERENCES clients(id) ON DELETE CASCADE,
  title            text NOT NULL,
  description      text,
  goal_type        text NOT NULL,       -- 'credit_score', 'debt_payoff', 'savings', 'home_purchase', 'business', 'other'
  target_amount    numeric(12,2),
  target_date      date,
  status           goal_status NOT NULL DEFAULT 'draft',
  is_primary       boolean NOT NULL DEFAULT false,
  created_at       timestamptz NOT NULL DEFAULT now(),
  updated_at       timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX idx_goals_org_client ON goals (organization_id, client_id, status);

-- Append-only. Each assessment records the exact rule version and inputs used,
-- so any stage decision can be reproduced and audited.
CREATE TABLE readiness_assessments (
  id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id  uuid NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  client_id        uuid NOT NULL REFERENCES clients(id) ON DELETE CASCADE,
  rule_version_id  uuid NOT NULL,       -- FK to rule_versions added in §9
  stage            lifecycle_stage NOT NULL,
  previous_stage   lifecycle_stage,
  inputs           jsonb NOT NULL,      -- snapshot of facts evaluated
  reason_codes     jsonb NOT NULL DEFAULT '[]',  -- e.g. ["UTILIZATION_ABOVE_30", "NO_EMERGENCY_FUND"]
  assessed_by      uuid REFERENCES organization_members(id) ON DELETE SET NULL, -- NULL = scheduled job
  created_at       timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX idx_assessments_org_client ON readiness_assessments (organization_id, client_id, created_at DESC);
```

---

## 5. Roadmaps and Engagement

Roadmaps are AI-drafted, staff-approved. A roadmap is never `approved` without a human
reviewer; the drafting `ai_run_id` links each draft to its full provenance record (§9).

```sql
CREATE TABLE roadmaps (
  id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id  uuid NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  client_id        uuid NOT NULL REFERENCES clients(id) ON DELETE CASCADE,
  goal_id          uuid REFERENCES goals(id) ON DELETE SET NULL,
  title            text NOT NULL,
  status           roadmap_status NOT NULL DEFAULT 'draft',
  stage_at_creation lifecycle_stage NOT NULL,
  ai_run_id        uuid,                -- FK to ai_runs added in §9; NULL for manually authored roadmaps
  approved_by      uuid REFERENCES organization_members(id) ON DELETE SET NULL,
  approved_at      timestamptz,
  created_at       timestamptz NOT NULL DEFAULT now(),
  updated_at       timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX idx_roadmaps_org_client ON roadmaps (organization_id, client_id, status);

CREATE TABLE milestones (
  id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id  uuid NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  roadmap_id       uuid NOT NULL REFERENCES roadmaps(id) ON DELETE CASCADE,
  title            text NOT NULL,
  description      text,
  sort_order       integer NOT NULL DEFAULT 0,
  target_date      date,
  completed_at     timestamptz,
  created_at       timestamptz NOT NULL DEFAULT now(),
  updated_at       timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX idx_milestones_org_roadmap ON milestones (organization_id, roadmap_id, sort_order);

CREATE TABLE monthly_action_plans (
  id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id  uuid NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  client_id        uuid NOT NULL REFERENCES clients(id) ON DELETE CASCADE,
  roadmap_id       uuid REFERENCES roadmaps(id) ON DELETE SET NULL,
  period           date NOT NULL,       -- first day of month
  summary          text,
  approved_by      uuid REFERENCES organization_members(id) ON DELETE SET NULL,
  approved_at      timestamptz,
  created_at       timestamptz NOT NULL DEFAULT now(),
  updated_at       timestamptz NOT NULL DEFAULT now(),
  UNIQUE (client_id, period)
);

CREATE TABLE tasks (
  id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id  uuid NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  client_id        uuid NOT NULL REFERENCES clients(id) ON DELETE CASCADE,
  action_plan_id   uuid REFERENCES monthly_action_plans(id) ON DELETE SET NULL,
  milestone_id     uuid REFERENCES milestones(id) ON DELETE SET NULL,
  title            text NOT NULL,
  description      text,
  status           task_status NOT NULL DEFAULT 'pending',
  due_date         date,
  completed_at     timestamptz,
  assigned_to_member uuid REFERENCES organization_members(id) ON DELETE SET NULL, -- staff task; NULL = client task
  created_at       timestamptz NOT NULL DEFAULT now(),
  updated_at       timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX idx_tasks_org_client_status ON tasks (organization_id, client_id, status);
CREATE INDEX idx_tasks_org_due ON tasks (organization_id, due_date) WHERE status IN ('pending', 'in_progress');

-- Education catalog: platform-level content (organization_id NULL) or org-specific.
-- Intentionally NOT tenant-scoped when organization_id IS NULL.
CREATE TABLE education_content (
  id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id  uuid REFERENCES organizations(id) ON DELETE CASCADE,  -- NULL = shared catalog
  slug             text NOT NULL,
  title            text NOT NULL,
  body             text NOT NULL,
  stage_relevance  lifecycle_stage[],
  tags             text[] NOT NULL DEFAULT '{}',
  is_published     boolean NOT NULL DEFAULT false,
  created_at       timestamptz NOT NULL DEFAULT now(),
  updated_at       timestamptz NOT NULL DEFAULT now(),
  UNIQUE NULLS NOT DISTINCT (organization_id, slug)
);

CREATE TABLE education_assignments (
  id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id  uuid NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  client_id        uuid NOT NULL REFERENCES clients(id) ON DELETE CASCADE,
  content_id       uuid NOT NULL REFERENCES education_content(id) ON DELETE CASCADE,
  assigned_by      uuid REFERENCES organization_members(id) ON DELETE SET NULL,
  ai_run_id        uuid,                -- education-agent suggestion provenance
  viewed_at        timestamptz,
  completed_at     timestamptz,
  created_at       timestamptz NOT NULL DEFAULT now(),
  UNIQUE (client_id, content_id)
);

CREATE INDEX idx_edu_assign_org_client ON education_assignments (organization_id, client_id);

-- Raw engagement signals (logins, task completions, appointment attendance, opens).
-- High-volume append-only; PostHog holds product analytics, this holds the
-- retention-relevant subset used by the engagement-agent and risk rules.
CREATE TABLE engagement_events (
  id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id  uuid NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  client_id        uuid NOT NULL REFERENCES clients(id) ON DELETE CASCADE,
  event_type       text NOT NULL,       -- 'login', 'task_completed', 'appointment_attended', 'nudge_opened', ...
  metadata         jsonb NOT NULL DEFAULT '{}',
  occurred_at      timestamptz NOT NULL DEFAULT now(),
  created_at       timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX idx_engagement_org_client_time ON engagement_events (organization_id, client_id, occurred_at DESC);

CREATE TABLE nudges (
  id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id  uuid NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  client_id        uuid NOT NULL REFERENCES clients(id) ON DELETE CASCADE,
  risk_level       engagement_risk_level NOT NULL,
  reason           text NOT NULL,       -- e.g. 'no_login_21_days'
  channel          text,                -- 'email', 'sms', 'staff_call'
  ai_run_id        uuid,                -- engagement-agent recommendation provenance
  approved_by      uuid REFERENCES organization_members(id) ON DELETE SET NULL,
  sent_at          timestamptz,
  created_at       timestamptz NOT NULL DEFAULT now(),
  updated_at       timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX idx_nudges_org_client ON nudges (organization_id, client_id, created_at DESC);
```

---

## 6. Documents and Reports

Files live in Vercel Blob / S3; the database stores metadata and an encrypted storage
path only. Access is always via short-lived signed URLs.

```sql
CREATE TABLE document_types (
  id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id  uuid REFERENCES organizations(id) ON DELETE CASCADE,  -- NULL = platform default set
  slug             text NOT NULL,       -- 'credit_report', 'pay_stub', 'bank_statement', 'id_document', ...
  label            text NOT NULL,
  is_sensitive     boolean NOT NULL DEFAULT true,
  retention_days   integer,
  created_at       timestamptz NOT NULL DEFAULT now(),
  UNIQUE NULLS NOT DISTINCT (organization_id, slug)
);

CREATE TABLE documents (
  id                     uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id        uuid NOT NULL REFERENCES organizations(id) ON DELETE RESTRICT,
  client_id              uuid NOT NULL REFERENCES clients(id) ON DELETE RESTRICT,
  document_type_id       uuid NOT NULL REFERENCES document_types(id) ON DELETE RESTRICT,
  file_name              text NOT NULL,
  mime_type              text NOT NULL,
  size_bytes             bigint NOT NULL,
  storage_path_encrypted bytea NOT NULL,     -- blob/S3 key, application-layer encrypted
  checksum_sha256        varchar(64) NOT NULL,
  review_status          document_review_status NOT NULL DEFAULT 'uploaded',
  reviewed_by            uuid REFERENCES organization_members(id) ON DELETE SET NULL,
  reviewed_at            timestamptz,
  review_note            text,
  uploaded_by_user_id    uuid REFERENCES users(id) ON DELETE SET NULL,
  created_at             timestamptz NOT NULL DEFAULT now(),
  updated_at             timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE credit_score_entries
  ADD CONSTRAINT fk_scores_source_document
  FOREIGN KEY (source_document_id) REFERENCES documents(id) ON DELETE SET NULL;

CREATE INDEX idx_docs_org_client_status ON documents (organization_id, client_id, review_status);
CREATE INDEX idx_docs_org_pending ON documents (organization_id, created_at) WHERE review_status IN ('uploaded', 'pending_review');

CREATE TABLE quarterly_reports (
  id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id  uuid NOT NULL REFERENCES organizations(id) ON DELETE RESTRICT,
  client_id        uuid NOT NULL REFERENCES clients(id) ON DELETE RESTRICT,
  period_start     date NOT NULL,
  period_end       date NOT NULL,
  status           report_status NOT NULL DEFAULT 'requested',
  content          jsonb,               -- structured report body (sections, metrics, narrative)
  ai_run_id        uuid,                -- report-agent draft provenance
  approved_by      uuid REFERENCES organization_members(id) ON DELETE SET NULL,
  approved_at      timestamptz,
  delivered_at     timestamptz,
  storage_path_encrypted bytea,         -- rendered PDF, once generated
  created_at       timestamptz NOT NULL DEFAULT now(),
  updated_at       timestamptz NOT NULL DEFAULT now(),
  UNIQUE (client_id, period_start)
);

CREATE INDEX idx_reports_org_status ON quarterly_reports (organization_id, status);

-- Every export or external share of client data is recorded (also audited in §9).
CREATE TABLE export_history (
  id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id  uuid NOT NULL REFERENCES organizations(id) ON DELETE RESTRICT,
  client_id        uuid REFERENCES clients(id) ON DELETE RESTRICT,
  exported_by      uuid NOT NULL REFERENCES organization_members(id) ON DELETE RESTRICT,
  export_type      text NOT NULL,       -- 'quarterly_report_pdf', 'client_summary_csv', ...
  target           text,                -- recipient description, never raw contact PII
  created_at       timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX idx_exports_org_time ON export_history (organization_id, created_at DESC);
```

---

## 7. Partner Directory and Referrals

Referrals route clients to external licensed professionals (lenders, CPAs, attorneys).
AFLO records the referral; it never executes the regulated action itself. Partner data
sharing requires a matching `consent_records` row.

```sql
CREATE TABLE partners (
  id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id  uuid NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  name             text NOT NULL,
  contact_email    text,
  contact_phone_encrypted bytea,
  website          text,
  is_active        boolean NOT NULL DEFAULT true,
  notes            text,
  created_at       timestamptz NOT NULL DEFAULT now(),
  updated_at       timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX idx_partners_org_active ON partners (organization_id) WHERE is_active;

CREATE TABLE partner_capabilities (
  id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id  uuid NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  partner_id       uuid NOT NULL REFERENCES partners(id) ON DELETE CASCADE,
  capability       text NOT NULL,       -- 'mortgage_lending', 'tax_preparation', 'legal', 'insurance', ...
  min_stage        lifecycle_stage,     -- earliest stage at which referral is appropriate
  license_note     text,                -- staff-entered description; not a verification
  created_at       timestamptz NOT NULL DEFAULT now(),
  UNIQUE (partner_id, capability)
);

-- Owner-managed routing rules (AUTHORIZATION_MATRIX.md §4, footnote b): which
-- partners are appropriate at which stage and for which goal category.
CREATE TABLE referral_rules (
  id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id  uuid NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  partner_id       uuid NOT NULL REFERENCES partners(id) ON DELETE CASCADE,
  min_stage        lifecycle_stage,     -- NULL = any stage
  goal_category    text,                -- NULL = any goal category
  is_active        boolean NOT NULL DEFAULT true,
  notes            text,
  created_at       timestamptz NOT NULL DEFAULT now(),
  updated_at       timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX idx_referral_rules_org_active ON referral_rules (organization_id) WHERE is_active;

CREATE TABLE referrals (
  id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id  uuid NOT NULL REFERENCES organizations(id) ON DELETE RESTRICT,
  client_id        uuid NOT NULL REFERENCES clients(id) ON DELETE RESTRICT,
  partner_id       uuid NOT NULL REFERENCES partners(id) ON DELETE RESTRICT,
  capability       text NOT NULL,
  status           referral_status NOT NULL DEFAULT 'draft',
  consent_record_id uuid REFERENCES consent_records(id) ON DELETE RESTRICT,  -- required before 'sent'
  created_by       uuid NOT NULL REFERENCES organization_members(id) ON DELETE RESTRICT,
  sent_at          timestamptz,
  outcome_note     text,
  created_at       timestamptz NOT NULL DEFAULT now(),
  updated_at       timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX idx_referrals_org_status ON referrals (organization_id, status);
CREATE INDEX idx_referrals_org_client ON referrals (organization_id, client_id);
```

---

## 8. Virtual Round-Up / Micro-Allocation Simulator

Everything in this domain is **simulation only** — no real accounts, no real
transactions, no money movement. Virtual transactions are synthetic or user-entered
hypotheticals used to visualize round-up saving behavior toward goals.

```sql
CREATE TABLE simulation_settings (
  id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id  uuid NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  client_id        uuid NOT NULL UNIQUE REFERENCES clients(id) ON DELETE CASCADE,
  round_up_to      numeric(6,2) NOT NULL DEFAULT 1.00,   -- round to nearest dollar by default
  multiplier       numeric(4,2) NOT NULL DEFAULT 1.00,
  is_enabled       boolean NOT NULL DEFAULT true,
  created_at       timestamptz NOT NULL DEFAULT now(),
  updated_at       timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE virtual_transactions (
  id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id  uuid NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  client_id        uuid NOT NULL REFERENCES clients(id) ON DELETE CASCADE,
  label            text NOT NULL,       -- 'Coffee', 'Groceries' — synthetic/hypothetical
  amount           numeric(12,2) NOT NULL,
  round_up_amount  numeric(12,2) NOT NULL,   -- deterministic calculator output
  occurred_on      date NOT NULL,
  is_synthetic     boolean NOT NULL DEFAULT true,
  created_at       timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX idx_vtx_org_client_date ON virtual_transactions (organization_id, client_id, occurred_on DESC);

CREATE TABLE goal_allocations (
  id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id  uuid NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  client_id        uuid NOT NULL REFERENCES clients(id) ON DELETE CASCADE,
  goal_id          uuid NOT NULL REFERENCES goals(id) ON DELETE CASCADE,
  allocation_pct   numeric(5,2) NOT NULL CHECK (allocation_pct BETWEEN 0 AND 100),
  created_at       timestamptz NOT NULL DEFAULT now(),
  updated_at       timestamptz NOT NULL DEFAULT now(),
  UNIQUE (client_id, goal_id)
);

-- Deterministic projection snapshots ("at this pace: $X toward goal Y by date Z").
CREATE TABLE projected_outcomes (
  id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id  uuid NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  client_id        uuid NOT NULL REFERENCES clients(id) ON DELETE CASCADE,
  goal_id          uuid REFERENCES goals(id) ON DELETE CASCADE,
  rule_version_id  uuid NOT NULL,       -- projection formula version (FK added in §9)
  inputs           jsonb NOT NULL,
  projected_amount numeric(12,2) NOT NULL,
  projected_date   date,
  created_at       timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX idx_projections_org_client ON projected_outcomes (organization_id, client_id, created_at DESC);
```

---

## 9. Governance: Audit, Rules, AI Runs, Outbox

### 9.1 Audit events (append-only)

Every material state change writes an audit event in the same transaction as the
change. The table is insert-only: `UPDATE`/`DELETE`/`TRUNCATE` are revoked from the
application role and additionally blocked by trigger.

```sql
CREATE TABLE audit_events (
  id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id  uuid REFERENCES organizations(id) ON DELETE RESTRICT,  -- NULL for platform-level events
  actor_user_id    uuid REFERENCES users(id) ON DELETE RESTRICT,          -- NULL for system/worker actions
  actor_type       text NOT NULL,       -- 'user', 'system', 'worker', 'ai_orchestrator'
  action           text NOT NULL,       -- 'client.updated', 'roadmap.approved', 'document.exported', ...
  target_table     text NOT NULL,
  target_id        uuid NOT NULL,
  before_state     jsonb,               -- NULL on create
  after_state      jsonb,               -- NULL on delete
  ip_hash          varchar(64),         -- salted hash; raw IPs are never stored
  request_id       text,                -- correlate with Sentry/logs
  created_at       timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX idx_audit_org_time ON audit_events (organization_id, created_at DESC);
CREATE INDEX idx_audit_target ON audit_events (target_table, target_id);

REVOKE UPDATE, DELETE, TRUNCATE ON audit_events FROM PUBLIC;

CREATE OR REPLACE FUNCTION reject_mutation() RETURNS trigger AS $$
BEGIN
  RAISE EXCEPTION 'audit_events is append-only';
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER audit_events_immutable
  BEFORE UPDATE OR DELETE ON audit_events
  FOR EACH ROW EXECUTE FUNCTION reject_mutation();
```

### 9.2 Rule versions

All deterministic logic (stage thresholds, utilization bands, projection formulas)
is versioned. Assessments and projections reference the exact version used.

```sql
CREATE TABLE rule_versions (
  id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  rule_set         text NOT NULL,       -- 'readiness_stage', 'utilization_thresholds', 'roundup_projection', ...
  version          integer NOT NULL,
  definition       jsonb NOT NULL,      -- declarative parameters; evaluators live in packages/rules
  checksum_sha256  varchar(64) NOT NULL,
  is_active        boolean NOT NULL DEFAULT false,
  effective_from   timestamptz NOT NULL DEFAULT now(),
  created_by       uuid REFERENCES users(id) ON DELETE SET NULL,
  created_at       timestamptz NOT NULL DEFAULT now(),
  UNIQUE (rule_set, version)
);

-- At most one active version per rule set.
CREATE UNIQUE INDEX idx_rules_one_active ON rule_versions (rule_set) WHERE is_active;

ALTER TABLE readiness_assessments
  ADD CONSTRAINT fk_assessments_rule_version
  FOREIGN KEY (rule_version_id) REFERENCES rule_versions(id) ON DELETE RESTRICT;

ALTER TABLE projected_outcomes
  ADD CONSTRAINT fk_projections_rule_version
  FOREIGN KEY (rule_version_id) REFERENCES rule_versions(id) ON DELETE RESTRICT;
```

`rule_versions` is platform-scoped (no `organization_id`) in V1; per-tenant rule
overrides are a later concern and would be modeled as a separate override table.

### 9.3 AI runs and recommendations

One row per sub-agent invocation, matching the typed agent response schema from the
execution brief. Rows are the provenance record for every AI-drafted artifact.
`status` tracks the run lifecycle; `outcome` classifies the result once finished
(see `AGENT_BOUNDARIES.md` §8, which describes the same table).

```sql
CREATE TABLE ai_runs (
  id                          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id             uuid NOT NULL REFERENCES organizations(id) ON DELETE RESTRICT,
  client_id                   uuid REFERENCES clients(id) ON DELETE RESTRICT,
  agent_name                  text NOT NULL,   -- 'credit-profile-agent', 'utilization-agent', 'readiness-agent',
                                               -- 'payment-history-agent', 'roadmap-agent', 'education-agent',
                                               -- 'engagement-agent', 'report-agent'
  trigger                     text,            -- actor or system event that initiated the run
  provider                    text NOT NULL,   -- 'anthropic', 'openai' (behind internal provider interface)
  model                       text NOT NULL,
  status                      ai_run_status NOT NULL DEFAULT 'queued',   -- lifecycle
  outcome                     ai_run_outcome,  -- result classification; NULL until the run finishes
  inputs_hash                 text,            -- SHA-256 of the canonicalized input context
  response_envelope           jsonb,           -- the full validated typed envelope (or the validation error)
  confidence                  numeric(4,3),    -- 0.000–1.000
  -- facts_used / rules_used / reason_codes / recommendations are extracted,
  -- indexable copies derived from response_envelope; the envelope is canonical.
  facts_used                  jsonb NOT NULL DEFAULT '[]',   -- references to verified fact records
  rules_used                  jsonb NOT NULL DEFAULT '[]',   -- rule_versions ids consulted
  reason_codes                jsonb NOT NULL DEFAULT '[]',
  recommendations             jsonb NOT NULL DEFAULT '[]',   -- typed proposal payloads; never auto-executed
  requires_review             boolean NOT NULL DEFAULT true,
  prohibited_action_detected  boolean NOT NULL DEFAULT false,
  review_status               ai_review_status NOT NULL DEFAULT 'pending_review',
  reviewed_by                 uuid REFERENCES organization_members(id) ON DELETE SET NULL,
  reviewed_at                 timestamptz,
  latency_ms                  integer,
  input_token_count           integer,
  output_token_count          integer,
  error_message               text,
  started_at                  timestamptz,
  finished_at                 timestamptz,
  created_at                  timestamptz NOT NULL DEFAULT now(),
  updated_at                  timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX idx_ai_runs_org_client ON ai_runs (organization_id, client_id, created_at DESC);
CREATE INDEX idx_ai_runs_pending_review ON ai_runs (organization_id, created_at)
  WHERE requires_review AND review_status = 'pending_review';
CREATE INDEX idx_ai_runs_prohibited ON ai_runs (organization_id, created_at)
  WHERE prohibited_action_detected;

ALTER TABLE roadmaps
  ADD CONSTRAINT fk_roadmaps_ai_run FOREIGN KEY (ai_run_id) REFERENCES ai_runs(id) ON DELETE SET NULL;
ALTER TABLE education_assignments
  ADD CONSTRAINT fk_edu_ai_run FOREIGN KEY (ai_run_id) REFERENCES ai_runs(id) ON DELETE SET NULL;
ALTER TABLE nudges
  ADD CONSTRAINT fk_nudges_ai_run FOREIGN KEY (ai_run_id) REFERENCES ai_runs(id) ON DELETE SET NULL;
ALTER TABLE quarterly_reports
  ADD CONSTRAINT fk_reports_ai_run FOREIGN KEY (ai_run_id) REFERENCES ai_runs(id) ON DELETE SET NULL;
```

Recommendations remain summarized inside the run's envelope
(`ai_runs.response_envelope` / `ai_runs.recommendations`), but the reviewable
records live in `ai_recommendations` — one row per proposal, each carrying its own
review state. Together with `ai_runs`, this table is the AI service's entire write
surface (`AUTHORIZATION_MATRIX.md` §5).

```sql
CREATE TABLE ai_recommendations (
  id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id  uuid NOT NULL REFERENCES organizations(id) ON DELETE RESTRICT,
  ai_run_id        uuid NOT NULL REFERENCES ai_runs(id) ON DELETE RESTRICT,
  client_id        uuid REFERENCES clients(id) ON DELETE RESTRICT,
  summary          text NOT NULL,
  rationale        text NOT NULL,       -- links the proposal to facts and reason codes
  impact           text NOT NULL CHECK (impact IN ('low', 'medium', 'high')),
  review_status    recommendation_review_status NOT NULL DEFAULT 'pending_review',
  reviewed_by      uuid REFERENCES organization_members(id) ON DELETE SET NULL,
  reviewed_at      timestamptz,
  created_at       timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX idx_ai_recs_org_client ON ai_recommendations (organization_id, client_id, created_at DESC);
CREATE INDEX idx_ai_recs_org_pending ON ai_recommendations (organization_id, created_at)
  WHERE review_status = 'pending_review';
```

Invariants enforced in the application service layer (and asserted in tests):

- No AI run ever writes to `financial_profiles`, `debts`, `payment_history_entries`,
  `credit_profiles`, `credit_score_entries`, or `readiness_assessments`.
- Any artifact whose `ai_run_id` has `prohibited_action_detected = true` cannot be
  approved.
- `requires_review = true` blocks downstream state transitions (e.g., roadmap
  `approved`) until `review_status = 'approved'`.

### 9.4 Outbox (event model)

V1 uses a transactional outbox instead of an event bus. Producers insert the event in
the same transaction as the state change; the Railway worker polls, processes
idempotently, and marks the result.

```sql
CREATE TABLE outbox (
  id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id  uuid REFERENCES organizations(id) ON DELETE RESTRICT,
  event_type       text NOT NULL,       -- 'lead.created', 'readiness.assessed', 'document.uploaded',
                                        -- 'engagement.risk_detected', 'quarterly_report.requested', ...
  aggregate_type   text NOT NULL,       -- 'client', 'roadmap', 'document', ...
  aggregate_id     uuid NOT NULL,
  payload          jsonb NOT NULL,
  status           outbox_status NOT NULL DEFAULT 'pending',
  attempts         integer NOT NULL DEFAULT 0,
  max_attempts     integer NOT NULL DEFAULT 5,
  next_attempt_at  timestamptz NOT NULL DEFAULT now(),
  locked_by        text,                -- worker instance id
  locked_at        timestamptz,
  last_error       text,
  processed_at     timestamptz,
  created_at       timestamptz NOT NULL DEFAULT now(),
  updated_at       timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX idx_outbox_pollable ON outbox (next_attempt_at)
  WHERE status IN ('pending', 'failed');
CREATE INDEX idx_outbox_aggregate ON outbox (aggregate_type, aggregate_id);
```

Worker contract: `SELECT ... FOR UPDATE SKIP LOCKED`, exponential backoff via
`next_attempt_at`, transition to `dead_letter` when `attempts >= max_attempts`, and
idempotency keyed on `outbox.id` in every handler.

---

## 10. Row-Level Security Strategy

Organization isolation is enforced in **two independent layers**: repository-level
scoping in `packages/database` (every query builder requires an org context) and
PostgreSQL RLS as the backstop. RLS must be enabled before any pilot data exists.

### Approach

1. The application connects with a non-superuser role (`aflo_app`) that does **not**
   have `BYPASSRLS`.
2. Each request/transaction sets the tenant context:

```sql
-- Set by the repository layer at transaction start (local = transaction-scoped).
SELECT set_config('app.current_org_id', '<organization uuid>', true);
-- Acting user, for user/client-scoped policies and audit attribution.
SELECT set_config('app.current_user_id', '<user uuid>', true);
```

3. Every tenant-owned table gets the same policy pattern:

```sql
ALTER TABLE clients ENABLE ROW LEVEL SECURITY;
ALTER TABLE clients FORCE ROW LEVEL SECURITY;

CREATE POLICY org_isolation ON clients
  USING (organization_id = current_setting('app.current_org_id', true)::uuid)
  WITH CHECK (organization_id = current_setting('app.current_org_id', true)::uuid);
```

   `current_setting(..., true)` returns NULL when unset, so a request that forgets to
   set context sees zero rows — fail closed, not open.

4. Platform Admin operations (cross-tenant support, migrations) run through a separate
   role/connection path with explicit auditing; they are never the default code path.
5. Tables without `organization_id` (`users`, `rule_versions`, shared
   `education_content` / `document_types` rows) are governed by role grants and
   repository policy rather than tenant RLS. `organization_members` RLS uses the same
   org predicate; `users` rows are only reachable via joins from membership.
6. Client-level scoping (a `client` role user sees only their own records) is enforced
   in the application layer in V1; a second RLS predicate on `client_id` keyed to
   `app.current_user_id` can be added when the client portal ships.

### Testing requirement

CI must include an isolation test suite: seed two synthetic organizations, set context
to org A, and assert zero visibility into org B across every tenant-owned table
(SELECT, INSERT with mismatched `organization_id`, UPDATE, DELETE).

---

## 11. Migrations Approach

- Plain SQL migrations, checked into `packages/database/migrations/`, named
  `NNNN_description.sql`, forward-only (compensating migrations instead of down
  scripts once any shared environment has applied a migration).
- A thin runner (e.g., `node-pg-migrate` in SQL mode, or a minimal custom runner with
  a `schema_migrations` table) executes them; no ORM-generated drift.
- **Neon branching workflow**: every PR gets a Neon branch of the development
  database; CI applies migrations to the branch, runs the isolation and schema tests,
  and tears the branch down. `main` merges apply to development; production applies
  are a manual, reviewed CI job.
- Enum changes use `ALTER TYPE ... ADD VALUE` (additive) where possible; renames and
  removals require a documented multi-step migration.
- Seed data lives in `packages/database/seed/` and is synthetic only; seeds are
  idempotent and never run against production.

---

## 12. Future Compatibility (Not in V1)

The long-term AFLO direction (Phase-1 tax-cleanup wedge for 1099 solopreneurs, then
readiness OS, institutional middleware, and the verified passport) requires tables that
are **deliberately excluded from V1**. They are listed here only so V1 naming and
tenancy patterns don't collide with them later:

| Reserved concept | Reserved table names | Why excluded from V1 |
|---|---|---|
| Bank/aggregator accounts | `financial_accounts` | No Plaid/bank feeds in V1; V1 facts are manually entered and verified |
| Transaction ledger | `transactions` | No transaction ingestion in V1; only `virtual_transactions` (simulator) exist |
| Receipt matching | `receipts`, `deduction_candidates`, `tax_categories` | Tax-cleanup wedge scope, not Golden Key V1 |
| Business entities | `business_entities` | 1099/LLC entity modeling belongs to the wedge |
| Verified passport | `passport_exports`, signature tables | Phase 4+ concept |

Compatibility rules V1 already follows so these can be added without rework:

- `organization_id` tenancy and RLS pattern will extend unchanged to future tables.
- `audit_events`, `rule_versions`, `ai_runs`, `consent_records`, and `outbox` are
  domain-agnostic and will serve the wedge as-is.
- Sensitive-field encryption (`*_encrypted bytea`) is the established pattern for any
  future account identifiers or EINs.
- The simulator's `virtual_transactions` table is intentionally named so a future real
  `transactions` table introduces no ambiguity.

---

## 13. Open Questions for Implementation Review

1. Whether `clients.current_stage` denormalization stays (fast dashboard reads) or the
   dashboard reads the latest `readiness_assessments` row via a view.
2. `citext` for `users.email` / `leads.email` vs. lower-cased application handling.
3. Partitioning `engagement_events` and `audit_events` by month if volume warrants
   (defer until measured; Neon handles moderate volume fine unpartitioned).
4. Whether `communications` should mirror Resend delivery webhooks (opens/bounces) or
   leave that entirely to PostHog + Resend dashboards in V1.
