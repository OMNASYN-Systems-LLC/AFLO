import type { AgentEnvelope } from "@aflo/ai";
import type { ConsentRecord, NotificationPreferenceRecord } from "@aflo/notifications";
import type { NeutralityRecord, Partner } from "@aflo/partner-marketplace";
import type { HandoffPackage } from "@aflo/security";
import { syntheticCreditReport, type NormalizedCreditReport } from "@aflo/credit-data";
import {
  DEFAULT_INTAKE,
  INTAKE_RULES_VERSION,
  MS_PER_DAY,
  PIPELINE_RULES_VERSION,
  type IntakeDefinition,
  type PipelineDefinition,
} from "@aflo/rules";
import type {
  AdminNote,
  Appointment,
  ClientDocument,
  ClientRecord,
  CreditProfile,
  EducationAssignment,
  FinancialProfile,
  Goal,
  IntakeRecord,
  MonthlyAction,
  Organization,
  PartnerReferral,
  Playbook,
  PlaybookVersion,
  QuarterlyReport,
  ReadinessAssessmentRecord,
  ReviewDecisionRecord,
  ReviewItem,
  Roadmap,
  RoadmapMilestone,
  SimulationSettings,
  StaffMember,
  VirtualTransaction,
  WorkflowDiscoveryItem,
} from "../domain/types";
import type { ConversationThread, Message } from "../domain/messaging";
import { roundUpAmountCents } from "@aflo/rules";

/**
 * Synthetic Golden Key Wealth dataset for the first visual slice.
 *
 * Every person, number, and document here is invented (Architecture Rule 9).
 * All time-relative values are anchored to SYNTHETIC_NOW so the prototype
 * renders identically on any day it is run.
 */

export const SYNTHETIC_NOW = new Date("2026-07-17T15:00:00Z");

/** Action-plan month derived from the anchor so the dataset never drifts from the demo clock. */
const CURRENT_MONTH = SYNTHETIC_NOW.toISOString().slice(0, 7);

/** ISO datetime `days` before (positive) or after (negative) SYNTHETIC_NOW. */
function daysAgo(days: number): string {
  return new Date(SYNTHETIC_NOW.getTime() - days * MS_PER_DAY).toISOString();
}

function inDays(days: number, hour = 16): string {
  const t = new Date(SYNTHETIC_NOW.getTime() + days * MS_PER_DAY);
  t.setUTCHours(hour, 0, 0, 0);
  return t.toISOString();
}

function cents(dollars: number): number {
  return Math.round(dollars * 100);
}

export interface SyntheticDatabase {
  organization: Organization;
  /** The organization's configured pipeline (future: organizations.settings). */
  pipeline: PipelineDefinition;
  /** The organization's configured intake sections (future: organizations.settings). */
  intake: IntakeDefinition;
  staff: StaffMember[];
  clients: ClientRecord[];
  intakes: IntakeRecord[];
  /** Append-only recorded readiness assessments (latest = standing). */
  assessments: ReadinessAssessmentRecord[];
  financialProfiles: FinancialProfile[];
  creditProfiles: CreditProfile[];
  /** Synthetic normalized credit reports (mock provider). Display-only; never feeds readiness. */
  creditReports: NormalizedCreditReport[];
  goals: Goal[];
  roadmaps: Roadmap[];
  milestones: RoadmapMilestone[];
  monthlyActions: MonthlyAction[];
  documents: ClientDocument[];
  appointments: Appointment[];
  reports: QuarterlyReport[];
  notes: AdminNote[];
  /**
   * Communication-consent records (append-only). Keyed by recipient id,
   * which in the prototype is the client id — clients are the recipients
   * until portal user accounts land, at which point this keys on user id.
   */
  consentRecords: ConsentRecord[];
  /** User-controlled notification-channel preferences (append-only, latest-wins). */
  notificationPreferences: NotificationPreferenceRecord[];
  /** ΛFLO Wealth Academy assignments with provenance. */
  educationAssignments: EducationAssignment[];
  /** Round-up simulator config per client (simulation only). */
  simulationSettings: SimulationSettings[];
  /** Hypothetical transactions for the round-up simulator (never real). */
  virtualTransactions: VirtualTransaction[];
  aiSuggestions: AgentEnvelope[];
  /** Synthetic partner directory — no real names/compensation in code (ADR-0007). */
  partners: Partner[];
  /** Tracked partner referrals, each carrying a complete neutrality record. */
  partnerReferrals: PartnerReferral[];
  /**
   * Signed verification handoff packages (security.v1.0.0). Generated at
   * runtime from verified facts; the seed is empty because a package must be
   * signed by the running store's key to verify.
   */
  handoffPackages: HandoffPackage[];
  /** Secure staff↔client conversation threads (messaging.v1.0.0). */
  conversationThreads: ConversationThread[];
  /** Messages within those threads — client-facing content only (internal notes stay in `notes`). */
  messages: Message[];
  /**
   * Human Review Center queue items (review_center.v1.0.0) — artifact
   * references + provenance identifiers/digests ONLY, never artifact bodies.
   */
  reviewItems: ReviewItem[];
  /** Append-only structured review decisions (the feedback record). */
  reviewDecisions: ReviewDecisionRecord[];
  /** Playbook identities (versioned tenant IP); seeded empty — created via the store. */
  playbooks: Playbook[];
  /** Playbook version content; seeded empty — created via the store. */
  playbookVersions: PlaybookVersion[];
  /** Workflow-discovery queue (anti-invention); seeded empty — raised via the store. */
  workflowDiscoveryItems: WorkflowDiscoveryItem[];
}

const ORG_ID = "org-golden-key";

/**
 * Golden Key's configured pipeline: the founder-required backbone plus an
 * optional "contacted" nurture stage. Stage ids are referenced by
 * ClientRecord.pipelineStageId; transitions only via @aflo/rules.
 */
export const GOLDEN_KEY_PIPELINE: PipelineDefinition = {
  id: "golden-key-v1",
  version: PIPELINE_RULES_VERSION,
  stages: [
    { id: "new_lead", label: "New lead", order: 1, required: true, terminal: false },
    { id: "contacted", label: "Contacted", order: 2, required: false, terminal: false },
    { id: "consultation_scheduled", label: "Consultation scheduled", order: 3, required: true, terminal: false },
    { id: "intake_started", label: "Intake started", order: 4, required: true, terminal: false },
    { id: "intake_completed", label: "Intake completed", order: 5, required: true, terminal: false },
    { id: "client_activated", label: "Client activated", order: 6, required: true, terminal: true },
  ],
};

/**
 * Golden Key's configured intake: the founder-required default section set.
 * Section ids are referenced by IntakeRecord.completedSectionIds; completion
 * only via @aflo/rules intake.completeness.
 */
export const GOLDEN_KEY_INTAKE: IntakeDefinition = {
  id: "golden-key-intake-v1",
  version: INTAKE_RULES_VERSION,
  sections: DEFAULT_INTAKE.sections,
};

const organization: Organization = {
  id: ORG_ID,
  name: "Golden Key Wealth",
  slug: "golden-key-wealth",
  // Founder decision 2026-07-23 #2: the single-operator playbook owner
  // override is OFF by default — Golden Key has multiple authorized operators.
  allowSingleOperatorPlaybookOverride: false,
};

const staff: StaffMember[] = [
  { id: "s-mercer", organizationId: ORG_ID, name: "Danielle Mercer", role: "organization_owner", title: "Founder & Lead Advisor" },
  { id: "s-boyd", organizationId: ORG_ID, name: "Andre Boyd", role: "staff", title: "Financial Coach" },
  { id: "s-lin", organizationId: ORG_ID, name: "Keisha Lin", role: "staff", title: "Client Success Coordinator" },
];

function activatedClient(
  id: string,
  clientStatus: NonNullable<ClientRecord["clientStatus"]>,
  firstName: string,
  lastName: string,
  assignedStaffId: string,
  joinedDaysAgo: number,
  lastActivityDaysAgo: number,
): ClientRecord {
  return {
    id,
    organizationId: ORG_ID,
    kind: "client",
    pipelineStageId: "client_activated",
    clientStatus,
    firstName,
    lastName,
    email: `${firstName.toLowerCase()}.${lastName.toLowerCase()}@example.test`,
    phone: "555-0100",
    assignedStaffId,
    joinedAt: daysAgo(joinedDaysAgo),
    lastActivityAt: daysAgo(lastActivityDaysAgo),
  };
}

