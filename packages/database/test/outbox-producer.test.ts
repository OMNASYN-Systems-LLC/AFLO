import { readFileSync, readdirSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { PGlite } from "@electric-sql/pglite";
import { drizzle, type PgliteDatabase } from "drizzle-orm/pglite";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { createEvent, toOutboxRecord, type OutboxRecord } from "@aflo/shared";
import { clients, outbox } from "../src/schema";
import { commitWithOutbox, type OutboxDrizzleDb } from "../src/repositories/outbox";

/**
 * Transactional-outbox WRITE half (`commitWithOutbox`, ADR-0008) against PGlite.
 * Proves the core durability invariant credential-free: a domain state change
 * and the events it emits commit ATOMICALLY — both or neither. An event must
 * never be emitted for a change that rolled back, and a change must never commit
 * without its events.
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

const ORG = "00000000-0000-0000-0000-0000000000aa";
const T0 = new Date("2026-07-19T12:00:00.000Z");

function makeRecord(opts: { id: string; eventId: string }): OutboxRecord {
  const event = createEvent({
    eventType: "LeadCreated",
    organizationId: ORG,
    aggregateId: "lead-1",
    payload: { leadId: "lead-1", pipelineStatus: "new", source: null },
    eventId: opts.eventId,
    occurredAt: T0.toISOString(),
  });
  return toOutboxRecord(event, { now: T0, id: opts.id });
}

/** Insert a client on the given handle (the "state change" half of a unit of work). */
async function writeClient(tx: OutboxDrizzleDb, firstName: string) {
  await tx.insert(clients).values({
    organizationId: ORG,
    pipelineStageId: "stage-new",
    firstName,
    lastName: "Test",
  });
}

let client: PGlite;
let db: PgliteDatabase;

beforeAll(async () => {
  client = await PGlite.create();
  await client.exec(allMigrations());
  db = drizzle(client);
  // organizations is a global (non-RLS) table; seed the FK target once.
  await client.exec(`INSERT INTO organizations (id, name, slug) VALUES ('${ORG}', 'Org A', 'org-a');`);
});

beforeEach(async () => {
  // CASCADE: clients is referenced by intakes et al. (all empty in this suite).
  await client.exec("TRUNCATE outbox, clients CASCADE");
});

afterAll(async () => {
  await client.close();
});

async function countClients(): Promise<number> {
  return (await db.select().from(clients)).length;
}
async function countOutbox(): Promise<number> {
  return (await db.select().from(outbox)).length;
}

describe("commitWithOutbox — atomic state + events", () => {
  it("commits the state change and its events together", async () => {
    await commitWithOutbox(db, async (tx, enqueue) => {
      await writeClient(tx, "Ada");
      enqueue(makeRecord({ id: "11111111-1111-1111-1111-111111111111", eventId: "aaaaaaaa-0000-0000-0000-000000000001" }));
    });
    expect(await countClients()).toBe(1);
    expect(await countOutbox()).toBe(1);
  });

  it("rolls the WHOLE unit of work back when work throws — no state, no events", async () => {
    await expect(
      commitWithOutbox(db, async (tx, enqueue) => {
        await writeClient(tx, "Ada");
        enqueue(makeRecord({ id: "11111111-1111-1111-1111-111111111111", eventId: "aaaaaaaa-0000-0000-0000-000000000001" }));
        throw new Error("domain rule rejected the change");
      }),
    ).rejects.toThrow(/domain rule rejected/);
    // The event was never emitted for the change that rolled back...
    expect(await countOutbox()).toBe(0);
    // ...and the change never committed either.
    expect(await countClients()).toBe(0);
  });

  it("rolls the state change back when an outbox insert fails (event failure ⇒ no orphaned state)", async () => {
    // Two events sharing a primary-key id collide at flush (ON CONFLICT targets
    // event_id, not the pkey), so the second insert raises — and the client
    // written earlier in the same transaction must roll back with it.
    await expect(
      commitWithOutbox(db, async (tx, enqueue) => {
        await writeClient(tx, "Ada");
        enqueue(makeRecord({ id: "11111111-1111-1111-1111-111111111111", eventId: "aaaaaaaa-0000-0000-0000-000000000001" }));
        enqueue(makeRecord({ id: "11111111-1111-1111-1111-111111111111", eventId: "aaaaaaaa-0000-0000-0000-000000000002" }));
      }),
    ).rejects.toThrow();
    expect(await countClients()).toBe(0);
    expect(await countOutbox()).toBe(0);
  });

  it("is idempotent on event_id: re-emitting the same event within a new unit of work is a no-op", async () => {
    const rec = makeRecord({ id: "11111111-1111-1111-1111-111111111111", eventId: "aaaaaaaa-0000-0000-0000-000000000001" });
    await commitWithOutbox(db, async (tx, enqueue) => {
      await writeClient(tx, "Ada");
      enqueue(rec);
    });
    // A retried producer emits the same event_id (different row id) — no duplicate.
    await commitWithOutbox(db, async (tx, enqueue) => {
      await writeClient(tx, "Ada again");
      enqueue({ ...rec, id: "22222222-2222-2222-2222-222222222222" });
    });
    expect(await countOutbox()).toBe(1); // the duplicate event_id did not create a second outbox row
    expect(await countClients()).toBe(2); // but both state changes committed
  });
});
