# Golden Key Workflow Discovery

> **Status:** Living discovery document. Charter reference: `docs/product/PRODUCT_CHARTER.md`, section "Golden Key workflow discovery."
> **Owner:** Product/engineering, updated after every conversation with Natalia (Golden Key Wealth).
> **Last updated:** 2026-07-18 (initial version — no discovery sessions held yet; all areas TBD).

---

## 1. Purpose and ground rules

This document is the **single place where workflow truth accumulates** for Golden Key Wealth. The charter is explicit: we do **not** invent Natalia's operating workflow. Until she confirms how Golden Key actually operates, everything the prototype shows is a labeled placeholder.

Ground rules:

1. **Nothing in this document is encoded into deep architecture until confirmed.** Unconfirmed items stay at the edges of the system — in synthetic seed data, display labels, and configuration surfaces — never in migrations, rule identifiers, or domain invariants that would be expensive to reverse.
2. **Unknowns are marked TBD.** Every area below carries a `Current status` line. It stays **TBD** until an answer is recorded from a discovery session, at which point the status changes to `Confirmed (YYYY-MM-DD, session #)` and the answer is written directly into that section.
3. **Every answer updates this file.** Discovery calls, emails, and informal corrections from Natalia are all reconciled here first, then propagated to code and ADRs. If code and this document disagree, this document wins and the code is corrected.
4. **Working assumptions are documented, not hidden.** Each area records what the current synthetic dataset and UI assume, so the gap between "what we built to have something on screen" and "what Golden Key actually does" is always visible and auditable.
5. **Assumptions are rendered replaceable by configuration wherever possible.** Where the prototype had to pick something concrete (pipeline statuses, document types, action categories, appointment channels, report cadence), that choice is treated as tenant-level configuration data, not hardcoded truth. Section 3 maps each assumption to its future configurable surface.
6. **Synthetic data only.** No real Golden Key client information, real lead lists, or real documents enter this repository — including this file. Discovery answers describe *process*, never client PII.

---

## 2. Discovery questionnaire

Sixteen areas, taken verbatim from the charter. Each area records: why it matters to AFLO, the interview questions for Natalia, the current status, and the working assumption currently baked into the synthetic prototype (`packages/shared/src/data/synthetic.ts` and the screens that render it).

### 2.1 Lead sources

**Why this matters to AFLO:** Lead source determines what a "new lead" record must capture at creation and how attribution/reporting will eventually work; guessing wrong pollutes the pipeline model from the first record.

**Questions for Natalia:**
1. Where do new leads actually come from today (referrals, social media, events, partner hand-offs, walk-ins, paid ads)? Roughly what share from each?
2. What do you know about a lead at the moment you first hear about them — name and phone only, or more?
3. Do different lead sources get treated differently once they arrive (faster follow-up, different pitch, different intake)?
4. Are there lead sources you want to grow or drop, and would you want the system to report on source performance?

**Current status:** **TBD**

**Working assumption (synthetic prototype):** The synthetic dataset does not model lead source at all — leads exist only with a name, contact info, assigned staff member, and pipeline status. This absence is deliberate: no source taxonomy is invented. *Placeholder — a lead-source field and taxonomy will be added as tenant configuration once confirmed.*

### 2.2 Marketing systems

**Why this matters to AFLO:** If Golden Key already runs email blasts, funnels, or social scheduling elsewhere, AFLO must decide whether to integrate, import, or stay out of the way — not silently duplicate a system Natalia already trusts.

**Questions for Natalia:**
1. What tools (if any) do you use today for marketing — email campaigns, landing pages, social scheduling, SMS blasts?
2. How does someone go from seeing your marketing to becoming a lead you track — is there a form, a DM, a phone call?
3. Do you send anything recurring to your list (newsletter, tips, promotions), and who writes it?
4. Is there any marketing task you wish were automated or off your plate?

**Current status:** **TBD**

**Working assumption (synthetic prototype):** No marketing system is modeled. The prototype begins at the point a lead already exists in the pipeline. *Placeholder — integration or import boundaries will be designed only after the real toolset is known.*

### 2.3 CRM tools

**Why this matters to AFLO:** AFLO's lead/client CRM may replace, coexist with, or need to import from whatever Natalia uses now; migration and dual-entry pain are decided here.

