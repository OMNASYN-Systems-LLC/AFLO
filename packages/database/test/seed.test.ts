import { readFileSync, readdirSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { PGlite } from "@electric-sql/pglite";
import { drizzle, type PgliteDatabase } from "drizzle-orm/pglite";
import { eq } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { syntheticDatabase, type SyntheticDatabase } from "@aflo/shared";
import { clients, creditProfiles, financialProfiles, goals, organizations } from "../src/schema";
import { loadSyntheticCore, slugToUuid } from "../src/repositories/seed";

/**
 * Schema⟷domain fidelity: the synthetic domain data materializes into the
 * Drizzle schema and reads back intact, credential-free (PGlite). This is the
 * foundation the Neon-backed repositories and mock-vs-Postgres parity tests
 * build on — if a column drifts from its domain field, this fails.
 */

const migrationsDir = join(dirname(fileURLToPath(import.meta.url)), "..", "migrations");

function allMigrations(): string {
  return readdirSync(migrationsDir)
    .filter((f) => f.endsWith(".sql"))
    .sort()
    .map((f) => readFileSync(join(migrationsDir, f), "utf8"))
    .join("\n")
    .replaceAll("--> statement-breakpoint", "");
}

let client: PGlite;
let db: PgliteDatabase;

beforeAll(async () => {
  client = await PGlite.create();
  await client.exec(allMigrations());
  db = drizzle(client);
  await loadSyntheticCore(db, syntheticDatabase);
});

afterAll(async () => {
  await client.close();
});

describe("loadSyntheticCore — schema⟷domain fidelity", () => {
  it("loads every core row (counts match the synthetic source)", async () => {
    expect(await db.select().from(organizations)).toHaveLength(1);
    expect(await db.select().from(clients)).toHaveLength(syntheticDatabase.clients.length);
    expect(await db.select().from(goals)).toHaveLength(syntheticDatabase.goals.length);
    expect(await db.select().from(financialProfiles)).toHaveLength(syntheticDatabase.financialProfiles.length);
    expect(await db.select().from(creditProfiles)).toHaveLength(syntheticDatabase.creditProfiles.length);
    // The synthetic data is non-trivial, so this is a real check, not 0 === 0.
    expect(syntheticDatabase.clients.length).toBeGreaterThan(0);
    expect(syntheticDatabase.goals.length).toBeGreaterThan(0);
  });

  it("round-trips a client's identifying fields intact (slug id remapped to uuid)", async () => {
    const source = syntheticDatabase.clients[0]!;
    const [row] = await db.select().from(clients).where(eq(clients.id, slugToUuid(source.id)));
    expect(row).toBeDefined();
    expect(row!.organizationId).toBe(slugToUuid(source.organizationId));
    expect(row!.kind).toBe(source.kind);
    expect(row!.pipelineStageId).toBe(source.pipelineStageId); // text — unchanged
    expect(row!.firstName).toBe(source.firstName);
    expect(row!.lastName).toBe(source.lastName);
    expect(row!.email).toBe(source.email);
    expect(row!.clientStatus).toBe(source.clientStatus);
    expect(row!.joinedAt.toISOString()).toBe(new Date(source.joinedAt).toISOString());
    expect(row!.lastActivityAt.toISOString()).toBe(new Date(source.lastActivityAt).toISOString());
    // Deferred columns are null, not fabricated.
    expect(row!.assignedMemberId).toBeNull();
    expect(row!.phoneEncrypted).toBeNull();
  });

  it("stores a lead's null clientStatus as null (not a fabricated default)", async () => {
    const lead = syntheticDatabase.clients.find((c) => c.kind === "lead");
    expect(lead, "synthetic data should include at least one lead").toBeDefined();
    expect(lead!.clientStatus).toBeNull(); // domain invariant: leads have no lifecycle status
    const [row] = await db.select().from(clients).where(eq(clients.id, slugToUuid(lead!.id)));
    expect(row!.kind).toBe("lead");
    expect(row!.clientStatus).toBeNull();
  });

  it("round-trips EVERY financial cents column exactly (bigint, no float drift)", async () => {
    const source = syntheticDatabase.financialProfiles[0]!;
    const [row] = await db.select().from(financialProfiles).where(eq(financialProfiles.clientId, slugToUuid(source.clientId)));
    expect(row!.monthlyIncomeCents).toBe(source.monthlyIncomeCents);
    expect(row!.monthlyDebtPaymentsCents).toBe(source.monthlyDebtPaymentsCents);
    expect(row!.liquidSavingsCents).toBe(source.liquidSavingsCents);
    expect(row!.monthlyEssentialExpensesCents).toBe(source.monthlyEssentialExpensesCents);
    expect(row!.incomeStability).toBe(source.incomeStability);
    expect(typeof row!.monthlyIncomeCents).toBe("number"); // bigint mode:number, not a string
  });

  it("round-trips EVERY credit column incl. numeric rate and date-only scoreAsOf", async () => {
    const source = syntheticDatabase.creditProfiles[0]!;
    const [row] = await db.select().from(creditProfiles).where(eq(creditProfiles.clientId, slugToUuid(source.clientId)));
    expect(row!.score).toBe(source.score);
    expect(row!.scoreSource).toBe(source.scoreSource);
    expect(row!.revolvingBalanceCents).toBe(source.revolvingBalanceCents);
    expect(row!.revolvingLimitCents).toBe(source.revolvingLimitCents);
    expect(row!.openTradelines).toBe(source.openTradelines);
    expect(row!.derogatoryMarks).toBe(source.derogatoryMarks);
    // `date` column stores date-only, matching the write (Finding 1 fix).
    expect(row!.scoreAsOf).toBe(source.scoreAsOf === null ? null : source.scoreAsOf.slice(0, 10));
    // numeric(4,3) comes back as a decimal string; equal in value.
    expect(Number(row!.onTimePaymentRate)).toBeCloseTo(source.onTimePaymentRate, 3);
  });

  it("stores goal target_date as date-only (no silent datetime truncation)", async () => {
    const g = syntheticDatabase.goals[0]!;
    const [row] = await db.select().from(goals).where(eq(goals.id, slugToUuid(g.id)));
    expect(row!.targetDate).toBe(g.targetDate.slice(0, 10));
    expect(row!.targetDate).toMatch(/^\d{4}-\d{2}-\d{2}$/);
  });

  it("INJECTS organization_id into sub-records from the owning client", async () => {
    // Goals/profiles have no organizationId in the domain; the loader supplies
    // it from the client, and it must equal that client's org.
    const g = syntheticDatabase.goals[0]!;
    const [goalRow] = await db.select().from(goals).where(eq(goals.id, slugToUuid(g.id)));
    const [clientRow] = await db.select().from(clients).where(eq(clients.id, slugToUuid(g.clientId)));
    expect(goalRow!.organizationId).toBe(clientRow!.organizationId);
    expect(goalRow!.isPrimary).toBe(g.isPrimary);
    expect(goalRow!.progressPct).toBe(g.progressPct);
  });

  it("maps distinct slugs to distinct, stable uuids (referential integrity preserved)", () => {
    expect(slugToUuid("c-solomon")).toBe(slugToUuid("c-solomon")); // stable
    expect(slugToUuid("c-solomon")).not.toBe(slugToUuid("c-bell")); // distinct
    expect(slugToUuid("org-golden-key")).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/);
  });

  it("preserves the at-most-one-primary-goal invariant per client", async () => {
    const all = await db.select().from(goals);
    const primaryByClient = new Map<string, number>();
    for (const row of all.filter((r) => r.isPrimary)) {
      primaryByClient.set(row.clientId, (primaryByClient.get(row.clientId) ?? 0) + 1);
    }
    for (const count of primaryByClient.values()) expect(count).toBe(1);
  });
});

describe("loadSyntheticCore — nullable passthrough", () => {
  // The real synthetic data has no null credit scores; construct one so the
  // loader's null-passthrough path (score / scoreAsOf) is actually exercised.
  it("passes a null credit score and null scoreAsOf through as null", async () => {
    const isolated = await PGlite.create();
    try {
      await isolated.exec(allMigrations());
      const db2 = drizzle(isolated);
      const anchor = syntheticDatabase.creditProfiles[0]!;
      const modified: SyntheticDatabase = {
        ...syntheticDatabase,
        creditProfiles: [{ ...anchor, score: null, scoreAsOf: null }],
      };
      await loadSyntheticCore(db2, modified);
      const [row] = await db2.select().from(creditProfiles).where(eq(creditProfiles.clientId, slugToUuid(anchor.clientId)));
      expect(row!.score).toBeNull();
      expect(row!.scoreAsOf).toBeNull();
      expect(row!.revolvingBalanceCents).toBe(anchor.revolvingBalanceCents); // non-null neighbours intact
    } finally {
      await isolated.close();
    }
  });
});
