import type { AgentEnvelope } from "@aflo/ai";
import type {
  ActionStatus,
  Appointment,
  AdminNote,
  ClientDocument,
  ClientKind,
  ClientRecord,
  CreditProfile,
  EngagementStatus,
  FinancialProfile,
  Goal,
  LifecycleStage,
  MilestoneStatus,
  MonthlyAction,
  Organization,
  ClientStatus,
  QuarterlyReport,
  ReadinessAssessmentRecord,
  Roadmap,
  RoadmapMilestone,
  StaffMember,
} from "../domain/types";
import type { EngagementAssessment, ReadinessAssessment } from "@aflo/rules";
import type { MessageSenderRole, ThreadStatus } from "@aflo/rules";
import type { ClientThreadView, ConversationThread, Message } from "../domain/messaging";

/**
 * Repository contracts for the first vertical slice.
 *
 * The web app depends only on these interfaces. V1 ships in-memory mock
 * implementations over synthetic data; Neon-backed implementations replace
 * them behind the same contracts (ADR-0002). `now` is passed explicitly so
 * derived, time-sensitive values stay deterministic and testable.
 */

export interface DashboardKpis {
  activeClients: number;
  openLeads: number;
  atRiskOrDormant: number;
  documentsAwaitingReview: number;
  appointmentsNext7Days: number;
  /** Completion rate of this month's action plans across active clients, 0..100. */
  monthlyActionCompletionPct: number;
}

export interface StageCount {
  stage: LifecycleStage;
  count: number;
}

export interface PipelineCount {
  stageId: string;
  /** Label from the organization's pipeline definition. */
  label: string;
  count: number;
}

export interface UpcomingAppointment {
  appointment: Appointment;
  clientId: string;
  clientName: string;
  staffName: string;
}

export interface AttentionItem {
  clientId: string;
  clientName: string;
  kind: "engagement" | "document" | "review";
  detail: string;
}

export interface DashboardSnapshot {
  organization: Organization;
  /** Month ("YYYY-MM", derived from `now`) the action-plan KPI covers. */
  actionPlanMonth: string;
  kpis: DashboardKpis;
  stageDistribution: StageCount[];
  pipeline: PipelineCount[];
  upcomingAppointments: UpcomingAppointment[];
  needsAttention: AttentionItem[];
}

export interface ClientSummary {
  id: string;
  name: string;
  kind: ClientKind;
  pipelineStageId: string;
  pipelineStageLabel: string;
  clientStatus: ClientStatus | null;
  /** Null until intake captures enough verified facts for an assessment. */
  stage: LifecycleStage | null;
  primaryGoal: string | null;
  engagement: EngagementStatus;
  daysSinceLastActivity: number;
  nextAppointmentAt: string | null;
  assignedStaffName: string;
}

export interface DerivedFinancialMetrics {
  utilizationPct: number;
  dtiPct: number;
  reserveMonths: number;
}

export interface ClientDetail {
  record: ClientRecord;
  /** Label for record.pipelineStageId from the org's pipeline definition. */
  pipelineStageLabel: string;
  /** Null when the assignment dangles — surfaced as "Unassigned", never fabricated. */
  assignedStaff: StaffMember | null;
  financialProfile: FinancialProfile | null;
  creditProfile: CreditProfile | null;
  derived: DerivedFinancialMetrics | null;
  /** Live preview computed from current verified facts; null while profiles are missing. */
  assessment: ReadinessAssessment | null;
  /** Latest recorded assessment from the workflow; null before the first run. */
  latestAssessmentRecord: ReadinessAssessmentRecord | null;
  engagement: EngagementAssessment;
  goals: Goal[];
  /** The client's active (non-archived) roadmap; null before one is drafted. */
  roadmap: Roadmap | null;
  /** Milestones of the active roadmap, in order. */
  milestones: RoadmapMilestone[];
  /** Month ("YYYY-MM", derived from `now`) that monthlyActions covers. */
  actionPlanMonth: string;
  /** Actions for actionPlanMonth only — history is a later slice. */
  monthlyActions: MonthlyAction[];
  documents: ClientDocument[];
  nextAppointment: UpcomingAppointment | null;
  latestReport: QuarterlyReport | null;
  notes: AdminNote[];
  /** Draft AI output awaiting or past review — proposals only, never facts. */
  aiSuggestions: AgentEnvelope[];
}

/**
 * Client-portal projection — the ONLY data surface the portal renders.
 * Structurally excludes internal material: reason codes, review flags,
 * draft/under-review roadmaps and reports, pipeline internals, and staff
 * notes can never leak because they are not representable here.
 */