**Questions for Natalia:**
1. Where do lead and client records live right now — a CRM product, spreadsheets, notebooks, phone contacts, memory?
2. What fields do you actually keep per person, and which ones do you look at most often?
3. How many active clients and open leads are in that system today, roughly?
4. If AFLO became your system of record, what from the old system must come with you on day one?

**Current status:** **TBD**

**Working assumption (synthetic prototype):** AFLO itself acts as the CRM: one organization ("Golden Key Wealth"), three synthetic staff members (an organization owner / lead advisor, a financial coach, a client success coordinator), and twelve synthetic people (eight clients, four leads) each assigned to one staff member, with admin notes and a last-activity timestamp per person. *Placeholder — real staff roster, roles, and record fields will replace this after discovery; nothing about the three-person staff shape is assumed true.*

### 2.4 Intake forms

**Why this matters to AFLO:** Intake defines the financial-profile schema and the Intake Completeness Agent's checklist; the questions Natalia actually asks are the contract for onboarding.

**Questions for Natalia:**
1. What do you ask a new client during intake today — is there a form, a questionnaire, or a conversation with notes?
2. Which pieces of information are must-have before you can start working with someone?
3. What financial numbers do you collect up front (income, debts, savings, expenses, credit score), and how do clients give them to you?
4. Where does intake happen — paper, PDF, Google Forms, over the phone — and who enters it into your records?
5. What intake information do clients most often fail to provide, and what do you do then?

**Current status:** **TBD**

**Working assumption (synthetic prototype):** Intake is represented as a financial profile with five fields — monthly income, monthly debt payments, liquid savings, monthly essential expenses, and income stability (`stable`/`variable`) — plus an uploaded "Intake questionnaire" document for one onboarding lead. All amounts are stored in cents. *Placeholder — the field list is a minimal invention to render the UI; the real intake schema comes from Natalia's actual questions.*

### 2.5 Service packages

**Why this matters to AFLO:** Packages determine what a "client" is entitled to (session cadence, report frequency, education access) and eventually billing; the domain model must not bake in a package structure Golden Key doesn't sell.

**Questions for Natalia:**
1. What do you actually sell — one-time consultations, monthly coaching, fixed-length programs, tiers?
2. What is included in each offering (sessions, report reviews, check-ins, education), and how do clients pay?
3. Do different clients get different levels of service today, and how do you keep track of who gets what?
4. Are there services you deliver informally that aren't part of any package but take real time?

**Current status:** **TBD**

**Working assumption (synthetic prototype):** No packages, tiers, or billing are modeled. Every synthetic client implicitly receives the same service: a roadmap, monthly actions, appointments, documents, and quarterly reports. *Placeholder — entitlements will become package-driven configuration once the real offerings are known.*

### 2.6 Client stages

**Why this matters to AFLO:** The pipeline statuses and the financial lifecycle stages are the spine of the dashboard and the readiness engine; these must reflect how Natalia actually thinks about a client's journey, not our guess.

**Questions for Natalia:**
1. Walk me through a person's journey from first contact to long-term client — what distinct phases do *you* see?
2. What has to happen for someone to move from "interested" to "signed on"? Who decides, and how is it recorded?
3. Do you think of active clients as being in different phases of their financial journey (e.g. cleaning up credit vs. preparing to buy)? What do you call those phases?
4. Does the eight-stage lifecycle in the charter (Recovery → Stabilization → Credit Readiness → Capital Readiness → Acquisition → Maintenance → Growth → Legacy) match how you'd describe it, or would you name/split/merge stages differently?
5. Do clients ever go backwards a stage, or sit between stages?

**Current status:** **TBD**

**Working assumption (synthetic prototype):** Two invented layers: (a) a **pipeline status** per record — leads move `new_lead → contacted → consult_scheduled → onboarding`, and clients are `active` or `paused`; (b) a **lifecycle stage** per client computed by versioned deterministic rules over the eight charter stages (synthetic clients currently land in recovery, stabilization, credit readiness, capital readiness, and acquisition). *Placeholder — both the pipeline vocabulary and the stage names/thresholds are configuration-shaped and will be renamed, re-cut, or re-thresholded to match Natalia's actual mental model.*

### 2.7 Follow-up process

**Why this matters to AFLO:** Follow-up cadence drives reminders, the engagement engine, and worker scheduling; automating the wrong cadence would actively damage client relationships.

