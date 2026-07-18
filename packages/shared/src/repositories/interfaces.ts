import type { AgentEnvelope } from "@aflo/ai";
import type {
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
  MonthlyAction,
  Organization,
  ClientStatus,
  QuarterlyReport,
  RoadmapMilestone,
  StaffMember,
} from "../domain/types";
import type { EngagementAssessment, ReadinessAssessment } from "@aflo/rules";

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
  /** Deterministic stage assessment; null while intake is incomplete. */
  assessment: ReadinessAssessment | null;
  engagement: EngagementAssessment;
  goals: Goal[];
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

export interface DashboardRepository {
  getSnapshot(organizationId: string, now: Date): Promise<DashboardSnapshot>;
}

export interface ClientRepository {
  list(organizationId: string, now: Date): Promise<ClientSummary[]>;
  getDetail(organizationId: string, clientId: string, now: Date): Promise<ClientDetail | null>;
}
