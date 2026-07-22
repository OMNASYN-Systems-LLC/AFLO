import {
  PLAYBOOK_CONTENT_FIELDS,
  type FieldProvenance,
  type LifecycleStage,
  type PlaybookContent,
  type PlaybookContentFieldKey,
} from "@aflo/rules";

/**
 * The 10 initial Golden Key playbooks — EDITABLE DRAFTS ONLY (founder
 * directive 2026-07-20: "Do not invent Natalia's exact process. Create
 * editable drafts and a workflow-discovery queue for unresolved decisions.").
 *
 * Every draft here is deliberately GENERIC SCAFFOLDING:
 *   - No field is ever `confirmed` or `approved` — those provenances are
 *     reserved for the founder's actual answers, recorded through the
 *     discovery queue. Seeds carry only `assumption` (visibly generic
 *     placeholder a reviewer can edit) or `discovery_required` (we do not even
 *     have a defensible placeholder).
 *   - Every `discovery_required` field has at least one WorkflowDiscoveryItem
 *     asking the founder the concrete question.
 *   - All versions are "1.0.0" drafts; `contentBlocksApproval` is non-empty
 *     for every seed, so none of them can be approved/published as-is.
 */

export interface PlaybookDiscoverySeed {
  /** Which content field/step the question blocks (checkpoint_ref). */
  checkpointRef: PlaybookContentFieldKey;
  question: string;
  context: string;
}

export interface GoldenKeyPlaybookSeed {
  playbookKey: string;
  name: string;
  version: "1.0.0";
  status: "draft";
  content: PlaybookContent;
  discoveryItems: PlaybookDiscoverySeed[];
}

/** Fields every seed leaves to founder discovery (the process-specific core). */
const DISCOVERY_FIELDS: readonly PlaybookContentFieldKey[] = [
  "triggeringConditions",
  "questionSequence",
  "escalationCriteria",
  "completionEvidence",
  "outcomeMetrics",
];

const COMMON_DISCOVERY: readonly PlaybookDiscoverySeed[] = [
  {
    checkpointRef: "triggeringConditions",
    question: "What actually triggers this playbook in your practice — which numbers, events, or client statements?",
    context: "Seed trigger is a generic placeholder; thresholds must be yours.",
  },
  {
    checkpointRef: "questionSequence",
    question: "What do you ask the client, in what order, when you run this play?",
    context: "The intake conversation is your IP — the seed has no defensible placeholder.",
  },
  {
    checkpointRef: "escalationCriteria",
    question: "When do you stop and escalate (and to whom) instead of continuing this play?",
    context: "Escalation judgment is process-specific.",
  },
  {
    checkpointRef: "completionEvidence",
    question: "What evidence tells you this play is DONE for a client?",
    context: "Documents, events, or numbers — whatever you actually check.",
  },
  {
    checkpointRef: "outcomeMetrics",
    question: "Which outcomes do you track to know this play worked?",
    context: "Feeds the review/playbook effectiveness analytics.",
  },
];

function provenance(): Record<PlaybookContentFieldKey, FieldProvenance> {
  const map = Object.fromEntries(
    PLAYBOOK_CONTENT_FIELDS.map((f) => [f, DISCOVERY_FIELDS.includes(f) ? "discovery_required" : "assumption"]),
  ) as Record<PlaybookContentFieldKey, FieldProvenance>;
  return map;
}

/** Generic scaffold content; per-playbook specifics passed in. */
function draft(input: {
  playbookKey: string;
  name: string;
  purpose: string;
  stages: LifecycleStage[];
  requiredFacts: string[];
  requiredDocuments: string[];
  calculations: string[];
  actionSummary: string;
  actionCategory: string;
}): GoldenKeyPlaybookSeed {
  return {
    playbookKey: input.playbookKey,
    name: input.name,
    version: "1.0.0",
    status: "draft",
    content: {
      purpose: input.purpose,
      applicableStages: input.stages,
      // PLACEHOLDER trigger — discovery_required; the founder supplies the real ones.
      triggeringConditions: [{ kind: "manual", value: "staff judgment (placeholder — pending discovery)" }],
      requiredFacts: input.requiredFacts,
      requiredDocuments: input.requiredDocuments,
      calculations: input.calculations,
      questionSequence: [],
      educationContent: [],
      recommendedActions: [{ id: "a1", summary: input.actionSummary, category: input.actionCategory }],
      prohibitedActions: [
        "Never promise a specific credit-score change",
        "Never advise on legal disputes, tax treatment, or investment selection",
        "Never contact a creditor or bureau on the client's behalf",
      ],
      humanReviewCheckpoints: [
        {
          id: "cp-roadmap",
          afterStep: "a1",
          artifactType: "roadmap_draft",
          riskClassification: "high",
          requiredReviewerRole: "staff",
        },
      ],
      escalationCriteria: [
        {
          id: "e-placeholder",
          condition: "any situation outside this play's scope (placeholder — pending discovery)",
          escalateToRole: "organization_admin",
        },
      ],
      completionEvidence: [],
      outcomeMetrics: [],
      fieldProvenance: provenance(),
    },
    discoveryItems: [...COMMON_DISCOVERY],
  };
}