**Questions for Natalia:**
1. After a first conversation with a lead, what happens next and when — who reaches out, through what channel, after how long?
2. For active clients, how often do you check in, and is that scheduled or ad hoc?
3. How do you currently remember who needs a follow-up? What slips through?
4. When a client goes quiet, what do you do today, and after how long do you consider them at risk?

**Current status:** **TBD**

**Working assumption (synthetic prototype):** Follow-up is represented as scheduled appointments plus an engagement signal derived from `lastActivityAt` (deterministic engagement rules classify clients into engagement bands; the synthetic dataset includes a client dormant for 72 days with a re-engagement recommendation pending staff review, and a "schedule a resume call" action). The thresholds behind those bands are invented. *Placeholder — engagement-risk thresholds and follow-up cadences are versioned rule configuration awaiting real numbers.*

### 2.8 Communication channels

**Why this matters to AFLO:** Channel reality (text vs. email vs. calls vs. DMs) determines what the communications log must capture, what reminders are sent through, and what consent must cover.

**Questions for Natalia:**
1. How do you and your clients actually talk — text, phone, email, WhatsApp, Instagram DMs, in person?
2. Which channel do clients respond to fastest? Which do you prefer for sensitive topics?
3. Do you keep any record of these conversations today? Where?
4. Are there channels you'd want AFLO to send reminders through, and any you'd never want automated?

**Current status:** **TBD**

**Working assumption (synthetic prototype):** Appointments carry a channel of `video`, `phone`, or `in_person`; free-form admin notes stand in for a communications log (one synthetic note records a client preferring text reminders). No email/SMS/DM channels are modeled as first-class records. *Placeholder — the channel list is an enum intended to become tenant configuration; the real channel mix will reshape it.*

### 2.9 Credit-report workflows

**Why this matters to AFLO:** This is the heart of the Golden Key service and the most compliance-sensitive area; AFLO must mirror the real, permissible workflow (manual entry, client-provided reports) and never imply bureau pulls or automated disputes (V1 exclusions).

**Questions for Natalia:**
1. How do you get a client's credit information today — do they bring reports, pull them together with you on a call, or use a monitoring service?
2. Which bureaus/sources do you work from, and how often do you re-check a client's report?
3. What do you actually do with a report once you have it — what do you look for first, and what do you record?
4. How do you track disputes or creditor negotiations a *client* is running (given AFLO must never run them)?
5. How do you know a client's score changed — do they tell you, or do you re-review on a schedule?

**Current status:** **TBD**

**Working assumption (synthetic prototype):** A credit profile per client with: a score whose source is either `manual_entry` or `uploaded_report`, an as-of date, revolving balance and limit (for deterministic utilization calculation), open tradelines, derogatory marks, and an on-time payment rate. Credit-report documents are uploaded per client and pass through review states. No bureau integration, no dispute automation — collections negotiations appear only as staff notes and client actions. *Placeholder — the two score sources and the profile fields are minimal inventions; the real report-handling routine defines what is stored and how often it refreshes.*

### 2.10 Educational content

**Why this matters to AFLO:** The Education Agent can only assign content that exists; the taxonomy (topics, formats, sequencing) must come from what Natalia actually teaches, not a generic financial-literacy curriculum.

**Questions for Natalia:**
1. What do you teach clients today — topics, materials, formats (worksheets, videos, calls, links to third-party content)?
2. Is there a sequence — things every client learns first — or is it picked per situation?
3. What content do you find yourself re-explaining constantly and wish was packaged once?
4. Do you have existing materials you'd want loaded into AFLO, and who owns them?

**Current status:** **TBD**

**Working assumption (synthetic prototype):** Education exists only as monthly actions with category `education` (e.g. "Read: How collections affect your score", "Finish budgeting module 2"). No education modules, library, taxonomy, or assignment records are modeled yet. *Placeholder — an education taxonomy and content library will be configuration/content seeded from Natalia's real materials.*

### 2.11 Reports generated

**Why this matters to AFLO:** Report cadence, audience, and content define the Report Agent's job and one of AFLO's headline promises (demonstrating measurable progress); the wrong cadence or format produces reports nobody reads.

