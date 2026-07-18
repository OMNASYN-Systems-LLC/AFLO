import {
  assessEngagement,
  assessReadiness,
  ENGAGEMENT_STATUS_LABELS,
  MS_PER_DAY,
} from "@aflo/rules";
import { syntheticDatabase, type SyntheticDatabase } from "../data/synthetic";
import { toReadinessFacts } from "../domain/facts";
import type {
  AttentionItem,
  ClientDetail,
  ClientRepository,
  ClientSummary,
  DashboardRepository,
  DashboardSnapshot,
  PipelineCount,
  StageCount,
  UpcomingAppointment,
} from "./interfaces";
import {
  fullName,
  LIFECYCLE_STAGES,
  type Appointment,
  type ClientRecord,
  type CreditProfile,
  type FinancialProfile,
  type Goal,
  type StaffMember,
} from "../domain/types";

/**
 * In-memory implementations over the synthetic dataset. Organization scoping
 * is enforced record-by-record — every tenant-owned row is reached through
 * its owning, org-checked client — exactly as a Neon-backed implementation
 * would enforce it (Architecture Rule 8), so swapping the data source never
 * loosens isolation.
 */

/** Per-request index over the dataset, org-scoped once and reused. */
class OrgScope {
  readonly clients: ClientRecord[];
  readonly clientById: Map<string, ClientRecord>;
  readonly staffById: Map<string, StaffMember>;
  readonly financialByClient: Map<string, FinancialProfile>;
  readonly creditByClient: Map<string, CreditProfile>;
  readonly primaryGoalByClient: Map<string, Goal>;
  readonly nextAppointmentByClient: Map<string, Appointment>;

  constructor(
    readonly db: SyntheticDatabase,
    readonly organizationId: string,
    readonly now: Date,
  ) {
    this.clients = db.clients.filter((c) => c.organizationId === organizationId);
    this.clientById = new Map(this.clients.map((c) => [c.id, c]));
    this.staffById = new Map(
      db.staff.filter((s) => s.organizationId === organizationId).map((s) => [s.id, s]),
    );
    this.financialByClient = new Map(
      db.financialProfiles.filter((p) => this.clientById.has(p.clientId)).map((p) => [p.clientId, p]),
    );
    this.creditByClient = new Map(
      db.creditProfiles.filter((p) => this.clientById.has(p.clientId)).map((p) => [p.clientId, p]),
    );
    this.primaryGoalByClient = new Map(
      db.goals
        .filter((g) => g.isPrimary && this.clientById.has(g.clientId))
        .map((g) => [g.clientId, g]),
    );
    this.nextAppointmentByClient = new Map();
    for (const ap of [...this.appointments()].sort((x, y) =>
      x.scheduledAt.localeCompare(y.scheduledAt),
    )) {
      if (new Date(ap.scheduledAt) > now && !this.nextAppointmentByClient.has(ap.clientId)) {
        this.nextAppointmentByClient.set(ap.clientId, ap);
      }
    }
  }

  /** Tenant-owned rows are only visible through their org-checked client. */
  appointments(): Appointment[] {
    return this.db.appointments.filter((ap) => this.clientById.has(ap.clientId));
  }

  documents() {
    return this.db.documents.filter((d) => this.clientById.has(d.clientId));
  }

  reports() {
    return this.db.reports.filter((r) => this.clientById.has(r.clientId));
  }

  monthlyActions() {
    return this.db.monthlyActions.filter((a) => this.clientById.has(a.clientId));
  }

  toUpcoming(appointment: Appointment): UpcomingAppointment | null {
    const client = this.clientById.get(appointment.clientId);
    if (!client) return null;
    return {
      appointment,
      clientId: client.id,
      clientName: fullName(client),
      staffName: this.staffById.get(appointment.staffId)?.name ?? "Unassigned",
    };
  }
}

function currentMonthOf(now: Date): string {
  return now.toISOString().slice(0, 7);
}

export class MockClientRepository implements ClientRepository {
  constructor(private readonly db: SyntheticDatabase = syntheticDatabase) {}

