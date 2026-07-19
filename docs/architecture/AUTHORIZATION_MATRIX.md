# AFLO Authorization Matrix

**Status:** V1 baseline — applies to "Golden Key Wealth, powered by AFLO."
**Scope:** All access control decisions for the V1 modules. This document is the source of truth for route guards, service-layer policy checks, repository scoping, and Row-Level Security (RLS) policies. Changes require an ADR.

Related documents: `CLAUDE.md` (governing execution brief), `docs/architecture/INITIAL_ARCHITECTURE.md`.

---

## 1. Principals

Two kinds of principals exist: **human roles** (attached to a user via `organization_members`, except Platform Admin) and **service principals** (machine identities with their own credentials).

| Principal | Kind | Tenant scope | Description |
|---|---|---|---|
| **Platform Admin** | Human | Cross-tenant | AFLO operators. May access any organization for support, incident response, and platform administration. **Every cross-tenant access is audited** (see §6). Not a member of any organization. |
| **Organization Owner** | Human | Single org | Owns a tenant (e.g., Golden Key Wealth principal). Full control of the org's data, memberships, partner directory, and configuration. |
| **Organization Admin** | Human | Single org | Delegated administrator. Same operational reach as the Owner across client and workflow data **except** the two owner-reserved capabilities — managing memberships/invitations and managing the partner directory/referral rules (footnote `b`). Lets an org share day-to-day administration without granting ownership. |
| **Golden Key Staff** *(Advisor/Staff)* | Human | Single org | Coaches/advisors. Operate the CRM, roadmaps, documents, reports, and reviews within their organization only. |
| **Client** | Human | Single org, own records | End client of an organization. Sees only a defined subset of their **own** records (see §4, footnote `c`). |
| **Partner Viewer** *(later)* | Human | Single org, referred records | Deferred past V1. Will see only referral records explicitly shared with them via a data-sharing grant. Listed here so the schema and policy layer reserve the role. |
| **Worker service** | Service | Scoped per job | The Railway worker. Runs scheduled jobs (reminders, quarterly reports, notifications, document processing, AI job execution) with **least-privilege service credentials** — a dedicated DB role limited to the tables its job types require, never a superuser or the app's interactive role. |
| **AI orchestration service** | Service | Scoped per run | The Credit Intelligence orchestrator and its logical sub-agents. **Read-only on approved facts; zero direct write access to financial facts.** Its only writes are `ai_runs` and recommendation records that *reference* facts (see §5). |

Role assignment: one membership row per user per organization in `organization_members`. Platform Admin is a platform-level flag on `users`, never a membership. A user may hold at most one role per organization in V1.

---

## 2. Resource Families

Resource families group tables/modules that share an access policy. Every tenant-owned table carries `organization_id`; client-owned rows also carry `client_id`.

| Family | Representative tables / modules | Client-owned rows? |
|---|---|---|
| **Tenancy & membership** | `organizations`, `organization_members`, roles, invitations | No |
| **CRM** | `leads`, `clients`, pipeline stages, staff assignments | Partially (`clients`) |
| **Notes & communications** | admin notes, communication history | No (staff-internal) |
| **Financial facts** | financial profiles, credit profiles (manual score entry), income sources, debts, obligations | Yes |
| **Goals** | `goals`, goal allocations | Yes |
| **Readiness engine** | readiness assessments, reason codes, stage history | Yes (results); rules are platform-owned |
| **Rule versions** | versioned stage/threshold rules | No (platform-owned) |
| **Roadmaps & actions** | roadmaps, milestones, monthly action plans, tasks | Yes |
| **Education** | education content catalog, education assignments | Assignments: yes; catalog: platform/org-owned |
| **Documents** | `documents`, document types, review states, signed URLs | Yes |
| **Appointments & reminders** | appointments, reminders, nudges | Yes |
| **Quarterly reports** | report drafts, approved reports, export history | Yes |
| **Partner directory & referrals** | `partners`, partner capabilities, referral rules, `referrals` | Referrals reference a client |
| **Engagement analytics** | engagement events, inactivity/risk flags, retention metrics | Aggregated; event rows reference clients |
| **Round-up simulator** | simulation settings, virtual transactions, projected outcomes | Yes |
| **AI runs & recommendations** | `ai_runs`, typed agent outputs, recommendation records, approvals | Reference clients |
| **Audit & consent** | audit events, consent records, data-sharing grants | Consent: yes; audit: append-only system data |