**Questions for Natalia:**
1. Do you currently give clients any written summary of their progress? What does it look like and how often?
2. If you could hand every client a progress report, what would it need to show for them to care?
3. Who else might see a report — a spouse, a lender, a partner professional?
4. Quarterly, monthly, or milestone-based — what rhythm fits your practice?
5. How much time would you tolerate spending reviewing/editing a drafted report before sending it?

**Current status:** **TBD**

**Working assumption (synthetic prototype):** Quarterly written reports per client (`2026-Q1`, `2026-Q2`), each with a status workflow of `draft → ready_for_review → published`, the lifecycle stage at generation, a short list of highlight bullets, and a "focus for next quarter" line. *Placeholder — quarterly cadence, the status workflow, and the highlights-plus-focus format are all inventions; report cadence and template are designed as configuration.*

### 2.12 Documents collected

**Why this matters to AFLO:** Document types, review expectations, and storage habits define the document module, its review states, and the document-completeness rules; they are also the highest-sensitivity data AFLO will hold.

**Questions for Natalia:**
1. What documents do you actually collect from clients today, and at what point in the relationship?
2. How do clients get them to you now (email, text photos, paper, shared drives), and where do they end up?
3. What do you do when you receive a document — is there a review step, and what makes a document "not good enough"?
4. Which documents do you chase repeatedly, and how do you track what's still missing?
5. Are there documents you deliberately do *not* want to hold?

**Current status:** **TBD**

**Working assumption (synthetic prototype):** Document types: `credit_report`, `bank_statement`, `income_verification`, `identification`, and `other` (used for items like a collections letter, a payoff quote, and the intake questionnaire). Each document has a review status: `requested → uploaded → in_review → approved`, with `needs_attention` for problems. *Placeholder — both the type list and the review-state machine are enums designed to become tenant configuration; the real collection-and-review routine replaces them.*

### 2.13 Professional partners

**Why this matters to AFLO:** The partner directory and Partner Routing Agent depend on who Golden Key actually refers to, under what conditions, and what "routing" means in practice (an intro email? a checklist hand-off?).

**Questions for Natalia:**
1. Which outside professionals do you refer clients to today — lenders, credit unions, realtors, CPAs, attorneys, insurance agents?
2. How does a referral happen mechanically — a phone intro, an email, a shared document package?
3. What must be true about a client before you'd refer them to each kind of partner?
4. Do partners send business back to you, and do you track referral outcomes anywhere?
5. Are there formal agreements or compensation arrangements with any partner that AFLO must respect or record?

**Current status:** **TBD**

**Working assumption (synthetic prototype):** No partner directory or referral records exist yet. Partners appear only as narrative context inside synthetic milestones, actions, and report text ("partner lender's document checklist", "partner credit union", "lending partner"). Partner categories implied there (lender, credit union) are illustrative only. *Placeholder — partner categories, eligibility gates, and referral mechanics are configuration to be defined from real relationships.*

### 2.14 Drop-off points

**Why this matters to AFLO:** Knowing where people actually fall out of the funnel (after first call? during document collection? month three?) tells AFLO which workflows deserve automation and which engagement signals matter most.

**Questions for Natalia:**
1. At what point do interested people most often disappear — before the first call, after hearing pricing, during intake, mid-program?
2. Think of the last few people who dropped off: what happened, as best you can tell?
3. Are there steps in your process you suspect are too hard or too slow for clients?
4. When someone drops off, do you ever win them back? How?

**Current status:** **TBD**

**Working assumption (synthetic prototype):** Drop-off is only implicitly represented: a stale lead (contacted, then 38 days of silence) and a `paused` client (72 days inactive) exist in the synthetic pipeline so the UI can render at-risk states. No funnel-conversion model or drop-off taxonomy is assumed. *Placeholder — real drop-off points will shape which transitions get instrumentation and automated nudges.*

### 2.15 Retention problems

**Why this matters to AFLO:** Retention is a core mission metric ("sustain engagement"); AFLO's engagement rules and re-engagement workflows must target the real reasons clients lapse, not generic inactivity heuristics.

**Questions for Natalia:**
1. Why do paying clients stop showing up or cancel, in your experience — money, life events, slow results, losing motivation?
2. How long does a typical client stay engaged, and is there a predictable danger window?
3. What have you tried to keep clients engaged, and what actually worked?
4. What early warning signs tell you a client is about to disengage?
5. What would "great retention" look like for the business in numbers?