  async list(organizationId: string, now: Date): Promise<ClientSummary[]> {
    const scope = new OrgScope(this.db, organizationId, now);
    return scope.clients
      .map((c) => toSummary(scope, c, now))
      .sort((x, y) => {
        if (x.kind !== y.kind) return x.kind === "client" ? -1 : 1;
        return x.name.localeCompare(y.name);
      });
  }

  async getDetail(organizationId: string, clientId: string, now: Date): Promise<ClientDetail | null> {
    const scope = new OrgScope(this.db, organizationId, now);
    const record = scope.clientById.get(clientId);
    if (!record) return null;

    const financialProfile = scope.financialByClient.get(clientId) ?? null;
    const creditProfile = scope.creditByClient.get(clientId) ?? null;

    // Facts are derived once; the displayed metrics and the assessment can
    // never disagree because they come from the same object.
    const facts =
      financialProfile && creditProfile ? toReadinessFacts(financialProfile, creditProfile) : null;
    const actionPlanMonth = currentMonthOf(now);
    const next = scope.nextAppointmentByClient.get(clientId);

    return {
      record,
      pipelineStageLabel:
        this.db.pipeline.stages.find((s) => s.id === record.pipelineStageId)?.label ??
        record.pipelineStageId,
      assignedStaff: scope.staffById.get(record.assignedStaffId) ?? null,
      financialProfile,
      creditProfile,
      derived: facts
        ? {
            utilizationPct: facts.utilizationPct,
            dtiPct: facts.dtiPct,
            reserveMonths: facts.reserveMonths,
          }
        : null,
      assessment: facts ? assessReadiness(facts) : null,
      engagement: assessEngagement(record.lastActivityAt, now),
      goals: this.db.goals.filter((g) => g.clientId === clientId),
      milestones: this.db.milestones
        .filter((ms) => ms.clientId === clientId)
        .sort((x, y) => x.order - y.order),
      actionPlanMonth,
      monthlyActions: this.db.monthlyActions.filter(
        (a) => a.clientId === clientId && a.month === actionPlanMonth,
      ),
      documents: this.db.documents
        .filter((d) => d.clientId === clientId)
        .sort((x, y) => y.updatedAt.localeCompare(x.updatedAt)),
      nextAppointment: next ? scope.toUpcoming(next) : null,
      latestReport:
        this.db.reports
          .filter((r) => r.clientId === clientId)
          .sort((x, y) => y.quarter.localeCompare(x.quarter))[0] ?? null,
      notes: this.db.notes
        .filter((n) => n.clientId === clientId)
        .sort((x, y) => y.createdAt.localeCompare(x.createdAt)),
      aiSuggestions: this.db.aiSuggestions.filter((s) => s.clientId === clientId),
    };
  }
}

function toSummary(scope: OrgScope, c: ClientRecord, now: Date): ClientSummary {
  const financial = scope.financialByClient.get(c.id);
  const credit = scope.creditByClient.get(c.id);
  const engagement = assessEngagement(c.lastActivityAt, now);

  const stageDef = scope.db.pipeline.stages.find((s) => s.id === c.pipelineStageId);

  return {
    id: c.id,
    name: fullName(c),
    kind: c.kind,
    pipelineStageId: c.pipelineStageId,
    pipelineStageLabel: stageDef?.label ?? c.pipelineStageId,
    clientStatus: c.clientStatus,
    stage: financial && credit ? assessReadiness(toReadinessFacts(financial, credit)).stage : null,
    primaryGoal: scope.primaryGoalByClient.get(c.id)?.title ?? null,
    engagement: engagement.status,
    daysSinceLastActivity: engagement.daysSinceLastActivity,
    nextAppointmentAt: scope.nextAppointmentByClient.get(c.id)?.scheduledAt ?? null,
    assignedStaffName: scope.staffById.get(c.assignedStaffId)?.name ?? "Unassigned",
  };
}

export class MockDashboardRepository implements DashboardRepository {
  constructor(
    private readonly db: SyntheticDatabase = syntheticDatabase,
    private readonly clients: ClientRepository = new MockClientRepository(db),
  ) {}