function lead(
  id: string,
  pipelineStageId: string,
  firstName: string,
  lastName: string,
  assignedStaffId: string,
  joinedDaysAgo: number,
  lastActivityDaysAgo: number,
): ClientRecord {
  return {
    id,
    organizationId: ORG_ID,
    kind: "lead",
    pipelineStageId,
    clientStatus: null,
    firstName,
    lastName,
    email: `${firstName.toLowerCase()}.${lastName.toLowerCase()}@example.test`,
    phone: "555-0100",
    assignedStaffId,
    joinedAt: daysAgo(joinedDaysAgo),
    lastActivityAt: daysAgo(lastActivityDaysAgo),
  };
}

const clients: ClientRecord[] = [
  activatedClient("c-bell", "active", "Marcus", "Bell", "s-boyd", 210, 5),
  activatedClient("c-grant", "active", "Alicia", "Grant", "s-mercer", 180, 2),
  activatedClient("c-solomon", "active", "Renee", "Solomon", "s-mercer", 320, 9),
  activatedClient("c-pryor", "active", "Devon", "Pryor", "s-boyd", 150, 21),
  activatedClient("c-okafor", "active", "Tanya", "Okafor", "s-mercer", 400, 3),
  activatedClient("c-whitaker", "active", "James", "Whitaker", "s-boyd", 510, 1),
  activatedClient("c-ramirez", "active", "Sofia", "Ramirez", "s-lin", 95, 12),
  activatedClient("c-ngo", "paused", "Harold", "Ngo", "s-boyd", 460, 72),
  lead("l-natarajan", "consultation_scheduled", "Priya", "Natarajan", "s-mercer", 12, 4),
  lead("l-cole", "new_lead", "Terrence", "Cole", "s-lin", 2, 1),
  lead("l-lawson", "contacted", "Beatrice", "Lawson", "s-lin", 45, 38),
  lead("l-haddad", "intake_started", "Omar", "Haddad", "s-boyd", 20, 6),
];

/** Historical completed intake for an activated client. */
function completedIntake(clientId: string, startedDaysAgo: number): IntakeRecord {
  return {
    id: `intake-${clientId}`,
    clientId,
    status: "completed",
    completedSectionIds: GOLDEN_KEY_INTAKE.sections.map((s) => s.id),
    startedAt: daysAgo(startedDaysAgo),
    completedAt: daysAgo(startedDaysAgo - 7),
  };
}

const intakes: IntakeRecord[] = [
  ...clients
    .filter((c) => c.kind === "client")
    .map((c) => completedIntake(c.id, Math.round((SYNTHETIC_NOW.getTime() - Date.parse(c.joinedAt)) / MS_PER_DAY))),
  // Omar Haddad is mid-intake: cash flow, identity, consent, and logistics are
  // captured; his primary goal, self-reported credit info, and itemized debts
  // are still outstanding (which is why he has no credit profile yet).
  {
    id: "intake-l-haddad",
    clientId: "l-haddad",
    status: "in_progress",
    completedSectionIds: [
      "identity",
      "communication_preferences",
      "consent",
      "income_sources",
      "monthly_obligations",
      "savings_reserves",
      "documents",
      "appointments",
      "staff_assignment",
    ],
    startedAt: daysAgo(9),
    completedAt: null,
  },
];

const financialProfiles: FinancialProfile[] = [
  { clientId: "c-bell", monthlyIncomeCents: cents(4200), monthlyDebtPaymentsCents: cents(1500), liquidSavingsCents: cents(800), monthlyEssentialExpensesCents: cents(3400), incomeStability: "variable" },
  { clientId: "c-grant", monthlyIncomeCents: cents(5000), monthlyDebtPaymentsCents: cents(2600), liquidSavingsCents: cents(3100), monthlyEssentialExpensesCents: cents(3800), incomeStability: "stable" },
  { clientId: "c-solomon", monthlyIncomeCents: cents(5400), monthlyDebtPaymentsCents: cents(1800), liquidSavingsCents: cents(7200), monthlyEssentialExpensesCents: cents(4100), incomeStability: "stable" },
  { clientId: "c-pryor", monthlyIncomeCents: cents(6800), monthlyDebtPaymentsCents: cents(2200), liquidSavingsCents: cents(9800), monthlyEssentialExpensesCents: cents(4600), incomeStability: "stable" },
  { clientId: "c-okafor", monthlyIncomeCents: cents(7900), monthlyDebtPaymentsCents: cents(1700), liquidSavingsCents: cents(11800), monthlyEssentialExpensesCents: cents(4900), incomeStability: "stable" },
  { clientId: "c-whitaker", monthlyIncomeCents: cents(8300), monthlyDebtPaymentsCents: cents(1450), liquidSavingsCents: cents(21000), monthlyEssentialExpensesCents: cents(4200), incomeStability: "stable" },
  { clientId: "c-ramirez", monthlyIncomeCents: cents(4700), monthlyDebtPaymentsCents: cents(1300), liquidSavingsCents: cents(2100), monthlyEssentialExpensesCents: cents(3600), incomeStability: "stable" },
  { clientId: "c-ngo", monthlyIncomeCents: cents(6800), monthlyDebtPaymentsCents: cents(2050), liquidSavingsCents: cents(16400), monthlyEssentialExpensesCents: cents(5200), incomeStability: "stable" },
  // Omar's intake has captured cash flow but not yet a credit profile.
  { clientId: "l-haddad", monthlyIncomeCents: cents(5600), monthlyDebtPaymentsCents: cents(1900), liquidSavingsCents: cents(4300), monthlyEssentialExpensesCents: cents(3900), incomeStability: "variable" },
];

const creditProfiles: CreditProfile[] = [
  { clientId: "c-bell", score: 548, scoreSource: "manual_entry", scoreAsOf: daysAgo(18), revolvingBalanceCents: cents(4300), revolvingLimitCents: cents(5000), openTradelines: 4, derogatoryMarks: 5, onTimePaymentRate: 0.78 },
  { clientId: "c-grant", score: 601, scoreSource: "uploaded_report", scoreAsOf: daysAgo(31), revolvingBalanceCents: cents(3800), revolvingLimitCents: cents(6000), openTradelines: 5, derogatoryMarks: 1, onTimePaymentRate: 0.91 },
  { clientId: "c-solomon", score: 612, scoreSource: "uploaded_report", scoreAsOf: daysAgo(12), revolvingBalanceCents: cents(4400), revolvingLimitCents: cents(10000), openTradelines: 6, derogatoryMarks: 1, onTimePaymentRate: 0.95 },
  { clientId: "c-pryor", score: 655, scoreSource: "manual_entry", scoreAsOf: daysAgo(25), revolvingBalanceCents: cents(6100), revolvingLimitCents: cents(16000), openTradelines: 7, derogatoryMarks: 0, onTimePaymentRate: 0.97 },
  { clientId: "c-okafor", score: 671, scoreSource: "uploaded_report", scoreAsOf: daysAgo(9), revolvingBalanceCents: cents(1200), revolvingLimitCents: cents(15000), openTradelines: 8, derogatoryMarks: 0, onTimePaymentRate: 0.99 },
  { clientId: "c-whitaker", score: 705, scoreSource: "uploaded_report", scoreAsOf: daysAgo(6), revolvingBalanceCents: cents(900), revolvingLimitCents: cents(18000), openTradelines: 9, derogatoryMarks: 0, onTimePaymentRate: 1.0 },
  { clientId: "c-ramirez", score: 638, scoreSource: "manual_entry", scoreAsOf: daysAgo(40), revolvingBalanceCents: cents(2900), revolvingLimitCents: cents(7000), openTradelines: 4, derogatoryMarks: 2, onTimePaymentRate: 0.93 },
  { clientId: "c-ngo", score: 688, scoreSource: "uploaded_report", scoreAsOf: daysAgo(80), revolvingBalanceCents: cents(2100), revolvingLimitCents: cents(14000), openTradelines: 7, derogatoryMarks: 0, onTimePaymentRate: 0.98 },
];

/**
 * James Whitaker's recorded assessment history: a realistic progression whose
 * latest record (capital_readiness, 90 days ago) now trails his current
 * verified facts — re-running the assessment is the natural staff action.
 */
