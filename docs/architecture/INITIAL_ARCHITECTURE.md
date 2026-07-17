# AFLO Initial Architecture

## Architecture Style

AFLO begins as a modular monolith with one web application and one background worker. Domain boundaries are explicit in code so modules can be extracted later only when scale or operational isolation requires it.

```text
GitHub
├── Vercel
│   └── apps/web — Next.js UI, server actions, API routes
├── Railway
│   └── apps/worker — schedules, reports, notifications, document jobs
└── Neon
    └── PostgreSQL — multi-tenant source of truth
```

## Logical Layers

```text
Client and Staff Interfaces
        ↓
Application Services
        ↓
Domain Modules and Deterministic Rules
        ↔
AI Orchestration Boundary
        ↓
Repositories and Event/Audit Writers
        ↓
Neon PostgreSQL and Secure Object Storage
```

## Core Domains

### Identity and Tenancy
- users
- organizations
- organization_members
- roles and permissions
- sessions
- consent records

### CRM and Client Operations
- leads
- clients
- pipeline stages
- staff assignments
- notes
- communications
- appointments

### Financial Readiness
- financial profiles
- credit profiles
- income sources
- debts and obligations
- goals
- readiness assessments
- reason codes

### Roadmaps and Engagement
- roadmaps
- milestones
- monthly action plans
- tasks
- nudges
- education assignments
- engagement events

### Documents and Reports
- documents
- document types
- review status
- quarterly reports
- export history

### Partner Routing
- partners
- partner capabilities
- referral rules
- referrals
- referral status

### Adaptive Micro-Allocation
- simulation settings
- virtual transactions
- round-up calculations
- goal allocations
- projected outcomes

### Governance
- audit events
- rule versions
- AI runs
- approvals
- data-sharing grants

## Credit Intelligence Architecture

The Credit Intelligence Engine is a controlled orchestration layer, not an unrestricted autonomous adviser.

```text
Verified Client Facts
      ↓
Deterministic Calculators
  - utilization
  - debt ratios
  - stage thresholds
  - completion metrics
      ↓
Credit Orchestrator
  ├── Profile Agent
  ├── Utilization Agent
  ├── Payment History Agent
  ├── Readiness Agent
  ├── Roadmap Agent
  ├── Education Agent
  ├── Engagement Agent
  └── Report Agent
      ↓
Typed Recommendations + Reason Codes
      ↓
Staff Review / User Approval
      ↓
Approved Roadmap or Communication
```

Sub-agents have no direct write access to financial facts. All proposed mutations pass through application services that validate permissions, rule versions, review requirements, and audit events.

## Initial Data Isolation

Every tenant-owned table must include `organization_id`. Client-owned records also include `client_id` or `user_id` as applicable. Queries must be scoped by organization and role. Use PostgreSQL row-level security or an equally strict repository policy before pilot data is introduced.

## Initial Deployment Responsibilities

### Vercel
- Next.js UI
- authenticated server actions
- short request/response APIs
- report preview
- upload authorization

### Railway
- scheduled reminders
- quarterly report generation
- notification queues
- long-running document processing
- AI job execution
- retry and dead-letter handling

### Neon
- transactional source of truth
- audit events
- rules and versions
- application data

### Object Storage
- encrypted document files
- generated reports
- short-lived signed URLs

## Event Model

V1 may use an outbox table instead of a dedicated event bus.

Representative events:
- `lead.created`
- `client.onboarding_completed`
- `goal.created`
- `readiness.assessed`
- `roadmap.approved`
- `task.completed`
- `document.uploaded`
- `document.reviewed`
- `engagement.risk_detected`
- `quarterly_report.requested`
- `referral.created`

The Railway worker polls or receives queued outbox jobs, processes them idempotently, and records results.

## Security Baseline

- Private repository
- No production PII in code or issues
- Environment variables managed in Vercel and Railway
- Separate development, preview, and production databases
- Encryption in transit and at rest
- Signed document URLs
- Least-privilege service accounts
- Audit all sensitive reads, writes, exports, and sharing
- Synthetic seed data only
- Human review for high-impact AI output

## First Visual Slice

The first frontend should expose synthetic data for:
- staff dashboard
- client pipeline
- client list
- client detail
- lifecycle stage
- next action
- active roadmap
- progress
- document status
- engagement risk
- quarterly report preview

The purpose is to validate the operating workflow and information hierarchy before integrating bureau, bank, tax, or investment data.