  async getSnapshot(organizationId: string, now: Date): Promise<DashboardSnapshot> {
    if (this.db.organization.id !== organizationId) {
      throw new Error(`unknown organization: ${organizationId}`);
    }

    const scope = new OrgScope(this.db, organizationId, now);
    const summaries = await this.clients.list(organizationId, now);
    const actionPlanMonth = currentMonthOf(now);

    const stageCounts = new Map<string, number>();
    for (const s of summaries) {
      if (s.stage) stageCounts.set(s.stage, (stageCounts.get(s.stage) ?? 0) + 1);
    }
    const stageDistribution: StageCount[] = LIFECYCLE_STAGES.map((stage) => ({
      stage,
      count: stageCounts.get(stage) ?? 0,
    }));

    // Pipeline counts in definition order, every configured stage present.
    const pipelineCounts = new Map<string, number>();
    for (const s of summaries) {
      pipelineCounts.set(s.pipelineStageId, (pipelineCounts.get(s.pipelineStageId) ?? 0) + 1);
    }
    const pipeline: PipelineCount[] = [...this.db.pipeline.stages]
      .sort((a, b) => a.order - b.order)
      .map((stage) => ({
        stageId: stage.id,
        label: stage.label,
        count: pipelineCounts.get(stage.id) ?? 0,
      }));

    // KPI contract: completion across ACTIVE clients' plans for this month.
    const activeClientIds = new Set(
      scope.clients.filter((c) => c.kind === "client" && c.clientStatus === "active").map((c) => c.id),
    );
    const monthActions = scope
      .monthlyActions()
      .filter((a) => a.month === actionPlanMonth && activeClientIds.has(a.clientId));
    const doneActions = monthActions.filter((a) => a.status === "done").length;

    const upcoming = scope
      .appointments()
      .filter((ap) => new Date(ap.scheduledAt) > now)
      .sort((x, y) => x.scheduledAt.localeCompare(y.scheduledAt))
      .slice(0, 5)
      .map((ap) => scope.toUpcoming(ap))
      .filter((u): u is UpcomingAppointment => u !== null);

    const needsAttention: AttentionItem[] = [];
    for (const s of summaries) {
      if (s.engagement === "dormant" || s.engagement === "at_risk") {
        needsAttention.push({
          clientId: s.id,
          clientName: s.name,
          kind: "engagement",
          detail: `${ENGAGEMENT_STATUS_LABELS[s.engagement]} — ${s.daysSinceLastActivity} days since last activity`,
        });
      }
    }
    for (const d of scope.documents()) {
      if (d.reviewStatus === "needs_attention") {
        const c = scope.clientById.get(d.clientId);
        if (c) {
          needsAttention.push({
            clientId: c.id,
            clientName: fullName(c),
            kind: "document",
            detail: `Document needs attention: ${d.name}`,
          });
        }
      }
    }
    for (const r of scope.reports()) {
      if (r.status === "ready_for_review") {
        const c = scope.clientById.get(r.clientId);
        if (c) {
          needsAttention.push({
            clientId: c.id,
            clientName: fullName(c),
            kind: "review",
            detail: `${r.quarter} report ready for review`,
          });
        }
      }
    }

    const in7Days = new Date(now.getTime() + 7 * MS_PER_DAY);

    return {
      organization: this.db.organization,
      actionPlanMonth,
      kpis: {
        activeClients: activeClientIds.size,
        openLeads: summaries.filter((s) => s.kind === "lead").length,
        atRiskOrDormant: summaries.filter((s) => s.engagement === "at_risk" || s.engagement === "dormant").length,
        documentsAwaitingReview: scope
          .documents()
          .filter((d) => d.reviewStatus === "uploaded" || d.reviewStatus === "in_review").length,
        appointmentsNext7Days: scope.appointments().filter((ap) => {
          const t = new Date(ap.scheduledAt);
          return t > now && t <= in7Days;
        }).length,
        monthlyActionCompletionPct:
          monthActions.length === 0 ? 0 : Math.round((doneActions / monthActions.length) * 100),
      },
      stageDistribution,
      pipeline,
      upcomingAppointments: upcoming,
      needsAttention,
    };
  }
}
