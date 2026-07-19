import { createHash } from "node:crypto";
import type { SyntheticDatabase } from "@aflo/shared";
import { clients, creditProfiles, financialProfiles, goals, organizations } from "../schema";
import type { OutboxDrizzleDb } from "./outbox";

/**
 * Deterministic UUID for a readable prototype id. The synthetic data uses
 * slugs (`org-golden-key`, `c-solomon`); the production columns are `uuid`.
 * Hashing gives a stable, valid UUID so every reference to the same slug maps
 * to the same uuid and relationships are preserved. `pipeline_stage_id` is a
 * text column and is NOT remapped. Exported so parity tests can resolve rows.
 */
export function slugToUuid(readableId: string): string {
  const hex = createHash("sha1").update(readableId).digest("hex");
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20, 32)}`;
}

/**
 * Materialize the CORE synthetic domain data into Postgres via Drizzle, in one
 * transaction and in foreign-key order. Credential-free (runs on PGlite), this
 * proves the Drizzle schema faithfully holds the real synthetic domain data —
 * the schema⟷domain fidelity check every future Neon-backed repository and
 * mock-vs-Postgres parity test builds on.
 *
 * Scope (this slice): organizations, clients, goals, financial_profiles,
 * credit_profiles. Explicitly DEFERRED to follow-ups so the loader stays small
 * and correct:
 *   - staff → users + organization_members (and therefore clients.assigned_member_id);
 *   - encrypted PII columns (clients.phone_encrypted / date_of_birth_encrypted),
 *     which require the app-layer encryption key, not a plaintext seed;
 *   - readiness_assessments and the remaining client-workflow tables.
 * The domain sub-records (financial/credit/goal) carry only client_id, so the
 * required organization_id is INJECTED from the owning client.
 */

export interface SeedLoadResult {
  organizations: number;
  clients: number;
  goals: number;
  financialProfiles: number;
  creditProfiles: number;
}

export async function loadSyntheticCore(db: OutboxDrizzleDb, seed: SyntheticDatabase): Promise<SeedLoadResult> {
  return db.transaction(async (tx) => {
    await tx.insert(organizations).values({
      id: slugToUuid(seed.organization.id),
      name: seed.organization.name,
      slug: seed.organization.slug,
    });

    if (seed.clients.length > 0) {
      await tx.insert(clients).values(
        seed.clients.map((c) => ({
          id: slugToUuid(c.id),
          organizationId: slugToUuid(c.organizationId),
          kind: c.kind,
          pipelineStageId: c.pipelineStageId, // text column — not remapped
          clientStatus: c.clientStatus,
          firstName: c.firstName,
          lastName: c.lastName,
          email: c.email,
          joinedAt: new Date(c.joinedAt),
          lastActivityAt: new Date(c.lastActivityAt),
          // Deferred: assignedMemberId (staff), userId, phone/DOB (encrypted PII).
        })),
      );
    }

    // Sub-records carry client_id only; the owning client supplies organization_id.
    const orgByClient = new Map(seed.clients.map((c) => [c.id, c.organizationId]));
    const orgFor = (clientId: string): string => {
      const org = orgByClient.get(clientId);
      if (!org) throw new Error(`loadSyntheticCore: no seeded client "${clientId}" for a child record`);
      return slugToUuid(org);
    };

    if (seed.goals.length > 0) {
      await tx.insert(goals).values(
        seed.goals.map((g) => ({
          id: slugToUuid(g.id),
          organizationId: orgFor(g.clientId),
          clientId: slugToUuid(g.clientId),
          title: g.title,
          category: g.category,
          // `date` column: store date-only (YYYY-MM-DD), so the write matches
          // the read-back instead of relying on Postgres truncating a datetime.
          targetDate: g.targetDate.slice(0, 10),
          progressPct: g.progressPct,
          isPrimary: g.isPrimary,
        })),
      );
    }

    if (seed.financialProfiles.length > 0) {
      await tx.insert(financialProfiles).values(
        seed.financialProfiles.map((f) => ({
          organizationId: orgFor(f.clientId),
          clientId: slugToUuid(f.clientId),
          monthlyIncomeCents: f.monthlyIncomeCents,
          monthlyDebtPaymentsCents: f.monthlyDebtPaymentsCents,
          liquidSavingsCents: f.liquidSavingsCents,
          monthlyEssentialExpensesCents: f.monthlyEssentialExpensesCents,
          incomeStability: f.incomeStability,
        })),
      );
    }

    if (seed.creditProfiles.length > 0) {
      await tx.insert(creditProfiles).values(
        seed.creditProfiles.map((c) => ({
          organizationId: orgFor(c.clientId),
          clientId: slugToUuid(c.clientId),
          score: c.score,
          scoreSource: c.scoreSource,
          // `date` column: date-only, null-safe (see targetDate above).
          scoreAsOf: c.scoreAsOf === null ? null : c.scoreAsOf.slice(0, 10),
          revolvingBalanceCents: c.revolvingBalanceCents,
          revolvingLimitCents: c.revolvingLimitCents,
          openTradelines: c.openTradelines,
          derogatoryMarks: c.derogatoryMarks,
          // numeric(4,3) round-trips as a decimal string in Drizzle.
          onTimePaymentRate: String(c.onTimePaymentRate),
        })),
      );
    }

    return {
      organizations: 1,
      clients: seed.clients.length,
      goals: seed.goals.length,
      financialProfiles: seed.financialProfiles.length,
      creditProfiles: seed.creditProfiles.length,
    };
  });
}
