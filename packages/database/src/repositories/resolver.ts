import { and, eq, gt, isNull, or, sql } from "drizzle-orm";
import type { PgDatabase, PgQueryResultHKT } from "drizzle-orm/pg-core";
import type {
  IdentityAccountRepository,
  IdentityProvider,
  IdentityProviderAccountRecord,
  RecordedWebhookEvent,
  RevokeSessionsInput,
  SessionRevocationRepository,
  WebhookEventRepository,
  WebhookReceiptResult,
} from "@aflo/auth";
import { identityProviderAccounts, providerWebhookEvents, sessionRevocations } from "../schema";

/**
 * PostgreSQL repositories for the three UN-scoped auth tables, behind the
 * @aflo/auth resolver contracts. They run on the **resolver connection** (the
 * least-privileged resolver role — migration 0007) and do NOT use
 * `withOrgContext`: these rows are read before/across an org context, and the
 * tables carry no org-RLS. The privilege boundary (a tenant role cannot touch
 * these tables) is enforced by the migration-0007 grant matrix, proven in
 * `resolver-grant-matrix.test.ts`.
 *
 * Secrets are digests only. `session_revocations` reads are USER-SCOPED
 * (`WHERE user_id = …`), never table-wide (ADR-0026/0030).
 */
/**
 * The privileged resolver-role handle. Branded (phantom `__dbRole`) so a
 * BRANDED tenant handle cannot be passed where the resolver connection is
 * required (and vice versa) — the ADR-0030 privilege split is compile-checked.
 * Unbranded handles (PGlite in tests) still assign freely.
 */
export type ResolverDb = PgDatabase<PgQueryResultHKT> & { readonly __dbRole?: "resolver" };

type IdentityRow = typeof identityProviderAccounts.$inferSelect;
type WebhookRow = typeof providerWebhookEvents.$inferSelect;

function toIdentity(row: IdentityRow): IdentityProviderAccountRecord {
  return {
    id: row.id,
    provider: row.provider as IdentityProvider,
    providerUserId: row.providerUserId,
    afloUserId: row.afloUserId,
  };
}

function toWebhook(row: WebhookRow): RecordedWebhookEvent {
  return {
    id: row.id,
    provider: row.provider as IdentityProvider,
    providerEventId: row.providerEventId,
    eventType: row.eventType,
    status: row.status as RecordedWebhookEvent["status"],
    attempts: row.attempts,
  };
}

export class DrizzleIdentityAccountRepository implements IdentityAccountRepository {
  constructor(private readonly db: ResolverDb) {}

  async findByProvider(
    provider: IdentityProvider,
    providerUserId: string,
  ): Promise<IdentityProviderAccountRecord | null> {
    const rows = await this.db
      .select()
      .from(identityProviderAccounts)
      .where(
        and(
          eq(identityProviderAccounts.provider, provider),
          eq(identityProviderAccounts.providerUserId, providerUserId),
        ),
      )
      .limit(1);
    return rows[0] ? toIdentity(rows[0]) : null;
  }

  async link(
    provider: IdentityProvider,
    providerUserId: string,
    afloUserId: string,
    now: Date,
  ): Promise<IdentityProviderAccountRecord> {
    const inserted = await this.db
      .insert(identityProviderAccounts)
      .values({ provider, providerUserId, afloUserId, createdAt: now, updatedAt: now })
      .onConflictDoNothing({
        target: [identityProviderAccounts.provider, identityProviderAccounts.providerUserId],
      })
      .returning();
    if (inserted[0]) return toIdentity(inserted[0]);
    // Already linked — a no-op; return the existing mapping.
    const existing = await this.findByProvider(provider, providerUserId);
    if (!existing) throw new Error("identity link conflict but no existing row"); // unreachable
    return existing;
  }
}

export class DrizzleWebhookEventRepository implements WebhookEventRepository {
  constructor(private readonly db: ResolverDb) {}

  async recordReceipt(
    provider: IdentityProvider,
    providerEventId: string,
    eventType: string,
    payloadDigest: string,
    now: Date,
  ): Promise<WebhookReceiptResult> {
    const inserted = await this.db
      .insert(providerWebhookEvents)
      .values({
        provider,
        providerEventId,
        eventType,
        payloadDigest,
        receivedAt: now,
        status: "received",
        createdAt: now,
        updatedAt: now,
      })
      .onConflictDoNothing({
        target: [providerWebhookEvents.provider, providerWebhookEvents.providerEventId],
      })
      .returning();
    if (inserted[0]) return { isNew: true, record: toWebhook(inserted[0]) };
    // Redelivery: the (provider, providerEventId) is already recorded.
    const existing = await this.db
      .select()
      .from(providerWebhookEvents)
      .where(
        and(
          eq(providerWebhookEvents.provider, provider),
          eq(providerWebhookEvents.providerEventId, providerEventId),
        ),
      )
      .limit(1);
    if (!existing[0]) throw new Error("webhook receipt conflict but no existing row"); // unreachable
    return { isNew: false, record: toWebhook(existing[0]) };
  }

  async markProcessed(id: string, now: Date): Promise<void> {
    await this.db
      .update(providerWebhookEvents)
      .set({ status: "processed", processedAt: now, updatedAt: now })
      .where(eq(providerWebhookEvents.id, id));
  }

  async markFailed(id: string, now: Date, errorCode: string): Promise<void> {
    await this.db
      .update(providerWebhookEvents)
      .set({
        status: "failed",
        attempts: sql`${providerWebhookEvents.attempts} + 1`,
        lastErrorCode: errorCode,
        updatedAt: now,
      })
      .where(eq(providerWebhookEvents.id, id));
  }
}

export class DrizzleSessionRevocationRepository implements SessionRevocationRepository {
  constructor(private readonly db: ResolverDb) {}

  async revoke(input: RevokeSessionsInput, now: Date): Promise<void> {
    await this.db.insert(sessionRevocations).values({
      userId: input.userId,
      organizationId: input.organizationId ?? null,
      providerSessionIdDigest: input.providerSessionIdDigest ?? null,
      reasonCode: input.reasonCode,
      revokedAt: now,
      expiresAt: input.expiresAt ?? null,
      createdByUserId: input.revokedByUserId ?? null,
      createdAt: now,
    });
  }

  async isSessionRevoked(
    userId: string,
    sessionIssuedAt: Date,
    providerSessionIdDigest: string | null,
    now: Date,
  ): Promise<boolean> {
    // USER-SCOPED: never a table-wide scan. A revocation applies when it was
    // recorded after the session was issued, targets this session (null digest =
    // all sessions, or an exact match), and has not expired.
    const rows = await this.db
      .select({ id: sessionRevocations.id })
      .from(sessionRevocations)
      .where(
        and(
          eq(sessionRevocations.userId, userId),
          gt(sessionRevocations.revokedAt, sessionIssuedAt),
          or(
            isNull(sessionRevocations.providerSessionIdDigest),
            providerSessionIdDigest === null
              ? sql`false`
              : eq(sessionRevocations.providerSessionIdDigest, providerSessionIdDigest),
          ),
          or(isNull(sessionRevocations.expiresAt), gt(sessionRevocations.expiresAt, now)),
        ),
      )
      .limit(1);
    return rows.length > 0;
  }
}