const assessments: ReadinessAssessmentRecord[] = [
  // Marcus Bell's standing assessment backs the client-portal demo persona.
  {
    id: "ra-bell-1",
    clientId: "c-bell",
    stage: "recovery",
    previousStage: null,
    ruleVersion: "readiness.v1.0.0",
    reasonCodes: ["RC_PAYMENT_HISTORY_POOR", "RC_DEROGATORY_HIGH"],
    factsUsed: ["creditScore", "utilizationPct", "dtiPct", "reserveMonths", "derogatoryMarks", "onTimePaymentRate", "incomeStability"],
    proposedNextAction: "Set up autopay minimums on every open account and verify each statement cycle",
    requiresHumanReview: false,
    reviewReasonCodes: [],
    assessedAt: daysAgo(30),
    actorStaffId: "s-boyd",
  },
  {
    id: "ra-whitaker-1",
    clientId: "c-whitaker",
    stage: "credit_readiness",
    previousStage: null,
    ruleVersion: "readiness.v1.0.0",
    reasonCodes: ["RC_UTILIZATION_ABOVE_30"],
    factsUsed: ["creditScore", "utilizationPct", "dtiPct", "reserveMonths", "derogatoryMarks", "onTimePaymentRate", "incomeStability"],
    proposedNextAction: "Sequence revolving paydown to bring reported utilization under 30%",
    requiresHumanReview: false,
    reviewReasonCodes: [],
    assessedAt: daysAgo(200),
    actorStaffId: "s-boyd",
  },
  {
    id: "ra-whitaker-2",
    clientId: "c-whitaker",
    stage: "capital_readiness",
    previousStage: "credit_readiness",
    ruleVersion: "readiness.v1.0.0",
    reasonCodes: ["RC_UTILIZATION_ABOVE_10"],
    factsUsed: ["creditScore", "utilizationPct", "dtiPct", "reserveMonths", "derogatoryMarks", "onTimePaymentRate", "incomeStability"],
    proposedNextAction: "Target reporting-date balances to bring utilization under 10%",
    requiresHumanReview: false,
    reviewReasonCodes: [],
    assessedAt: daysAgo(90),
    actorStaffId: "s-boyd",
  },
];

const goals: Goal[] = [
  { id: "g-bell-1", clientId: "c-bell", title: "Rebuild payment history and resolve collections", category: "credit", targetDate: inDays(240), progressPct: 20, isPrimary: true },
  { id: "g-grant-1", clientId: "c-grant", title: "Build a three-month emergency fund", category: "savings", targetDate: inDays(170), progressPct: 35, isPrimary: true },
  { id: "g-solomon-1", clientId: "c-solomon", title: "Reach 640+ score for an auto refinance", category: "credit", targetDate: inDays(150), progressPct: 55, isPrimary: true },
  { id: "g-pryor-1", clientId: "c-pryor", title: "Bring utilization under 30%", category: "debt", targetDate: inDays(90), progressPct: 45, isPrimary: true },
  { id: "g-okafor-1", clientId: "c-okafor", title: "Qualify for small-business working capital", category: "business_capital", targetDate: inDays(210), progressPct: 70, isPrimary: true },
  { id: "g-whitaker-1", clientId: "c-whitaker", title: "Purchase a first home", category: "home_purchase", targetDate: inDays(120), progressPct: 85, isPrimary: true },
  { id: "g-whitaker-2", clientId: "c-whitaker", title: "Keep utilization under 10% through closing", category: "credit", targetDate: inDays(120), progressPct: 90, isPrimary: false },
  { id: "g-ramirez-1", clientId: "c-ramirez", title: "Stabilize monthly cash flow", category: "savings", targetDate: inDays(150), progressPct: 30, isPrimary: true },
  { id: "g-ngo-1", clientId: "c-ngo", title: "Save a rental-property down payment", category: "home_purchase", targetDate: inDays(330), progressPct: 40, isPrimary: true },
];

/**
 * One roadmap per client in V1. Published roadmaps are the standing plans;
 * Sofia Ramirez's is back in staff review (being revised) and Devon Pryor's
 * is a fresh draft — the approval workflow exercises those.
 */
function roadmap(
  clientId: string,
  title: string,
  status: Roadmap["status"],
  stageAtCreation: Roadmap["stageAtCreation"],
  createdByStaffId: string,
  createdDaysAgo: number,
): Roadmap {
  const approved = status === "approved" || status === "published";
  return {
    id: `r-${clientId}`,
    clientId,
    title,
    status,
    stageAtCreation,
    aiRunId: null,
    createdByStaffId,
    approvedByStaffId: approved ? "s-mercer" : null,
    approvedAt: approved ? daysAgo(createdDaysAgo - 4) : null,
    publishedAt: status === "published" ? daysAgo(createdDaysAgo - 5) : null,
    createdAt: daysAgo(createdDaysAgo),
  };
}

const roadmaps: Roadmap[] = [
  roadmap("c-bell", "Recovery: collections resolved, payments current", "published", "recovery", "s-boyd", 180),
  roadmap("c-grant", "Stabilization: reserves and refinance", "published", "stabilization", "s-mercer", 160),
  roadmap("c-solomon", "Credit readiness: 640+ for the auto refinance", "published", "credit_readiness", "s-mercer", 300),
  roadmap("c-pryor", "Utilization under 30% and holding", "draft", "credit_readiness", "s-boyd", 12),
  roadmap("c-okafor", "Capital readiness: working-capital application", "published", "capital_readiness", "s-mercer", 380),
  roadmap("c-whitaker", "Acquisition: first home purchase", "published", "acquisition", "s-boyd", 480),
  roadmap("c-ramirez", "Stabilization: cash-flow floor and reserves", "staff_review", "stabilization", "s-lin", 80),
  roadmap("c-ngo", "Capital readiness: rental down payment", "published", "capital_readiness", "s-boyd", 430),
];

function m(
  id: string,
  clientId: string,
  order: number,
  title: string,
  description: string,
  status: RoadmapMilestone["status"],
  targetMonth: string,
): RoadmapMilestone {
  return { id, clientId, roadmapId: `r-${clientId}`, order, title, description, status, targetMonth };
}

const milestones: RoadmapMilestone[] = [
  // Marcus Bell — recovery
  m("ms-bell-1", "c-bell", 1, "Complete hardship budget", "Document income volatility and set a floor for essential spending.", "completed", "2026-05"),
  m("ms-bell-2", "c-bell", 2, "Bring past-due accounts current", "Negotiate payment arrangements on two past-due tradelines.", "in_progress", "2026-08"),
  m("ms-bell-3", "c-bell", 3, "Resolve smallest collection", "Settle or validate the smallest collection account first.", "in_progress", "2026-09"),
  m("ms-bell-4", "c-bell", 4, "Six months of on-time payments", "Autopay minimums everywhere; verify each statement cycle.", "upcoming", "2027-01"),
  // Alicia Grant — stabilization
  m("ms-grant-1", "c-grant", 1, "Cut DTI below 45%", "Refinance the highest-payment loan and pause new obligations.", "in_progress", "2026-09"),
  m("ms-grant-2", "c-grant", 2, "One month of reserves", "Automate $250/paycheck into the emergency fund.", "in_progress", "2026-10"),
  m("ms-grant-3", "c-grant", 3, "Three months of reserves", "Step up transfers after the car loan payoff in November.", "upcoming", "2027-01"),
  // Renee Solomon — credit readiness
  m("ms-solomon-1", "c-solomon", 1, "Utilization under 30%", "Sequence paydown across the two highest-utilization cards.", "in_progress", "2026-09"),
  m("ms-solomon-2", "c-solomon", 2, "Score above 640", "Hold utilization and let the paydown report for two cycles.", "in_progress", "2026-11"),
  m("ms-solomon-3", "c-solomon", 3, "Auto refinance application", "Package verified income and score for the refinance.", "upcoming", "2026-12"),
  // Devon Pryor — credit readiness
  m("ms-pryor-1", "c-pryor", 1, "Snowball card balances", "Apply $600/month to the highest-rate card.", "in_progress", "2026-09"),
  m("ms-pryor-2", "c-pryor", 2, "Utilization under 30%", "Target reporting-date balances, not just due-date balances.", "upcoming", "2026-10"),
  // Tanya Okafor — capital readiness
  m("ms-okafor-1", "c-okafor", 1, "Score above 680", "Age of accounts and low utilization carry this; no new inquiries.", "in_progress", "2026-09"),
  m("ms-okafor-2", "c-okafor", 2, "Three months of reserves", "Route quarterly distributions into the reserve account.", "in_progress", "2026-10"),
  m("ms-okafor-3", "c-okafor", 3, "Working-capital application package", "Assemble two years of business financials with the partner lender's checklist.", "upcoming", "2027-01"),
  // James Whitaker — acquisition
  m("ms-whitaker-1", "c-whitaker", 1, "Pre-approval refreshed", "Re-verify income and assets with the lending partner.", "completed", "2026-06"),
  m("ms-whitaker-2", "c-whitaker", 2, "Down payment funds seasoned", "Keep 60-day statements clean; no unexplained large deposits.", "completed", "2026-07"),
  m("ms-whitaker-3", "c-whitaker", 3, "Offer and inspection", "House hunt within the approved budget band.", "in_progress", "2026-09"),
  m("ms-whitaker-4", "c-whitaker", 4, "Clear-to-close checklist", "No new credit, no job changes, respond to underwriting within 24h.", "upcoming", "2026-10"),
  // Sofia Ramirez — stabilization
  m("ms-ramirez-1", "c-ramirez", 1, "Baseline budget", "Two months of tracked spending to set the essentials floor.", "completed", "2026-06"),
  m("ms-ramirez-2", "c-ramirez", 2, "One month of reserves", "Automate transfers the day after payday.", "in_progress", "2026-09"),
  m("ms-ramirez-3", "c-ramirez", 3, "Utilization under 30%", "Begin paydown once the reserve floor holds.", "upcoming", "2026-11"),
  // Harold Ngo — capital readiness (paused)
  m("ms-ngo-1", "c-ngo", 1, "Utilization under 10%", "One paydown cycle remains on the travel card.", "in_progress", "2026-08"),
  m("ms-ngo-2", "c-ngo", 2, "Down-payment fund at target", "Resume $900/month transfers after the pause.", "upcoming", "2026-12"),
];