---

## 3. Permission Legend

| Marker | Meaning |
|---|---|
| `C` | Create |
| `R` | Read |
| `U` | Update |
| `D` | Delete (soft delete preferred; hard delete is Platform Admin only, audited) |
| `A` | Approve (review gate: AI output, documents, reports, roadmaps) |
| `E` | Export (generate files that leave the system: report PDFs, data exports) |
| `–` | No access |

---

## 4. Matrix

Columns: **PA** = Platform Admin, **OO** = Organization Owner, **OA** = Organization Admin, **ST** = Golden Key Staff (Advisor/Staff), **CL** = Client, **PV** = Partner Viewer (later), **WK** = Worker service, **AI** = AI orchestration service.

| Resource family | PA ᵃ | OO | OA | ST | CL ᶜ | PV ᵈ | WK ᵉ | AI ᶠ |
|---|---|---|---|---|---|---|---|---|
| Organizations | CRUD | RU | R | R | – | – | R | – |
| Memberships & invitations | CRUD | CRUD ᵇ | R ᵇ | R | – | – | R | – |
| Leads | R | CRUD | CRUD | CRUD | – | – | R | R |
| Clients (CRM record) | R | CRUD | CRUD | CRU | R (own) | – | R | R |
| Notes & communications | R | CRUD | CRUD | CRU | – | – | CR ᵍ | R ᵖ |
| Secure messaging (client↔staff threads) † | R | CRUD | CRUD | CRUD | CRU (own) | – | C ᵍ | R ᵖ |
| Financial facts | R | CRU | CRU | CRU | CRU (own) ʰ | – | R | R (approved facts only) |
| Goals | R | CRU | CRU | CRU | CRU (own) | – | R | R |
| Readiness assessments | R | R / A | R / A | R / A | R (own) | – | C ⁱ | R |
| Rule versions | CRUD | R | R | R | – | – | R | R |
| Roadmaps, milestones, actions, tasks | R | CRUD / A | CRUD / A | CRU / A | R (own); U tasks ʲ | – | R | R |
| Education catalog | CRUD | CR | CR | R | – | – | R | R |
| Education assignments | R | CRU | CRU | CRU | R (own) | – | CR ᵍ | – |
| Documents | R | CRUD / A | CRUD / A | CRU / A | CR (own) ᵏ | – | RU ˡ | R (metadata + review status) |
| Appointments & reminders | R | CRUD | CRUD | CRUD | CRU (own) | – | CR ᵍ | R |
| Quarterly reports | R | R / A / E | R / A / E | R / A / E | R (approved, own) | – | C ⁱ | R |
| Partner directory | R | CRUD ᵇ | R ᵇ | R | – | – | R | R |
| Referrals | R | CRU / A | CRU / A | CRU | R (own) | R (shared) | R | R |
| Engagement analytics | R | R | R | R | – | – | CR ⁱ | R |
| Round-up simulator | R | R | R | R | CRU (own) | – | C ⁱ | R |
| Billing (packages, invoices, subscriptions) ‡ | R | CRU | CRU | – | – | – | R | – |
| AI runs & recommendations | R | R / A | R / A | R / A | R (own, approved) ᵐ | – | C ⁱ | C ⁿ |
| Audit events | R / E | R (own org) | R (own org) | – | – | – | C | – |
| Consent & data-sharing grants | R | R | R | R | CRU (own) ᵒ | – | R | R |

### Footnotes