export interface PortalView {
  organizationName: string;
  clientFirstName: string;
  clientName: string;
  /** From the latest recorded assessment NOT awaiting human review; null until one exists. */
  stage: { label: string; focus: string; assessedAt: string } | null;
  primaryGoal: { title: string; targetDate: string; progressPct: number } | null;
  /** Published roadmap only — drafts and reviews never reach the client. */
  roadmap: {
    title: string;
    milestones: { title: string; description: string; status: MilestoneStatus; targetMonth: string }[];
  } | null;
  /** Current month's action plan. */
  monthlyActions: { title: string; category: string; status: ActionStatus; dueDate: string }[];
  /** Published reports only, newest first. */
  publishedReports: {
    quarter: string;
    highlights: string[];
    focusForNextQuarter: string;
    generatedAt: string;
  }[];
  nextAppointment: { purpose: string; scheduledAt: string; channel: string; staffName: string } | null;
  /** ΛFLO Wealth Academy — assigned lessons, newest first. */
  academy: { lessonTitle: string; format: string; assigned: string; completed: boolean }[];
  /**
   * Secure message threads, client-safe (built from the toClientThreadView
   * projection): "you"/"advisor" only, no staff ids or internal metadata.
   */
  conversations: ClientThreadView[];
}

export interface PortalRepository {
  /** Null for unknown ids, foreign-org ids, and non-activated records (fail closed). */
  getPortalView(organizationId: string, clientId: string, now: Date): Promise<PortalView | null>;
}

export interface DashboardRepository {
  getSnapshot(organizationId: string, now: Date): Promise<DashboardSnapshot>;
}

export interface ClientRepository {
  list(organizationId: string, now: Date): Promise<ClientSummary[]>;
  getDetail(organizationId: string, clientId: string, now: Date): Promise<ClientDetail | null>;
}

export interface CreateThreadInput {
  clientId: string;
  subject: string;
}

export interface PostMessageInput {
  threadId: string;
  senderRole: MessageSenderRole;
  /** A staff member id, or the thread's client id when the client posts. */
  senderId: string;
  /** Plaintext — the repository encrypts it; the DB only ever holds ciphertext. */
  body: string;
}

/**
 * Persistence contract for secure staff↔client messaging (the Neon-backed
 * implementation is org-scoped via RLS + `withOrgContext` and encrypts every
 * body at rest). Callers work in PLAINTEXT `Message.body`; encryption is entirely
 * below this boundary. Every method takes `organizationId` from the verified
 * session, never the browser. Deterministic well-formedness (empty/too-long body,
 * closed thread) is re-checked against the messaging kernel, so an invalid write
 * is rejected even if a caller skipped validation.
 */
export interface MessagingRepository {
  /** Open a new thread (status `open`, no messages yet). */
  createThread(organizationId: string, input: CreateThreadInput, now: Date): Promise<ConversationThread>;
  /** Null for unknown ids and foreign-org ids (RLS + explicit org filter). */
  getThread(organizationId: string, threadId: string): Promise<ConversationThread | null>;
  /** All of a client's threads, most-recently-active first. */
  listThreads(organizationId: string, clientId: string): Promise<ConversationThread[]>;
  /**
   * Append a message to a thread and bump its `lastMessageAt`. The message's
   * `clientId` is DERIVED from the loaded thread (not caller-supplied), so a
   * message can never be mis-filed to another client; a client sender may only
   * post to their own thread. Throws on a missing/foreign thread or a rejected
   * body (closed thread / empty / too long).
   */
  postMessage(organizationId: string, input: PostMessageInput, now: Date): Promise<Message>;
  /** A thread's messages oldest-first, bodies DECRYPTED to plaintext. */
  listMessages(organizationId: string, threadId: string): Promise<Message[]>;
  /**
   * Mark the COUNTERPARTY's unread messages read (read receipts): a staff reader
   * marks client messages, a client reader marks staff messages. Returns the
   * count transitioned (0 = idempotent no-op).
   */
  markThreadRead(
    organizationId: string,
    threadId: string,
    readerRole: MessageSenderRole,
    now: Date,
  ): Promise<number>;
  /** Close or reopen a thread; returns the resulting status (kernel-validated). */
  setThreadStatus(
    organizationId: string,
    threadId: string,
    action: "close" | "reopen",
    now: Date,
  ): Promise<ThreadStatus>;
}