function a(
  id: string,
  clientId: string,
  title: string,
  category: MonthlyAction["category"],
  status: MonthlyAction["status"],
  dueInDays: number,
): MonthlyAction {
  return { id, clientId, month: CURRENT_MONTH, title, category, status, dueDate: inDays(dueInDays) };
}

const monthlyActions: MonthlyAction[] = [
  a("ma-bell-1", "c-bell", "Confirm payment arrangement with Meridian Collections", "payment", "in_progress", 5),
  a("ma-bell-2", "c-bell", "Set up autopay minimums on all four cards", "payment", "done", -3),
  a("ma-bell-3", "c-bell", "Read: How collections affect your score", "education", "todo", 10),
  a("ma-grant-1", "c-grant", "Transfer $250 from each paycheck to reserves", "savings", "done", -6),
  a("ma-grant-2", "c-grant", "Gather payoff quote for the car loan", "documentation", "in_progress", 7),
  a("ma-grant-3", "c-grant", "Review refinance options with Danielle", "education", "todo", 12),
  a("ma-solomon-1", "c-solomon", "Pay $800 to the Northline card before the 24th", "payment", "in_progress", 7),
  a("ma-solomon-2", "c-solomon", "Upload June statements for both cards", "documentation", "done", -4),
  a("ma-pryor-1", "c-pryor", "Apply $600 to the highest-rate card", "payment", "todo", 8),
  a("ma-pryor-2", "c-pryor", "Confirm statement closing dates for all cards", "documentation", "todo", 8),
  a("ma-okafor-1", "c-okafor", "Route Q2 distribution to the reserve account", "savings", "done", -8),
  a("ma-okafor-2", "c-okafor", "Collect the partner lender's document checklist", "documentation", "in_progress", 9),
  a("ma-whitaker-1", "c-whitaker", "Keep all card balances under 10% through closing", "habit", "in_progress", 14),
  a("ma-whitaker-2", "c-whitaker", "Send updated pay stubs to the lending partner", "documentation", "done", -2),
  a("ma-ramirez-1", "c-ramirez", "Automate $150 transfer the day after payday", "savings", "in_progress", 6),
  a("ma-ramirez-2", "c-ramirez", "Finish budgeting module 2", "education", "todo", 11),
  a("ma-ngo-1", "c-ngo", "Re-engage: schedule a resume call", "habit", "todo", 4),
];

function doc(
  id: string,
  clientId: string,
  name: string,
  docType: ClientDocument["docType"],
  reviewStatus: ClientDocument["reviewStatus"],
  updatedDaysAgo: number,
): ClientDocument {
  return { id, clientId, name, docType, reviewStatus, updatedAt: daysAgo(updatedDaysAgo) };
}

const documents: ClientDocument[] = [
  doc("d-bell-1", "c-bell", "Credit report — May 2026", "credit_report", "approved", 45),
  doc("d-bell-2", "c-bell", "Collections letter — Meridian", "other", "in_review", 4),
  doc("d-grant-1", "c-grant", "Credit report — June 2026", "credit_report", "approved", 31),
  doc("d-grant-2", "c-grant", "Car loan payoff quote", "other", "requested", 2),
  doc("d-solomon-1", "c-solomon", "Credit report — July 2026", "credit_report", "approved", 12),
  doc("d-solomon-2", "c-solomon", "June card statements", "bank_statement", "in_review", 4),
  doc("d-pryor-1", "c-pryor", "Credit report — June 2026", "credit_report", "approved", 25),
  doc("d-okafor-1", "c-okafor", "Credit report — July 2026", "credit_report", "approved", 9),
  doc("d-okafor-2", "c-okafor", "2025 business P&L", "income_verification", "in_review", 6),
  doc("d-okafor-3", "c-okafor", "Business bank statements — Q2", "bank_statement", "uploaded", 3),
  doc("d-whitaker-1", "c-whitaker", "Credit report — July 2026", "credit_report", "approved", 6),
  doc("d-whitaker-2", "c-whitaker", "Updated pay stubs", "income_verification", "approved", 2),
  doc("d-whitaker-3", "c-whitaker", "60-day asset statements", "bank_statement", "needs_attention", 1),
  doc("d-ramirez-1", "c-ramirez", "Credit report — June 2026", "credit_report", "approved", 40),
  doc("d-ramirez-2", "c-ramirez", "Proof of income", "income_verification", "requested", 12),
  doc("d-ngo-1", "c-ngo", "Credit report — April 2026", "credit_report", "approved", 80),
  doc("d-haddad-1", "l-haddad", "Intake questionnaire", "other", "uploaded", 6),
  doc("d-haddad-2", "l-haddad", "Photo ID", "identification", "approved", 8),
];

const appointments: Appointment[] = [
  { id: "ap-whitaker", clientId: "c-whitaker", staffId: "s-boyd", purpose: "Pre-offer strategy check-in", scheduledAt: inDays(1, 17), channel: "video" },
  { id: "ap-grant", clientId: "c-grant", staffId: "s-mercer", purpose: "Refinance options review", scheduledAt: inDays(2, 15), channel: "video" },
  { id: "ap-natarajan", clientId: "l-natarajan", staffId: "s-mercer", purpose: "Initial consultation", scheduledAt: inDays(3, 18), channel: "video" },
  { id: "ap-solomon", clientId: "c-solomon", staffId: "s-mercer", purpose: "Utilization paydown review", scheduledAt: inDays(6, 16), channel: "phone" },
  { id: "ap-okafor", clientId: "c-okafor", staffId: "s-mercer", purpose: "Capital application planning", scheduledAt: inDays(9, 19), channel: "in_person" },
  { id: "ap-haddad", clientId: "l-haddad", staffId: "s-boyd", purpose: "Onboarding — financial profile intake", scheduledAt: inDays(4, 15), channel: "video" },
  { id: "ap-bell", clientId: "c-bell", staffId: "s-boyd", purpose: "Collections arrangement follow-up", scheduledAt: inDays(12, 16), channel: "phone" },
];