- **a — Platform Admin is cross-tenant but never silent.** Every read or write of tenant data by a Platform Admin emits an audit event with reason and target org. Break-glass access to client-level records requires a recorded justification. PA does not participate in org review workflows (`A`) — approvals belong to the tenant.
- **b — Owner-only management.** Only the Organization Owner manages memberships (invite, role change, removal) and the partner directory (add/edit/deactivate partners, referral rules). Organization Admin and Staff can read both but change neither — this is the single boundary that distinguishes Admin from Owner.
- **c — Client subset.** Clients see **only their own records**, and only within this subset: profile, goals, roadmap/milestones/tasks, documents, appointments, education assignments, and approved reports. Clients never see: leads, other clients, staff notes, communications, engagement risk flags, unapproved AI output, rule internals, the partner directory, or org analytics.
- **d — Partner Viewer (deferred).** No access in V1. When introduced, read access is limited to referral records covered by an explicit, revocable data-sharing grant with client consent on record. The role exists in the enum now so no migration reshapes policy later.
- **e — Worker least privilege.** The worker's DB role can read what its job types need and write only job outputs: reminders/nudges, generated report drafts, notification records, document-processing results, engagement events, and outbox job state. It cannot manage memberships, approve anything, or delete tenant data. Ideally split into per-job-type roles as job variety grows.
- **f — AI orchestration.** Read access is limited to **approved, verified facts** and deterministic calculator outputs within the run's organization and client scope (sole exception: communication metadata, footnote `p`). See §5 for the write prohibition.
- **g — System-generated records.** Worker creates reminder/nudge/notification and education-assignment rows as the output of scheduled jobs; it does not edit human-authored content.
- **h — Client-entered facts are unverified until reviewed.** Client edits to financial/credit facts create records in an `unverified` state; staff review promotes them to `verified`. AI reads verified facts only.
- **i — Worker-computed rows.** Readiness assessments (via the versioned rules engine), report drafts, engagement events, and simulation projections are created by deterministic worker jobs. Assessments come from rules, never from an LLM.
- **j — Clients update task completion status on their own tasks** (mark done, add a completion note). They cannot edit task definitions, milestones, or roadmap structure.
- **k — Clients upload their own documents** and read their review status. They cannot change review states or delete documents once submitted for review.
- **l — Worker updates document processing metadata** (virus scan status, extraction results, storage pointers) — never review decisions.
- **m — Clients see AI-derived content only after approval** (`A`) by Owner, Organization Admin, or Staff. `requires_human_review = true` output is invisible to clients until approved.
- **n — See §5.** The AI service's *only* create rights.
- **o — Consent is client-controlled.** Clients grant and revoke consent and data-sharing records for their own data. Revocation is honored prospectively and audited; consent history is never deleted.
- **p — AI reads communication metadata only.** The AI orchestration service has scoped read access to communication **metadata** (timestamps, channel, direction) so the engagement-agent can analyze inactivity — never message bodies, subjects, or staff note content.
- **† — Secure messaging is client-facing, unlike staff-internal notes.** Client↔staff message threads are a distinct resource family from "Notes & communications" (which is staff-internal, `CL = –`). A client may create and read **their own** threads (`message.send`/`message.read`, ownership-scoped); staff also assign and close threads (`message.assign`/`message.close`). This is why the authorization engine tags `message.*` as **client-scoped** — a message resource always carries a `clientId`, and a missing one fails closed.
- **‡ — Billing is org-administered; execution stays with Stripe.** Only the Owner and Organization Admin read and manage billing (`billing.read`/`billing.manage` — service packages, invoices, subscriptions). Staff and clients hold no billing permission in this vocabulary (clients view their own invoices through the portal projection, not this token). ΛFLO never stores payment instruments or executes charges — Stripe is the system of record (CLAUDE.md). Billing is **org-scoped**, so the per-client ownership/assignment gates do not apply.

---

## 5. The AI Write Prohibition

The AI orchestration layer (all twelve logical sub-agents) has **zero direct write access to financial facts** — no INSERT/UPDATE/DELETE on financial profiles, credit profiles, income, debts, obligations, goals, readiness assessments, roadmaps, documents, referrals, or any other domain table.

Its complete write surface:

```text
ALLOWED WRITES (AI service DB role):
  ai_runs                    -- one row per orchestration run: agent_name, agent_version, model,
                             --   inputs hash, status/outcome, response envelope, confidence,
                             --   facts_used, missing_facts, rule_versions_used, reason_codes,
                             --   proposed_actions, requires_human_review, prohibited_actions_detected
  ai_recommendations         -- typed proposals that REFERENCE fact rows by id;
                             --   summary, rationale, impact, review_status

EVERYTHING ELSE: revoked at the database-role level.
```

