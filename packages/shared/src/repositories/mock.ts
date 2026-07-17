import { syntheticDatabase, type SyntheticDatabase } from "../data/synthetic";
import { assessEngagement } from "../rules/engagement";
import {
  assessReadiness,
  dtiPct,
  reserveMonths,
  toReadinessFacts,
  utilizationPct,
} from "../rules/readiness";
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
import { LIFECYCLE_STAGES, type ClientRecord, type PipelineStatus } from "../domain/types";

/**
 * In-memory implementations over the synthetic dataset. Organization scoping
 * is enforced here exactly as a Neon-backed implementation would enforce it,
 * so swapping the data source never loosens isolation (Architecture Rule 8).
 */

const MS_PER_DAY = 86_400_000;

function fullName(c: ClientRecord): string {
  return `${c.firstName} ${c.lastName}`;
}

export class MockClientRepository implements ClientRepository {
  constructor(private readonly db: SyntheticDatabase = syntheticDatabase) {}

  async list(organizationId: string, now: Date): Promise<ClientSummary[]> {
    return this.db.clients
      .filter((c) => c.organizationId === organizationId)
      .map((c) => this.toSummary(c, now))
      .sort((x, y) => {
        if (x.kind !== y.kind) return x.kind === "client" ? -1 : 1;
        return x.name.localeCompare(y.name);
      });
  }