const reports: QuarterlyReport[] = [
  {
    id: "qr-whitaker-q2",
    clientId: "c-whitaker",
    quarter: "2026-Q2",
    status: "published",
    stageAtGeneration: "acquisition",
    highlights: [
      "Score improved 693 → 705 with utilization held under 10%",
      "Down-payment fund reached 100% of target and is fully seasoned",
      "Pre-approval refreshed with the lending partner",
    ],
    focusForNextQuarter: "Protect the file through closing: no new credit, keep balances low, respond to underwriting quickly.",
    generatedAt: daysAgo(16),
  },
  {
    id: "qr-solomon-q2",
    clientId: "c-solomon",
    quarter: "2026-Q2",
    status: "ready_for_review",
    stageAtGeneration: "credit_readiness",
    highlights: [
      "Utilization down 58% → 44% over the quarter",
      "Two consecutive cycles of on-time payments on every tradeline",
      "Auto refinance target rate identified with partner credit union",
    ],
    focusForNextQuarter: "Cross the 30% utilization line and hold it for two reporting cycles.",
    generatedAt: daysAgo(5),
  },
  {
    id: "qr-okafor-q2",
    clientId: "c-okafor",
    quarter: "2026-Q2",
    status: "draft",
    stageAtGeneration: "capital_readiness",
    highlights: [
      "Reserves grew to 2.4 months of essential expenses",
      "Business P&L submitted for review ahead of the capital application",
    ],
    focusForNextQuarter: "Reach three months of reserves and clear the 680 score line.",
    generatedAt: daysAgo(2),
  },
  {
    id: "qr-bell-q2",
    clientId: "c-bell",
    quarter: "2026-Q2",
    status: "published",
    stageAtGeneration: "recovery",
    highlights: [
      "Hardship budget completed and holding for eight weeks",
      "Autopay minimums established on all revolving accounts",
    ],
    focusForNextQuarter: "Bring both past-due accounts current and open the first collection negotiation.",
    generatedAt: daysAgo(20),
  },
  {
    id: "qr-ngo-q1",
    clientId: "c-ngo",
    quarter: "2026-Q1",
    status: "published",
    stageAtGeneration: "capital_readiness",
    highlights: ["Utilization reduced to 15%", "Down-payment fund at 40% of target"],
    focusForNextQuarter: "One more paydown cycle to cross under 10% utilization.",
    generatedAt: daysAgo(98),
  },
];

const notes: AdminNote[] = [
  { id: "n-whitaker-1", clientId: "c-whitaker", staffId: "s-boyd", body: "Lender flagged one large deposit on the May statement — James is sending the gift letter today.", createdAt: daysAgo(1) },
  { id: "n-solomon-1", clientId: "c-solomon", staffId: "s-mercer", body: "Renee prefers text reminders two days before each payment date.", createdAt: daysAgo(9) },
  { id: "n-bell-1", clientId: "c-bell", staffId: "s-boyd", body: "Meridian offered a 40% settlement; Marcus wants to counter after the next paycheck.", createdAt: daysAgo(4) },
  { id: "n-ngo-1", clientId: "c-ngo", staffId: "s-boyd", body: "Two missed check-ins. Sent a re-engagement email; next step is a phone call this week.", createdAt: daysAgo(8) },
];

/**
 * Communication consent per activated client. Every activated client granted
 * it at onboarding except Harold Ngo, who later revoked it — a newer
 * `granted: false` record — so his notifications are suppressed. Leads have
 * not yet granted communication consent.
 */
const consentRecords: ConsentRecord[] = [
  ...clients
    .filter((c) => c.kind === "client" && c.id !== "c-ngo")
    .map((c) => ({
      userId: c.id,
      consentType: "communication" as const,
      granted: true,
      recordedAt: c.joinedAt,
    })),
  { userId: "c-ngo", consentType: "communication", granted: true, recordedAt: daysAgo(460) },
  { userId: "c-ngo", consentType: "communication", granted: false, recordedAt: daysAgo(70) },
  // Partner-data-sharing consent gates verification handoff packages. James
  // Whitaker and Renee Solomon have granted it (their files can be shared with a
  // consented professional); every other client has not, so a handoff attempt
  // for them fails closed on the consent gate.
  { userId: "c-whitaker", consentType: "partner_data_sharing", granted: true, recordedAt: daysAgo(20) },
  { userId: "c-solomon", consentType: "partner_data_sharing", granted: true, recordedAt: daysAgo(15) },
  // Data-processing consent gates the (synthetic) credit-report summary. Whitaker
  // and Solomon have granted it; every other client has not, so the summary
  // fails closed on the consent gate for them.
  { userId: "c-whitaker", consentType: "data_processing", granted: true, recordedAt: daysAgo(22) },
  { userId: "c-solomon", consentType: "data_processing", granted: true, recordedAt: daysAgo(16) },
];

/**
 * Synthetic normalized credit reports keyed by client. SYNTHETIC ONLY — the
 * `source` is the mock provider, never a bureau; `subjectRef` is a client id,
 * never a real SSN. These drive the staff credit-report summary (display-only,
 * consent-gated) and never feed the readiness engine.
 */
const creditReports: NormalizedCreditReport[] = [
  syntheticCreditReport({
    subjectRef: "c-solomon",
    pulledAt: daysAgo(9),
    score: 672,
    scoreModel: "vantagescore_3",
    onTimePaymentRate: 0.96,
    tradelines: [
      { id: "tl-sol-1", type: "revolving", status: "open", balanceCents: 210000, creditLimitCents: 600000, monthlyPaymentCents: 7000, openedOn: daysAgo(1400), pastDueAmountCents: 0, isDerogatory: false },
      { id: "tl-sol-2", type: "revolving", status: "open", balanceCents: 90000, creditLimitCents: 250000, monthlyPaymentCents: 3500, openedOn: daysAgo(800), pastDueAmountCents: 0, isDerogatory: false },
      { id: "tl-sol-3", type: "auto", status: "open", balanceCents: 1450000, creditLimitCents: null, monthlyPaymentCents: 39000, openedOn: daysAgo(500), pastDueAmountCents: 0, isDerogatory: false },
    ],
    inquiries: [
      { id: "iq-sol-1", type: "hard", occurredOn: daysAgo(120) },
      { id: "iq-sol-2", type: "soft", occurredOn: daysAgo(40) },
    ],
  }),
  syntheticCreditReport({
    subjectRef: "c-whitaker",
    pulledAt: daysAgo(6),
    score: 742,
    scoreModel: "fico_8",
    onTimePaymentRate: 0.99,
    tradelines: [
      { id: "tl-whit-1", type: "revolving", status: "open", balanceCents: 60000, creditLimitCents: 1200000, monthlyPaymentCents: 2500, openedOn: daysAgo(2600), pastDueAmountCents: 0, isDerogatory: false },
      { id: "tl-whit-2", type: "mortgage", status: "open", balanceCents: 24000000, creditLimitCents: null, monthlyPaymentCents: 165000, openedOn: daysAgo(1900), pastDueAmountCents: 0, isDerogatory: false },
    ],
    inquiries: [{ id: "iq-whit-1", type: "hard", occurredOn: daysAgo(300) }],
  }),
];

/**
 * Round-up simulator: enabled for two clients with a handful of synthetic
 * hypothetical transactions. Round-up amounts are computed by the rule so
 * the seed can never disagree with the calculator.
 */
const simulationSettings: SimulationSettings[] = [
  { clientId: "c-grant", roundToCents: 100, multiplier: 1, enabled: true },
  { clientId: "c-ramirez", roundToCents: 100, multiplier: 2, enabled: true },
];

function vtx(
  id: string,
  clientId: string,
  label: string,
  dollars: number,
  daysAgoOccurred: number,
): VirtualTransaction {
  const settings = simulationSettings.find((s) => s.clientId === clientId)!;
  const amountCents = cents(dollars);
  return {
    id,
    clientId,
    label,
    amountCents,
    roundUpAmountCents: roundUpAmountCents(amountCents, settings.roundToCents, settings.multiplier),
    occurredOn: daysAgo(daysAgoOccurred).slice(0, 10),
  };
}

const virtualTransactions: VirtualTransaction[] = [
  vtx("vt-grant-1", "c-grant", "Coffee", 4.35, 12),
  vtx("vt-grant-2", "c-grant", "Groceries", 62.18, 10),
  vtx("vt-grant-3", "c-grant", "Gas", 41.02, 7),
  vtx("vt-grant-4", "c-grant", "Lunch", 13.5, 4),
  vtx("vt-grant-5", "c-grant", "Pharmacy", 8.99, 2),
  vtx("vt-ramirez-1", "c-ramirez", "Coffee", 3.75, 11),
  vtx("vt-ramirez-2", "c-ramirez", "Groceries", 54.4, 8),
  vtx("vt-ramirez-3", "c-ramirez", "Transit", 2.5, 5),
  vtx("vt-ramirez-4", "c-ramirez", "Dinner", 27.1, 3),
];