export const GOLDEN_KEY_PLAYBOOK_DRAFTS: readonly GoldenKeyPlaybookSeed[] = [
  draft({
    playbookKey: "high-utilization-recovery",
    name: "High Utilization Recovery",
    purpose: "Bring revolving utilization down to a sustainable band without destabilizing the budget.",
    stages: ["stabilization", "credit_readiness"],
    requiredFacts: ["revolving_balance_total", "credit_limit_total"],
    requiredDocuments: ["credit_report"],
    calculations: ["readiness.utilization"],
    actionSummary: "Sequence paydown of the highest-utilization revolving account",
    actionCategory: "payment",
  }),
  draft({
    playbookKey: "past-due-stabilization",
    name: "Past-Due Stabilization",
    purpose: "Stop the bleeding on past-due obligations and restore current status.",
    stages: ["recovery", "stabilization"],
    requiredFacts: ["past_due_accounts"],
    requiredDocuments: ["credit_report", "bank_statement"],
    calculations: [],
    actionSummary: "Bring the smallest past-due account current first",
    actionCategory: "payment",
  }),
  draft({
    playbookKey: "collections-preparation",
    name: "Collections Preparation",
    purpose: "Organize verified facts before any client-directed engagement with collection accounts.",
    stages: ["recovery"],
    requiredFacts: ["collection_accounts"],
    requiredDocuments: ["credit_report", "identification"],
    calculations: [],
    actionSummary: "Compile a verified inventory of collection tradelines",
    actionCategory: "documentation",
  }),
  draft({
    playbookKey: "thin-credit-profile",
    name: "Thin Credit Profile",
    purpose: "Build safe, verifiable credit depth for a client with little or no file.",
    stages: ["credit_readiness"],
    requiredFacts: ["open_tradeline_count"],
    requiredDocuments: ["credit_report"],
    calculations: [],
    actionSummary: "Establish one low-limit, reportable tradeline",
    actionCategory: "habit",
  }),
  draft({
    playbookKey: "rental-readiness",
    name: "Rental Readiness",
    purpose: "Prepare a verifiable rental application file (income, history, deposits).",
    stages: ["credit_readiness", "capital_readiness"],
    requiredFacts: ["monthly_income", "monthly_obligations"],
    requiredDocuments: ["income_verification", "bank_statement", "identification"],
    calculations: [],
    actionSummary: "Assemble the rental application document set",
    actionCategory: "documentation",
  }),
  draft({
    playbookKey: "mortgage-readiness",
    name: "Mortgage Readiness",
    purpose: "Stage the long-run facts a mortgage application will be judged on.",
    stages: ["capital_readiness", "acquisition"],
    requiredFacts: ["monthly_income", "monthly_obligations", "savings_balance"],
    requiredDocuments: ["income_verification", "bank_statement", "credit_report"],
    calculations: ["readiness.utilization"],
    actionSummary: "Build the debt-to-income evidence file",
    actionCategory: "documentation",
  }),
  draft({
    playbookKey: "emergency-savings",
    name: "Emergency Savings",
    purpose: "Establish a starter emergency buffer before optimization work begins.",
    stages: ["stabilization"],
    requiredFacts: ["savings_balance", "monthly_income"],
    requiredDocuments: ["bank_statement"],
    calculations: [],
    actionSummary: "Automate a small recurring transfer to savings",
    actionCategory: "savings",
  }),
  draft({
    playbookKey: "debt-overload",
    name: "Debt Overload",
    purpose: "Triage unsustainable total obligations into a workable sequence.",
    stages: ["recovery", "stabilization"],
    requiredFacts: ["monthly_obligations", "monthly_income"],
    requiredDocuments: ["credit_report", "bank_statement"],
    calculations: [],
    actionSummary: "Rank obligations by consequence-of-missing, not size",
    actionCategory: "payment",
  }),
  draft({
    playbookKey: "business-capital-document-readiness",
    name: "Business-Capital Document Readiness",
    purpose: "Prepare the document set small-business capital conversations require.",
    stages: ["capital_readiness"],
    requiredFacts: ["business_revenue_monthly"],
    requiredDocuments: ["bank_statement", "income_verification", "other"],
    calculations: [],
    actionSummary: "Assemble the business financial-statement package",
    actionCategory: "documentation",
  }),
  draft({
    playbookKey: "client-reengagement",
    name: "Client Reengagement",
    purpose: "Re-engage a client whose activity has stalled before progress is lost.",
    stages: ["maintenance"],
    requiredFacts: ["last_activity_at"],
    requiredDocuments: [],
    calculations: [],
    actionSummary: "Send a consented check-in referencing the client's last completed step",
    actionCategory: "education",
  }),
];