- A recommendation becomes a real change only when an Owner, Organization Admin, or Staff member approves it, at which point an **application service** (running under the human's authorization context) performs the mutation, links it to the approving user and the `ai_runs` row, and emits an audit event.
- Any agent response with a non-empty `prohibited_actions_detected` is stored, flagged, and surfaced to staff; it is never auto-applied (compliance-guard hard stop).
- The AI service role is a distinct Postgres role. The prohibition is enforced by `GRANT`s, not just application code.

---

## 6. Enforcement Layers

Defense in depth: four layers, each of which would independently block an unauthorized access. No layer trusts the one above it.

| Layer | Where | Responsibility | Failure mode it catches |
|---|---|---|---|
| **1. Route guards** | Next.js middleware / server actions / API routes | Authenticate the session; resolve `{ user, organization, role }`; reject unauthenticated or role-mismatched requests before any handler runs. | Direct URL access, missing session, wrong surface (client hitting staff routes). |
| **2. Service-layer policy checks** | Application services (`can(actor, action, resource)` helper) | Encode this matrix as code: one policy module per resource family, unit-tested against the table in §4. All mutations, approvals, and exports pass through it. | Handler bugs, new endpoints that forget a check, cross-role privilege creep. |
| **3. Repository scoping** | Data-access layer | Every repository method takes an `OrganizationContext` (and `ClientContext` where applicable) and injects `organization_id` (and `client_id`) into every query. No repository method accepts a raw unscoped query. | Forgotten `WHERE organization_id = …`, cross-tenant joins, ID-guessing (IDOR). |
| **4. RLS backstop** | Neon PostgreSQL | Row-Level Security policies on every tenant-owned table keyed to `app.current_org_id` / `app.current_user_id` session settings, plus per-principal DB roles (app, worker, AI) with minimal `GRANT`s. Enabled before any pilot data exists. | Bugs in all three layers above; ad-hoc queries; a compromised or misconfigured service. |

Additional rules:

- **Deny by default.** Any `(role, action, resource)` combination not present in §4 is denied.
- **Service principals authenticate with their own credentials** (separate connection strings / DB roles for web app, worker, and AI service). Rotating one does not affect the others.
- **Platform Admin cross-tenant access** goes through a dedicated support surface that forces a justification string and emits the audit event — never through the ordinary tenant UI.
- Signed document URLs are short-lived, single-object, and generated only after a layer-2 policy check.

---

## 7. Audit Requirements

Audit events are append-only, org-scoped, and carry: actor (user or service principal), role, organization, action, target table + id, before/after state where applicable, timestamp, and request correlation id. The following actions **MUST** emit an audit event:

| # | Action | Actor(s) | Notes |
|---|---|---|---|
| 1 | Membership create / role change / removal | Owner, PA | Includes invitations accepted. |
| 2 | Any Platform Admin access to tenant data (read **or** write) | PA | Includes justification string. Reads are audited here even though tenant reads are otherwise not. |
| 3 | Create / update / verify of financial facts | Owner, Staff, Client | Verification state transitions included. |
| 4 | Readiness assessment produced or stage changed | Worker (rules engine) | Records rule version and reason codes. |
| 5 | Rule version publish / retire | PA | |
| 6 | Roadmap, milestone, or monthly plan approval or material edit | Owner, Staff | |
| 7 | Document upload, review-state change, download, deletion | All human roles, Worker | Downloads of client documents are sensitive reads — audited. |
| 8 | Report generation, approval, and **every export** (`E`) | Owner, Staff, Worker | Export history retained. |
| 9 | AI run executed | AI service | The `ai_runs` row plus an audit event. |
| 10 | AI recommendation approved, rejected, or applied | Owner, Staff | Links approver, recommendation, and resulting mutation. |
| 11 | `prohibited_actions_detected` non-empty on any agent run | AI service | Surfaced to staff; never auto-applied (compliance-guard hard stop). |
| 12 | Referral created or status changed | Owner, Staff | |
| 13 | Data-sharing grant created / revoked; consent given / revoked | Client, Owner | Consent history immutable. |
| 14 | Partner directory changes | Owner | |
| 15 | Any hard delete | PA only | Soft deletes by tenants are covered by their family's audit rule. |
| 16 | Authentication anomalies and permission-denied events at layer 2+ | System | Denials at the service layer or RLS indicate a bug or probe; both are logged. |

Non-goals for V1 auditing: routine tenant-scoped reads by Owner/Staff of their own org's non-document data (too noisy), and page views (PostHog handles product analytics separately from the audit trail).

---

## 8. Open Items

- Choose Clerk vs. Auth.js (deferred in first slice; matrix is auth-provider-agnostic — roles resolve from `organization_members`, not provider metadata).
- Decide whether Staff get per-client assignment scoping (Staff currently see all clients in their org; a `staff_assignments` filter can tighten this without changing the matrix shape).
- Define the Partner Viewer grant model in detail before enabling the role.