/**
 * Synthetic partner directory. Every name is invented (Architecture Rule 9)
 * and NO real compensation figures appear — commercial disclosures are
 * plain-language, dollar-free (ADR-0007). Non-commercial options are marked so
 * the neutrality engine can surface them first.
 */
const partners: Partner[] = [
  {
    id: "pt-cedarline-cu",
    organizationId: ORG_ID,
    name: "Cedarline Community Credit Union",
    category: "credit_union",
    licensingNote: "NCUA-insured credit union (synthetic).",
    nonCommercial: true,
    compensationDisclosure: "AFLO receives no compensation for this referral.",
    eligibilityCriteria: "Membership eligibility; score 640+ for auto refinance products.",
    estimatedUserCost: "No cost to apply; a small membership share deposit opens the account.",
    keyRisks: "A hard inquiry may temporarily lower the score by a few points.",
    active: true,
  },
  {
    id: "pt-solidground-ncc",
    organizationId: ORG_ID,
    name: "Solid Ground Nonprofit Credit Counseling",
    category: "nonprofit_credit_counseling",
    licensingNote: "Nonprofit counseling agency (synthetic).",
    nonCommercial: true,
    compensationDisclosure: "AFLO receives no compensation for this referral.",
    eligibilityCriteria: "Open to any client seeking budgeting or debt-management guidance.",
    estimatedUserCost: "Free initial session; low-cost debt-management plans if enrolled.",
    keyRisks: "A debt-management plan may require closing enrolled credit accounts.",
    active: true,
  },
  {
    id: "pt-harborlight-housing",
    organizationId: ORG_ID,
    name: "Harborlight HUD-Approved Housing Counseling",
    category: "housing_counselor",
    licensingNote: "HUD-approved housing counseling agency (synthetic).",
    nonCommercial: true,
    compensationDisclosure: "AFLO receives no compensation for this referral.",
    eligibilityCriteria: "First-time buyers preparing for a mortgage application.",
    estimatedUserCost: "No cost — HUD-funded counseling.",
    keyRisks: "Counseling is educational and does not pre-approve any mortgage.",
    active: true,
  },
  {
    id: "pt-brightpath-cpa",
    organizationId: ORG_ID,
    name: "Brightpath Tax & Accounting",
    category: "cpa_tax",
    licensingNote: "Licensed CPA practice (synthetic).",
    nonCommercial: false,
    compensationDisclosure:
      "AFLO may receive a flat referral fee if you engage this firm; the fee is disclosed in your agreement and never changes your price.",
    eligibilityCriteria: "Clients with self-employment or small-business tax questions.",
    estimatedUserCost: "Paid engagement quoted by the firm before any work begins.",
    keyRisks: "Fees vary by scope; request a written quote before engaging.",
    active: true,
  },
  {
    id: "pt-northstar-capital",
    organizationId: ORG_ID,
    name: "Northstar Small-Business Capital",
    category: "small_business_lender",
    licensingNote: "Licensed commercial lender (synthetic).",
    nonCommercial: false,
    compensationDisclosure:
      "AFLO may receive a referral fee if a loan closes; the fee is disclosed in your agreement and never affects your rate or your readiness result.",
    eligibilityCriteria: "Operating business with 12+ months of revenue and reserves.",
    estimatedUserCost: "Interest and fees set by the lender; compare against other offers.",
    keyRisks: "Taking on debt increases obligations; a hard inquiry may lower the score.",
    active: true,
  },
  {
    id: "pt-oldbridge-lender",
    organizationId: ORG_ID,
    name: "Oldbridge Lending (deactivated)",
    category: "small_business_lender",
    licensingNote: "Former partner, deactivated pending agreement renewal (synthetic).",
    nonCommercial: false,
    compensationDisclosure: "Not referable while deactivated.",
    eligibilityCriteria: "n/a",
    estimatedUserCost: "n/a",
    keyRisks: "n/a",
    active: false,
  },
];

function neutrality(
  whyShown: string,
  eligibleAlternatives: string[],
  compensationDisclosure: string,
  nonCommercialOptionExists: boolean,
  estimatedUserCost: string,
  keyRisks: string,
  eligibilityCriteria: string,
): NeutralityRecord {
  return {
    whyShown,
    eligibleAlternatives,
    compensationDisclosure,
    nonCommercialOptionExists,
    estimatedUserCost,
    keyRisks,
    eligibilityCriteria,
    staffReviewed: true,
  };
}

/**
 * Two seeded referrals: James Whitaker engaged a non-commercial credit union
 * and it supported his readiness (terminal, positive outcome); Renee Solomon
 * has a fresh credit-union referral shared for her auto-refinance goal. Both
 * carry complete neutrality records.
 */
const partnerReferrals: PartnerReferral[] = [
  {
    id: "pr-whitaker-seed",
    organizationId: ORG_ID,
    clientId: "c-whitaker",
    partnerId: "pt-cedarline-cu",
    status: "outcome_recorded",
    neutrality: neutrality(
      "Matches James's acquisition stage and first-home goal; a member credit union offered competitive pre-approval.",
      ["Harborlight HUD-Approved Housing Counseling", "Brightpath Tax & Accounting"],
      "AFLO receives no compensation for this referral.",
      true,
      "No cost to apply; membership share deposit opens the account.",
      "A hard inquiry may temporarily lower the score by a few points.",
      "Membership eligibility; score 640+ for the mortgage pre-approval.",
    ),
    outcome: "engaged_supported_readiness",
    outcomeNote: "Pre-approval refreshed; kept utilization low through the process.",
    createdByStaffId: "s-boyd",
    createdAt: daysAgo(48),
    sharedAt: daysAgo(47),
    updatedAt: daysAgo(20),
  },
  {
    id: "pr-solomon-seed",
    organizationId: ORG_ID,
    clientId: "c-solomon",
    partnerId: "pt-cedarline-cu",
    status: "shared_with_client",
    neutrality: neutrality(
      "Renee's auto-refinance goal fits a credit union once she clears the 640 score line.",
      ["Solid Ground Nonprofit Credit Counseling"],
      "AFLO receives no compensation for this referral.",
      true,
      "No cost to apply; membership share deposit opens the account.",
      "Refinancing extends the loan term unless she keeps the same payoff date.",
      "Membership eligibility; score 640+ for auto refinance.",
    ),
    outcome: null,
    outcomeNote: null,
    createdByStaffId: "s-mercer",
    createdAt: daysAgo(6),
    sharedAt: daysAgo(5),
    updatedAt: daysAgo(5),
  },
];

/**
 * ΛFLO Wealth Academy assignments: James Whitaker completed a lesson (with a
 * knowledge-check score); Renee Solomon has one assigned but not started.
 * Provenance is fully recorded (trigger, rule version, reason code, content
 * version).
 */
const educationAssignments: EducationAssignment[] = [
  {
    id: "edu-whitaker-1",
    clientId: "c-whitaker",
    lessonId: "lsn-utilization",
    contentVersion: "1.0.0",
    trigger: "high_utilization",
    reasonCode: "EDU_UTILIZATION",
    ruleVersion: "education.v1.0.0",
    assignedAt: daysAgo(40),
    completedAt: daysAgo(33),
    knowledgeCheckScore: 1,
    staffReviewStatus: "approved",
  },
  {
    id: "edu-solomon-1",
    clientId: "c-solomon",
    lessonId: "lsn-utilization",
    contentVersion: "1.0.0",
    trigger: "high_utilization",
    reasonCode: "EDU_UTILIZATION",
    ruleVersion: "education.v1.0.0",
    assignedAt: daysAgo(6),
    completedAt: null,
    knowledgeCheckScore: null,
    staffReviewStatus: "not_required",
  },
];

/**
 * Notification preferences: most clients keep the defaults (no records);
 * Alicia Grant has opted out of appointment SMS — a demonstrable override
 * that suppresses only her SMS channel while in-app and email still send.
 */
const notificationPreferences: NotificationPreferenceRecord[] = [
  {
    userId: "c-grant",
    notificationType: "appointment_scheduled",
    channel: "sms",
    enabled: false,
    recordedAt: daysAgo(20),
  },
];