**Current status:** **TBD**

**Working assumption (synthetic prototype):** Retention risk is approximated by days-since-last-activity bands over `lastActivityAt` (versioned engagement rules; invented thresholds), a `paused` pipeline status, and a staff-review-gated AI recommendation to draft a re-engagement sequence for a dormant client. *Placeholder — thresholds, warning signs, and re-engagement playbooks are rule configuration awaiting Natalia's actual experience.*

### 2.16 Repetitive administrative work

**Why this matters to AFLO:** "Reduce administrative work" is a stated V1 mission test; the highest-value automations come from the tasks Natalia actually repeats, and building any other automation first wastes the pilot.

**Questions for Natalia:**
1. What tasks do you do over and over every week that feel like they shouldn't need you?
2. How much time per week goes to scheduling, reminders, chasing documents, and rewriting the same explanations?
3. What do you currently copy-paste or re-type between systems?
4. If AFLO could take exactly one chore off your plate this quarter, which one would change your week the most?
5. Which tasks would you *never* want automated because your personal touch is the point?

**Current status:** **TBD**

**Working assumption (synthetic prototype):** The prototype implicitly bets that the repetitive work is: monthly action-plan assembly, document chasing (requested/missing-document states), appointment scheduling and reminders, quarterly report drafting, and re-engagement outreach — because those are the workflows it renders. *Placeholder — this bet is unvalidated; the actual automation backlog will be re-prioritized from Natalia's answers, and human-touch boundaries recorded here.*

---

## 3. Configuration points

Each working assumption above is deliberately built as data an organization can eventually change, not as hardcoded truth. This table maps assumptions to the configuration surface that will make them replaceable.

| Assumption in the prototype | Future configurable surface | Notes |
|---|---|---|
| Pipeline statuses (`new_lead`, `contacted`, `consult_scheduled`, `onboarding`, `active`, `paused`) | Per-organization pipeline status set (ordered, labeled, with allowed transitions) | Lead vs. client kinds may also become configurable phases |
| Lifecycle stage names and thresholds (eight charter stages) | Versioned readiness rule sets per organization | Stage *rules* are already versioned; names/labels join them as tenant config |
| Document types (`credit_report`, `bank_statement`, `income_verification`, `identification`, `other`) | Per-organization document type catalog with required-at-stage checklists | Feeds document-completeness rules and the Intake Completeness Agent |
| Document review states (`requested`, `uploaded`, `in_review`, `approved`, `needs_attention`) | Configurable review workflow states | State machine kept small; labels and required steps tenant-tunable |
| Monthly action categories (`payment`, `savings`, `documentation`, `education`, `habit`) | Per-organization action category taxonomy | Categories drive dashboard grouping and progress rollups |
| Appointment channels (`video`, `phone`, `in_person`) | Per-organization appointment channel list | Extended by real channel mix (e.g. text-first practices) |
| Report cadence (quarterly) and report template (highlights + next-quarter focus) | Configurable report period rules and report templates | Report-period calculation is already a named deterministic rule in the charter |
| Report workflow (`draft`, `ready_for_review`, `published`) | Configurable report review workflow | Human review step is non-negotiable; labels/steps are not |
| Education represented only as action items | Education taxonomy + content library per organization | Empty until Natalia's real materials are cataloged |
| Partner categories (implied: lender, credit union) | Partner directory with per-category routing/eligibility rules | Routing gates are versioned rules per the charter |
| Engagement-risk thresholds (days-since-activity bands) | Versioned engagement rule parameters per organization | Replace invented day counts with observed danger windows |
| Intake financial-profile fields (income, debt payments, savings, essentials, income stability) | Configurable intake form schema | Real intake questions become the schema source of truth |
| Staff roles/titles in seed data | Organization membership roles (charter authorization matrix) | Roles come from the authorization matrix, not the synthetic roster |
| Goal categories (`credit`, `savings`, `debt`, `business_capital`, `home_purchase`) | Per-organization goal category taxonomy | Category list grows from real client goals |

---

## 4. Session log

One row per discovery conversation. Answers are written into Section 2 (flipping statuses from TBD to Confirmed) and decisions recorded here.

| Date | Participants | Areas covered | Decisions |
|---|---|---|---|
| | | | |
