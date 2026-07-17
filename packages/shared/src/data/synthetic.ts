import type { AgentEnvelope } from "../domain/agent";
import type {
  AdminNote,
  Appointment,
  ClientDocument,
  ClientRecord,
  CreditProfile,
  FinancialProfile,
  Goal,
  MonthlyAction,
  Organization,
  QuarterlyReport,
  RoadmapMilestone,
  StaffMember,
} from "../domain/types";

/**
 * Synthetic Golden Key Wealth dataset for the first visual slice.
 *
 * Every person, number, and document here is invented (Architecture Rule 9).
 * All time-relative values are anchored to SYNTHETIC_NOW so the prototype
 * renders identically on any day it is run.
 */

export const SYNTHETIC_NOW = new Date("2026-07-17T15:00:00Z");

const MS_PER_DAY = 86_400_000;

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

export interface SyntheticAgentSuggestion extends AgentEnvelope {
  clientId: string;
}

export interface SyntheticDatabase {
  organization: Organization;
  staff: StaffMember[];
  clients: ClientRecord[];
  financialProfiles: FinancialProfile[];
  creditProfiles: CreditProfile[];
  goals: Goal[];
  milestones: RoadmapMilestone[];
  monthlyActions: MonthlyAction[];
  documents: ClientDocument[];
  appointments: Appointment[];
  reports: QuarterlyReport[];
  notes: AdminNote[];
  aiSuggestions: SyntheticAgentSuggestion[];
}

const ORG_ID = "org-golden-key";

const organization: Organization = {
  id: ORG_ID,
  name: "Golden Key Wealth",
  slug: "golden-key-wealth",
};

const staff: StaffMember[] = [
  { id: "s-mercer", organizationId: ORG_ID, name: "Danielle Mercer", role: "organization_owner", title: "Founder & Lead Advisor" },
  { id: "s-boyd", organizationId: ORG_ID, name: "Andre Boyd", role: "staff", title: "Financial Coach" },
  { id: "s-lin", organizationId: ORG_ID, name: "Keisha Lin", role: "staff", title: "Client Success Coordinator" },
];

function client(
  id: string,
  kind: ClientRecord["kind"],
  pipelineStatus: ClientRecord["pipelineStatus"],
  firstName: string,
  lastName: string,
  assignedStaffId: string,
  joinedDaysAgo: number,
  lastActivityDaysAgo: number,
): ClientRecord {
  return {
    id,
    organizationId: ORG_ID,
    kind,
    pipelineStatus,
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
  client("c-bell", "client", "active", "Marcus", "Bell", "s-boyd", 210, 5),
  client("c-grant", "client", "active", "Alicia", "Grant", "s-mercer", 180, 2),
  client("c-solomon", "client", "active", "Renee", "Solomon", "s-mercer", 320, 9),
  client("c-pryor", "client", "active", "Devon", "Pryor", "s-boyd", 150, 21),
  client("c-okafor", "client", "active", "Tanya", "Okafor", "s-mercer", 400, 3),
  client("c-whitaker", "client", "active", "James", "Whitaker", "s-boyd", 510, 1),
  client("c-ramirez", "client", "active", "Sofia", "Ramirez", "s-lin", 95, 12),
  client("c-ngo", "client", "paused", "Harold", "Ngo", "s-boyd", 460, 72),
  client("l-natarajan", "lead", "consult_scheduled", "Priya", "Natarajan", "s-mercer", 12, 4),
  client("l-cole", "lead", "new_lead", "Terrence", "Cole", "s-lin", 2, 1),
  client("l-lawson", "lead", "contacted", "Beatrice", "Lawson", "s-lin", 45, 38),
  client("l-haddad", "lead", "onboarding", "Omar", "Haddad", "s-boyd", 20, 6),
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

function m(
  id: string,
  clientId: string,
  order: number,
  title: string,
  description: string,
  status: RoadmapMilestone["status"],
  targetMonth: string,
): RoadmapMilestone {
  return { id, clientId, order, title, description, status, targetMonth };
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
  return { id, clientId, month: "2026-07", title, category, status, dueDate: inDays(dueInDays) };
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
 * Synthetic examples of the typed agent envelope (drafts only — proposals,
 * never facts). These illustrate the review workflow in the UI.
 */
const aiSuggestions: SyntheticAgentSuggestion[] = [
  {
    clientId: "c-solomon",
    agent: "readiness-agent",
    status: "ok",
    confidence: 0.93,
    factsUsed: ["credit_profile.score", "credit_profile.utilization", "financial_profile.dti", "financial_profile.reserves"],
    rulesUsed: ["readiness.v1.0.0"],
    reasonCodes: ["RC_SCORE_BELOW_CREDIT_FLOOR", "RC_UTILIZATION_ABOVE_30"],
    recommendations: [
      {
        id: "rec-solomon-1",
        summary: "Explain the two blockers keeping Renee in Credit Readiness",
        rationale: "Deterministic rules place Renee in credit_readiness because her score (612) is under the 640 floor and utilization (44%) is above 30%. Draft a plain-language explanation for her next session.",
        impact: "low",
      },
    ],
    requiresReview: false,
    prohibitedActionDetected: false,
    reviewStatus: "approved",
    createdAt: daysAgo(5),
  },
  {
    clientId: "c-whitaker",
    agent: "roadmap-agent",
    status: "ok",
    confidence: 0.81,
    factsUsed: ["credit_profile.score", "credit_profile.utilization", "goal.home_purchase", "documents.asset_statements"],
    rulesUsed: ["readiness.v1.0.0"],
    reasonCodes: ["RC_ALL_ACQUISITION_GATES_MET"],
    recommendations: [
      {
        id: "rec-whitaker-1",
        summary: "Add a 'clear-to-close protection' milestone before closing",
        rationale: "The asset statement flagged needs_attention could delay underwriting. Propose a milestone covering the gift letter and a weekly balance check until closing.",
        impact: "high",
      },
    ],
    requiresReview: true,
    prohibitedActionDetected: false,
    reviewStatus: "pending_review",
    createdAt: daysAgo(1),
  },
  {
    clientId: "c-ngo",
    agent: "engagement-agent",
    status: "ok",
    confidence: 0.88,
    factsUsed: ["client.last_activity_at", "appointments.history"],
    rulesUsed: ["engagement.v1.0.0"],
    reasonCodes: [],
    recommendations: [
      {
        id: "rec-ngo-1",
        summary: "Draft a re-engagement sequence for Harold",
        rationale: "72 days without activity (dormant). He was one paydown cycle from his utilization milestone — lead the outreach with that momentum.",
        impact: "medium",
      },
    ],
    requiresReview: true,
    prohibitedActionDetected: false,
    reviewStatus: "pending_review",
    createdAt: daysAgo(2),
  },
];

export const syntheticDatabase: SyntheticDatabase = {
  organization,
  staff,
  clients,
  financialProfiles,
  creditProfiles,
  goals,
  milestones,
  monthlyActions,
  documents,
  appointments,
  reports,
  notes,
  aiSuggestions,
};