/**
 * Synthetic examples of the typed agent envelope (drafts only — proposals,
 * never facts). These illustrate the review workflow in the UI.
 */
const aiSuggestions: AgentEnvelope[] = [
  {
    id: "ai-solomon-1",
    agentName: "readiness-stage-agent",
    agentVersion: "1.0.0",
    organizationId: ORG_ID,
    clientId: "c-solomon",
    status: "ok",
    confidence: 0.93,
    factsUsed: ["credit_profiles.score", "credit_profiles.utilization", "financial_profiles.dti", "financial_profiles.reserves"],
    missingFacts: [],
    ruleVersionsUsed: ["readiness.v1.0.0"],
    reasonCodes: ["RC_SCORE_BELOW_CREDIT_FLOOR", "RC_UTILIZATION_ABOVE_30"],
    proposedActions: [
      {
        id: "rec-solomon-1",
        summary: "Explain the two blockers keeping Renee in Credit Readiness",
        rationale: "Deterministic rules place Renee in credit_readiness because her score (612) is under the 640 floor and utilization (44%) is above 30%. Draft a plain-language explanation for her next session.",
        impact: "low",
      },
    ],
    prohibitedActionsDetected: [],
    requiresHumanReview: false,
    reviewStatus: "approved",
    createdAt: daysAgo(5),
  },
  {
    id: "ai-whitaker-1",
    agentName: "roadmap-agent",
    agentVersion: "1.0.0",
    organizationId: ORG_ID,
    clientId: "c-whitaker",
    status: "ok",
    confidence: 0.81,
    factsUsed: ["credit_profiles.score", "credit_profiles.utilization", "goals.home_purchase", "documents.asset_statements"],
    missingFacts: [],
    ruleVersionsUsed: ["readiness.v1.0.0"],
    reasonCodes: ["RC_ALL_ACQUISITION_GATES_MET"],
    proposedActions: [
      {
        id: "rec-whitaker-1",
        summary: "Add a 'clear-to-close protection' milestone before closing",
        rationale: "The asset statement flagged needs_attention could delay underwriting. Propose a milestone covering the gift letter and a weekly balance check until closing.",
        impact: "high",
      },
    ],
    prohibitedActionsDetected: [],
    requiresHumanReview: true,
    reviewStatus: "pending_review",
    createdAt: daysAgo(1),
  },
  {
    id: "ai-ngo-1",
    agentName: "engagement-agent",
    agentVersion: "1.0.0",
    organizationId: ORG_ID,
    clientId: "c-ngo",
    status: "ok",
    confidence: 0.88,
    factsUsed: ["clients.last_activity_at", "appointments.history"],
    missingFacts: [],
    ruleVersionsUsed: ["engagement.v1.0.0"],
    reasonCodes: [],
    proposedActions: [
      {
        id: "rec-ngo-1",
        summary: "Draft a re-engagement sequence for Harold",
        rationale: "72 days without activity (dormant). He was one paydown cycle from his utilization milestone — lead the outreach with that momentum.",
        impact: "medium",
      },
    ],
    prohibitedActionsDetected: [],
    requiresHumanReview: true,
    reviewStatus: "pending_review",
    createdAt: daysAgo(2),
  },
];

const conversationThreads: ConversationThread[] = [
  {
    id: "th-solomon-docs",
    organizationId: ORG_ID,
    clientId: "c-solomon",
    subject: "Income documents for your refinance",
    status: "open",
    createdAt: daysAgo(6),
    lastMessageAt: daysAgo(4),
  },
  {
    id: "th-bell-welcome",
    organizationId: ORG_ID,
    clientId: "c-bell",
    subject: "Getting started",
    status: "open",
    createdAt: daysAgo(3),
    lastMessageAt: daysAgo(1),
  },
];

const messages: Message[] = [
  {
    id: "msg-solomon-1",
    threadId: "th-solomon-docs",
    organizationId: ORG_ID,
    clientId: "c-solomon",
    senderRole: "staff",
    senderId: "s-lin",
    body: "Hi Renee — to keep your auto-refinance readiness on track, could you upload your two most recent pay stubs when you have a moment?",
    sentAt: daysAgo(6),
    readByClientAt: daysAgo(5),
    readByStaffAt: daysAgo(6),
  },
  {
    id: "msg-solomon-2",
    threadId: "th-solomon-docs",
    organizationId: ORG_ID,
    clientId: "c-solomon",
    senderRole: "client",
    senderId: "c-solomon",
    body: "Just uploaded both. Let me know if the format works.",
    sentAt: daysAgo(4),
    readByClientAt: daysAgo(4),
    readByStaffAt: null,
  },
  {
    id: "msg-bell-1",
    threadId: "th-bell-welcome",
    organizationId: ORG_ID,
    clientId: "c-bell",
    senderRole: "staff",
    senderId: "s-lin",
    body: "Welcome to Golden Key, Marcus! This is your secure line to our team — ask us anything here.",
    sentAt: daysAgo(3),
    readByClientAt: daysAgo(2),
    readByStaffAt: daysAgo(3),
  },
  {
    id: "msg-bell-2",
    threadId: "th-bell-welcome",
    organizationId: ORG_ID,
    clientId: "c-bell",
    senderRole: "client",
    senderId: "c-bell",
    body: "Thank you — looking forward to getting started.",
    sentAt: daysAgo(1),
    readByClientAt: daysAgo(1),
    readByStaffAt: null,
  },
];

/**
 * Human Review Center seeds (Workstream A PR-5) — items across several states
 * and queues so the future UI slice has data. Every digest below is the REAL
 * sha256 of the canonical synthetic string
 * `AFLO-SYNTHETIC-ARTIFACT::<artifactId>::v<artifactVersion>` — precomputed as
 * literals so this module stays free of node:crypto (it is bundled
 * client-side); the seed test recomputes and asserts each one. Digests and
 * identifiers ONLY — never artifact bodies. No real PII (Architecture Rule 9).
 */
function reviewItem(
  overrides: Partial<ReviewItem> &
    Pick<ReviewItem, "id" | "clientId" | "artifactType" | "artifactId" | "artifactVersion" | "artifactDigest" | "state">,
): ReviewItem {
  return {
    organizationId: ORG_ID,
    workflowType: overrides.artifactType,
    sourceFactSnapshots: [],
    ruleVersionsUsed: [],
    aiRunId: null,
    aiModel: null,
    aiPromptVersion: null,
    confidence: null,
    riskClassification: "high",
    requiredReviewerRole: "staff",
    assignedReviewerStaffId: null,
    reviewedByStaffId: null,
    reviewedAt: null,
    latestDecision: null,
    latestDecisionReasonCode: null,
    modificationsDigest: [],
    publishedResultRef: null,
    publishedAt: null,
    playbookId: null,
    playbookVersion: null,
    previousReviewItemId: null,
    supersededByReviewItemId: null,
    clientActionRef: null,
    clientActionStatus: null,
    outcome: null,
    outcomeRecordedAt: null,
    createdByStaffId: null,
    submittedAt: null,
    createdAt: daysAgo(7),
    updatedAt: daysAgo(7),
    ...overrides,
  };
}

