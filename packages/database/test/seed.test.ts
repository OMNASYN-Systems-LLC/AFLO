import { readFileSync, readdirSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { PGlite } from "@electric-sql/pglite";
import { drizzle, type PgliteDatabase } from "drizzle-orm/pglite";
import { eq } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { syntheticDatabase } from "@aflo/shared";
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
    expect(row!.joinedAt.toISOString()).toBe(new Date(source.joinedAt).toISOString());
    // Deferred columns are null, not fabricated.
    expect(row!.assignedMemberId).toBeNull();
    expect(row!.phoneEncrypted).toBeNull();
  });

  it("round-trips financial cents exactly (bigint, no float drift)", async () => {
    const source = syntheticDatabase.financialProfiles[0]!;
    const [row] = await db.select().from(financialProfiles).where(eq(financialProfiles.clientId, slugToUuid(source.clientId)));
    expect(row!.monthlyIncomeCents).toBe(source.monthlyIncomeCents);
    expect(row!.liquidSavingsCents).toBe(source.liquidSavingsCents);
    expect(row!.monthlyEssentialExpensesCents).toBe(source.monthlyEssentialExpensesCents);
    expect(row!.incomeStability).toBe(source.incomeStability);
    expect(typeof row!.monthlyIncomeCents).toBe("number"); // bigint mode:number, not a string
  });

  it("round-trips a credit profile incl. the numeric on-time rate", async () => {
    const source = syntheticDatabase.creditProfiles[0]!;
    const [row] = await db.select().from(creditProfiles).where(eq(creditProfiles.clientId, slugToUuid(source.clientId)));
    expect(row!.score).toBe(source.score);
    expect(row!.scoreSource).toBe(source.scoreSource);
    expect(row!.revolvingBalanceCents).toBe(source.revolvingBalanceCents);
    expect(row!.openTradelines).toBe(source.openTradelines);
    // numeric(4,3) comes back as a decimal string; equal in value.
    expect(Number(row!.onTimePaymentRate)).toBeCloseTo(source.onTimePaymentRate, 3);
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