  async getDetail(organizationId: string, clientId: string, now: Date): Promise<ClientDetail | null> {
    const record = this.db.clients.find(
      (c) => c.id === clientId && c.organizationId === organizationId,
    );
    if (!record) return null;

    const financialProfile = this.db.financialProfiles.find((p) => p.clientId === clientId) ?? null;
    const creditProfile = this.db.creditProfiles.find((p) => p.clientId === clientId) ?? null;

    const derived =
      financialProfile && creditProfile
        ? {
            utilizationPct: utilizationPct(creditProfile.revolvingBalanceCents, creditProfile.revolvingLimitCents),
            dtiPct: dtiPct(financialProfile.monthlyDebtPaymentsCents, financialProfile.monthlyIncomeCents),
            reserveMonths: reserveMonths(financialProfile.liquidSavingsCents, financialProfile.monthlyEssentialExpensesCents),
          }
        : null;

    const assessment =
      financialProfile && creditProfile
        ? assessReadiness(toReadinessFacts(financialProfile, creditProfile))
        : null;

    const assignedStaff =
      this.db.staff.find((s) => s.id === record.assignedStaffId) ?? this.db.staff[0];
    if (!assignedStaff) throw new Error("synthetic dataset has no staff");

    const nextAppointment = nextAppointmentFor(this.db, clientId, now);

    return {
      record,
      assignedStaff,
      financialProfile,
      creditProfile,
      derived,
      assessment,
      engagement: assessEngagement(record.lastActivityAt, now),
      goals: this.db.goals.filter((g) => g.clientId === clientId),
      milestones: this.db.milestones
        .filter((ms) => ms.clientId === clientId)
        .sort((x, y) => x.order - y.order),
      monthlyActions: this.db.monthlyActions.filter((a) => a.clientId === clientId),
      documents: this.db.documents
        .filter((d) => d.clientId === clientId)
        .sort((x, y) => y.updatedAt.localeCompare(x.updatedAt)),
      nextAppointment,
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

  private toSummary(c: ClientRecord, now: Date): ClientSummary {
    const financial = this.db.financialProfiles.find((p) => p.clientId === c.id);
    const credit = this.db.creditProfiles.find((p) => p.clientId === c.id);
    const engagement = assessEngagement(c.lastActivityAt, now);
    const staff = this.db.staff.find((s) => s.id === c.assignedStaffId);
    const next = nextAppointmentFor(this.db, c.id, now);

    return {
      id: c.id,
      name: fullName(c),
      kind: c.kind,
      pipelineStatus: c.pipelineStatus,
      stage:
        financial && credit ? assessReadiness(toReadinessFacts(financial, credit)).stage : null,
      primaryGoal:
        this.db.goals.find((g) => g.clientId === c.id && g.isPrimary)?.title ?? null,
      engagement: engagement.status,
      daysSinceLastActivity: engagement.daysSinceLastActivity,
      nextAppointmentAt: next?.appointment.scheduledAt ?? null,
      assignedStaffName: staff?.name ?? "Unassigned",
    };
  }
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

    const summaries = await this.clients.list(organizationId, now);
    const currentMonth = now.toISOString().slice(0, 7);

    const stageCounts = new Map<string, number>();
    for (const s of summaries) {
      if (s.stage) stageCounts.set(s.stage, (stageCounts.get(s.stage) ?? 0) + 1);
    }
    const stageDistribution: StageCount[] = LIFECYCLE_STAGES.map((stage) => ({
      stage,
      count: stageCounts.get(stage) ?? 0,
    }));

    const pipelineCounts = new Map<PipelineStatus, number>();
    for (const s of summaries) {
      pipelineCounts.set(s.pipelineStatus, (pipelineCounts.get(s.pipelineStatus) ?? 0) + 1);
    }
    const pipeline: PipelineCount[] = [...pipelineCounts.entries()].map(([status, count]) => ({
      status,
      count,
    }));

    const monthActions = this.db.monthlyActions.filter((a) => a.month === currentMonth);
    const doneActions = monthActions.filter((a) => a.status === "done").length;

    const upcoming = this.db.appointments
      .filter((ap) => new Date(ap.scheduledAt) > now)
      .sort((x, y) => x.scheduledAt.localeCompare(y.scheduledAt))
      .slice(0, 5)
      .map((ap) => toUpcoming(this.db, ap.id))
      .filter((u): u is UpcomingAppointment => u !== null);

    const needsAttention: AttentionItem[] = [];
    for (const s of summaries) {
      if (s.engagement === "dormant" || s.engagement === "at_risk") {
        needsAttention.push({
          clientId: s.id,
          clientName: s.name,
          kind: "engagement",
          detail: `${s.engagement === "dormant" ? "Dormant" : "At risk"} — ${s.daysSinceLastActivity} days since last activity`,
        });
      }
    }
    for (const d of this.db.documents) {
      if (d.reviewStatus === "needs_attention") {
        const c = this.db.clients.find((x) => x.id === d.clientId);
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
    for (const r of this.db.reports) {
      if (r.status === "ready_for_review") {
        const c = this.db.clients.find((x) => x.id === r.clientId);
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
      kpis: {
        activeClients: summaries.filter((s) => s.kind === "client" && s.pipelineStatus === "active").length,
        openLeads: summaries.filter((s) => s.kind === "lead").length,
        atRiskOrDormant: summaries.filter((s) => s.engagement === "at_risk" || s.engagement === "dormant").length,
        documentsAwaitingReview: this.db.documents.filter(
          (d) => d.reviewStatus === "uploaded" || d.reviewStatus === "in_review",
        ).length,
        appointmentsNext7Days: this.db.appointments.filter((ap) => {
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

function nextAppointmentFor(
  db: SyntheticDatabase,
  clientId: string,
  now: Date,
): UpcomingAppointment | null {
  const next = db.appointments
    .filter((ap) => ap.clientId === clientId && new Date(ap.scheduledAt) > now)
    .sort((x, y) => x.scheduledAt.localeCompare(y.scheduledAt))[0];
  return next ? toUpcoming(db, next.id) : null;
}

function toUpcoming(db: SyntheticDatabase, appointmentId: string): UpcomingAppointment | null {
  const appointment = db.appointments.find((ap) => ap.id === appointmentId);
  if (!appointment) return null;
  const c = db.clients.find((x) => x.id === appointment.clientId);
  const s = db.staff.find((x) => x.id === appointment.staffId);
  if (!c) return null;
  return {
    appointment,
    clientId: c.id,
    clientName: fullName(c),
    staffName: s?.name ?? "Unassigned",
  };
}