const reviewItems: ReviewItem[] = [
  // Staff-authored roadmap revision still in draft (Devon Pryor's draft roadmap).
  reviewItem({
    id: "rvi-pryor-roadmap",
    clientId: "c-pryor",
    artifactType: "roadmap_draft",
    artifactId: "r-c-pryor",
    artifactVersion: "1",
    artifactDigest: "b322dfcf277d9358fd7476ba6c745f99e86e81aa1845f5975d0cec96218f0752",
    state: "draft",
    sourceFactSnapshots: [{ factId: "credit_profiles.revolving_balance", asOf: daysAgo(9) }],
    ruleVersionsUsed: ["roadmap.v1.0.0"],
    createdByStaffId: "s-boyd",
    createdAt: daysAgo(6),
    updatedAt: daysAgo(6),
  }),
  // AI-drafted concierge recommendation gated straight into the queue (HIGH —
  // founder decision 2026-07-23 #1: credit-related guidance).
  reviewItem({
    id: "rvi-bell-concierge",
    clientId: "c-bell",
    artifactType: "concierge_recommendation",
    artifactId: "concierge-c-bell-2026-07",
    artifactVersion: "1",
    artifactDigest: "18d2089b98e11abb344f252f4486d22aeacd2b53f9637f1fe58601364e02666c",
    state: "awaiting_review",
    aiRunId: "airun-bell-concierge-1",
    aiModel: "mock",
    aiPromptVersion: "concierge.v1",
    confidence: "0.840",
    sourceFactSnapshots: [
      { factId: "credit_profiles.past_due_accounts", asOf: daysAgo(5) },
      { factId: "financial_profiles.monthly_income", asOf: daysAgo(12) },
    ],
    ruleVersionsUsed: ["review_center.v1.0.0"],
    submittedAt: daysAgo(2),
    createdAt: daysAgo(2),
    updatedAt: daysAgo(2),
  }),
  // Financial summary ESCALATED to the admin floor (decision recorded; state
  // stays awaiting_review with the reviewer floor raised — kernel semantics).
  reviewItem({
    id: "rvi-okafor-summary",
    clientId: "c-okafor",
    artifactType: "financial_summary",
    artifactId: "fs-c-okafor-2026-07",
    artifactVersion: "1",
    artifactDigest: "9cbcefd47754cffdef8500ecba6a151ed1dcee32f63d6485e2e620deb9613520",
    state: "awaiting_review",
    requiredReviewerRole: "organization_admin",
    createdByStaffId: "s-lin",
    latestDecision: "escalated",
    latestDecisionReasonCode: "RVD_NEEDS_SENIOR_REVIEW",
    submittedAt: daysAgo(4),
    createdAt: daysAgo(4),
    updatedAt: daysAgo(3),
  }),
  // Quarterly report approved with edits — awaiting publication (v2 of the
  // report artifact; v1's item was superseded by this one).
  reviewItem({
    id: "rvi-solomon-report",
    clientId: "c-solomon",
    artifactType: "quarterly_report",
    artifactId: "qr-solomon-q2",
    artifactVersion: "2",
    artifactDigest: "fe9fc22dbf35bb9612605d2212bcb4d7c999974678b7803bb8df5ac9c36f1994",
    state: "approved",
    createdByStaffId: "s-boyd",
    reviewedByStaffId: "s-mercer",
    reviewedAt: daysAgo(1),
    latestDecision: "approved_with_edits",
    latestDecisionReasonCode: "RVD_EDITED_TONE",
    modificationsDigest: [
      {
        field: "focusForNextQuarter",
        beforeSha256: "9c2e5f8a8f6d5c0b7a4e3d2c1b0a99887766554433221100ffeeddccbbaa9988",
        afterSha256: "1a2b3c4d5e6f708192a3b4c5d6e7f8091a2b3c4d5e6f708192a3b4c5d6e7f809",
      },
    ],
    submittedAt: daysAgo(3),
    createdAt: daysAgo(3),
    updatedAt: daysAgo(1),
  }),
  // Published education assignment (medium risk) with a recorded outcome —
  // the measurable-outcomes loop closed end to end.
  reviewItem({
    id: "rvi-solomon-education",
    clientId: "c-solomon",
    artifactType: "educational_assignment",
    artifactId: "edu-solomon-1",
    artifactVersion: "1",
    artifactDigest: "9ff00111cdaf1f3c6615a7b66f912753a1de239caf8813d1432054449c720aa0",
    state: "published",
    riskClassification: "medium",
    createdByStaffId: "s-lin",
    reviewedByStaffId: "s-boyd",
    reviewedAt: daysAgo(5),
    latestDecision: "approved_unchanged",
    latestDecisionReasonCode: "RVD_ACCURATE",
    publishedResultRef: "education_assignments/edu-solomon-1",
    publishedAt: daysAgo(5),
    clientActionRef: "edu-solomon-1",
    clientActionStatus: "completed",
    outcome: "achieved",
    outcomeRecordedAt: daysAgo(2),
    submittedAt: daysAgo(6),
    createdAt: daysAgo(6),
    updatedAt: daysAgo(2),
  }),
  // Rejected document interpretation (terminal) — the slot is free for a new
  // linked item once the document is corrected.
  reviewItem({
    id: "rvi-whitaker-docint",
    clientId: "c-whitaker",
    artifactType: "document_interpretation",
    artifactId: "d-whitaker-3",
    artifactVersion: "1",
    artifactDigest: "8e67dc5b8077ae2a28d199d6202fdb371e93df16e08f34cb66ac8121200cdbcd",
    state: "rejected",
    aiRunId: "airun-whitaker-docint-1",
    aiModel: "mock",
    aiPromptVersion: "docint.v1",
    confidence: "0.610",
    reviewedByStaffId: "s-boyd",
    reviewedAt: daysAgo(1),
    latestDecision: "rejected",
    latestDecisionReasonCode: "RVD_INACCURATE_FACTS",
    submittedAt: daysAgo(2),
    createdAt: daysAgo(2),
    updatedAt: daysAgo(1),
  }),
];

/** Decision log entries consistent with the decided seed items above. */
const reviewDecisions: ReviewDecisionRecord[] = [
  {
    id: "rvd-okafor-summary-1",
    organizationId: ORG_ID,
    reviewItemId: "rvi-okafor-summary",
    decision: "escalated",
    reasonCode: "RVD_NEEDS_SENIOR_REVIEW",
    ruleVersion: "review_center.v1.0.0",
    decidedByStaffId: "s-lin",
    clientStageAtDecision: "capital_readiness",
    workflowType: "financial_summary",
    aiRunId: null,
    agentVersion: null,
    editedFields: [],
    finalOutputSha256: null,
    escalatedToRole: "organization_admin",
    detail: "Business-income presentation needs a senior call.",
    decidedAt: daysAgo(3),
  },
  {
    id: "rvd-solomon-report-1",
    organizationId: ORG_ID,
    reviewItemId: "rvi-solomon-report",
    decision: "approved_with_edits",
    reasonCode: "RVD_EDITED_TONE",
    ruleVersion: "review_center.v1.0.0",
    decidedByStaffId: "s-mercer",
    clientStageAtDecision: "credit_readiness",
    workflowType: "quarterly_report",
    aiRunId: null,
    agentVersion: null,
    editedFields: ["focusForNextQuarter"],
    finalOutputSha256: "fe9fc22dbf35bb9612605d2212bcb4d7c999974678b7803bb8df5ac9c36f1994",
    escalatedToRole: null,
    detail: null,
    decidedAt: daysAgo(1),
  },
  {
    id: "rvd-solomon-education-1",
    organizationId: ORG_ID,
    reviewItemId: "rvi-solomon-education",
    decision: "approved_unchanged",
    reasonCode: "RVD_ACCURATE",
    ruleVersion: "review_center.v1.0.0",
    decidedByStaffId: "s-boyd",
    clientStageAtDecision: "credit_readiness",
    workflowType: "educational_assignment",
    aiRunId: null,
    agentVersion: null,
    editedFields: [],
    finalOutputSha256: null,
    escalatedToRole: null,
    detail: null,
    decidedAt: daysAgo(5),
  },
  {
    id: "rvd-whitaker-docint-1",
    organizationId: ORG_ID,
    reviewItemId: "rvi-whitaker-docint",
    decision: "rejected",
    reasonCode: "RVD_INACCURATE_FACTS",
    ruleVersion: "review_center.v1.0.0",
    decidedByStaffId: "s-boyd",
    clientStageAtDecision: "acquisition",
    workflowType: "document_interpretation",
    aiRunId: "airun-whitaker-docint-1",
    agentVersion: "1.0.0",
    editedFields: [],
    finalOutputSha256: null,
    escalatedToRole: null,
    detail: "Statement dates misread; re-run after the corrected upload.",
    decidedAt: daysAgo(1),
  },
];

export const syntheticDatabase: SyntheticDatabase = {
  organization,
  pipeline: GOLDEN_KEY_PIPELINE,
  intake: GOLDEN_KEY_INTAKE,
  staff,
  clients,
  intakes,
  assessments,
  financialProfiles,
  creditProfiles,
  creditReports,
  goals,
  roadmaps,
  milestones,
  monthlyActions,
  documents,
  appointments,
  reports,
  notes,
  consentRecords,
  notificationPreferences,
  educationAssignments,
  simulationSettings,
  virtualTransactions,
  aiSuggestions,
  partners,
  partnerReferrals,
  handoffPackages: [],
  conversationThreads,
  messages,
  reviewItems,
  reviewDecisions,
  playbooks: [],
  playbookVersions: [],
  workflowDiscoveryItems: [],
};
