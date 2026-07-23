import { and, asc, desc, eq } from "drizzle-orm";
import {
  canActOnPlaybookVersion,
  contentBlocksApproval,
  isHighImpactPlaybookContent,
  playbookVersionTransition,
  validatePlaybookContent,
  workflowDiscoveryTransition,
  type PlaybookAction,
  type PlaybookContent,
  type PlaybookContentFieldKey,
  type PlaybookOwnerOverride,
  type PlaybookReasonCode,
  type PlaybookVersionStatus,
  type ReviewArtifactType,
  type ReviewDecision,
  type ReviewItemState,
  type ReviewRiskClass,
  type ReviewerRole,
  type WorkflowDiscoveryReasonCode,
  type WorkflowDiscoveryStatus,
} from "@aflo/rules";
import { reviewerRoleForMemberRole, type PlaybookVersionReviewEvent } from "@aflo/shared";
import {
  aiRuns,
  clients,
  organizationMembers,
  organizations,
  playbookVersions,
  playbooks,
  reviewDecisions,
  reviewItems,
  workflowDiscoveryItems,
} from "../schema";
import { withOrgContext, type TenantScopedDb } from "../request-context";

/**
 * PostgreSQL repositories for the Human Review Center, Professional Playbooks,
 * and Workflow Discovery tables (migration 0009, ADR-0041). Every operation
 * runs inside `withOrgContext` (ADR-0025), so RLS scopes it to exactly one
 * organization on a transaction-local GUC.
 *
 * DIVISION OF AUTHORITY (the store-contract idiom):
 *  - LEGALITY of a ReviewItem state move is decided by the review_center
 *    kernel IN THE CALLER (store, PR-5). `saveTransition` PERSISTS a
 *    kernel-approved transition plus its bookkeeping — it never re-decides.
 *  - CROSS-ORG REFERENCE GUARD: FK validation bypasses RLS, so EVERY
 *    caller-supplied reference into another table (client, playbook, playbook
 *    version, review item, organization member, ai_run) is verified visible
 *    via a one-row SELECT inside the SAME `withOrgContext` transaction before
 *    it is written. A foreign org's id fails with a typed not-visible error
 *    (never echoing foreign data) and no row is written.
 *  - `recordDecisionAndTransition` is THE store entry point for review
 *    decisions (PR-5 must use it): it appends the `review_decisions` row AND
 *    moves the `review_items` head in ONE transaction, so the denormalized
 *    head can never drift from the append-only log. `append`/`saveTransition`
 *    remain for the non-decision paths (submission, withdrawal, supersession,
 *    publish; log backfill).
 *  - `submitted_at` stamps ONLY on the FIRST entry into `awaiting_review` —
 *    an escalation (same-state persist with the reviewer floor raised via
 *    patch) leaves the review-time metric anchor untouched.
 *  - Playbook-version legality AND actor authority ARE enforced here
 *    (`transitionVersion` consults `playbookVersionTransition`,
 *    `canActOnPlaybookVersion`, and `contentBlocksApproval` — ADR-0047 closes
 *    the ADR-0043 known gap), because publish/supersede/current-head must be
 *    one atomic unit and this is the single write path for versions — the
 *    ADR-0038 enforcement boundary made real: a version with any
 *    `discovery_required` field can NEVER be approved or published, so
 *    invented process can never become doctrine; and the founder's
 *    author/approver separation (decision 2026-07-23 #2) holds durably, with
 *    every executed transition appended to the version's `review_history`.
 *  - `review_decisions` is APPEND-ONLY: this module deliberately exposes no
 *    update or delete for decisions — the feedback log cannot be rewritten.
 *
 * DATA GOVERNANCE (founder directive 2026-07-20): review-feedback data is
 * used ONLY for analytics, rule improvement, prompt improvement, workflow
 * improvement, and QA — NEVER for uncontrolled model training.
 *
 * The handle is driver-agnostic (PGlite in tests, node-postgres/Neon in prod).
 */

// --- Typed errors -----------------------------------------------------------

/** Thrown when a review item id is unknown or belongs to another org (RLS-invisible). */
export class ReviewItemNotFoundError extends Error {
  constructor(public readonly reviewItemId: string) {
    super(`review item not found: ${reviewItemId}`);
    this.name = "ReviewItemNotFoundError";
  }
}

/**
 * Thrown when the org-scoped 5-tuple (artifact_type, artifact_id,
 * artifact_version, workflow_type) already has an OPEN review item
 * (uq_review_items_open, migration 0010).
 */
export class OpenReviewItemExistsError extends Error {
  constructor(
    public readonly artifactType: string,
    public readonly artifactId: string,
    public readonly artifactVersion: string,
    public readonly workflowType: string,
  ) {
    super(
      `artifact already has an open review item: ${artifactType}/${artifactId}@${artifactVersion} (${workflowType})`,
    );
    this.name = "OpenReviewItemExistsError";
  }
}

/**
 * Thrown when publication is attempted against a CHANGED artifact (founder
 * invariant, verbatim: "review references artifact version and digest →
 * artifact changes → review becomes stale → prior approval cannot publish
 * changed content → new review required"). Also thrown fail-closed when the
 * caller omits the current version/digest — publication without the staleness
 * check does not exist. The correct path is supersession + a fresh ReviewItem
 * for the new artifact version.
 */
export class StaleReviewItemError extends Error {
  constructor(
    public readonly reviewItemId: string,
    public readonly stored: { artifactVersion: string; artifactDigest: string },
    public readonly current: { artifactVersion: string | null; artifactDigest: string | null },
  ) {
    super(
      `review item is stale — artifact changed since review: ${reviewItemId} ` +
        `(reviewed ${stored.artifactVersion}/${stored.artifactDigest.slice(0, 12)}…, ` +
        `current ${current.artifactVersion ?? "<missing>"}/${(current.artifactDigest ?? "<missing>").slice(0, 12)}…)`,
    );
    this.name = "StaleReviewItemError";
  }
}

/** Thrown when `create` receives a malformed artifact version or digest. */
export class InvalidReviewArtifactRefError extends Error {
  constructor(public readonly reason: "empty_artifact_version" | "invalid_artifact_digest") {
    super(`invalid review artifact reference: ${reason}`);
    this.name = "InvalidReviewArtifactRefError";
  }
}

/** Thrown when a referenced client is not in the current org (FK bypasses RLS — guard here). */
export class ReviewClientNotInOrganizationError extends Error {
  constructor(public readonly clientId: string) {
    super(`client not found in organization: ${clientId}`);
    this.name = "ReviewClientNotInOrganizationError";
  }
}

/** Thrown when a referenced organization member is not in the current org (FK bypasses RLS — guard here). */
export class MemberNotInOrganizationError extends Error {
  constructor(public readonly memberId: string) {
    super(`member not found in organization: ${memberId}`);
    this.name = "MemberNotInOrganizationError";
  }
}

/** Thrown when a referenced ai_run is not in the current org (FK bypasses RLS — guard here). */
export class AiRunNotInOrganizationError extends Error {
  constructor(public readonly aiRunId: string) {
    super(`ai run not found in organization: ${aiRunId}`);
    this.name = "AiRunNotInOrganizationError";
  }
}

/** Thrown when `create` receives a runtime state outside the two legal birth states (F4). */
export class InvalidInitialReviewStateError extends Error {
  constructor(public readonly state: string) {
    super(`invalid initial review item state: ${state}`);
    this.name = "InvalidInitialReviewStateError";
  }
}

/** Thrown when a playbook id/key is unknown or belongs to another org. */
export class PlaybookNotFoundError extends Error {
  constructor(public readonly playbookRef: string) {
    super(`playbook not found: ${playbookRef}`);
    this.name = "PlaybookNotFoundError";
  }
}

/** Thrown when a playbook version id is unknown or belongs to another org. */
export class PlaybookVersionNotFoundError extends Error {
  constructor(public readonly versionId: string) {
    super(`playbook version not found: ${versionId}`);
    this.name = "PlaybookVersionNotFoundError";
  }
}

/** Thrown when (organization_id, playbook_key) already exists. */
export class PlaybookKeyExistsError extends Error {
  constructor(public readonly playbookKey: string) {
    super(`playbook key already exists in organization: ${playbookKey}`);
    this.name = "PlaybookKeyExistsError";
  }
}

/** Thrown when (playbook_id, version) already exists. */
export class PlaybookVersionExistsError extends Error {
  constructor(
    public readonly playbookId: string,
    public readonly version: string,
  ) {
    super(`playbook version already exists: ${playbookId}@${version}`);
    this.name = "PlaybookVersionExistsError";
  }
}

/** Thrown when `validatePlaybookContent` rejects a draft's content (structural errors). */
export class InvalidPlaybookContentError extends Error {
  constructor(public readonly errors: readonly string[]) {
    super(`invalid playbook content: ${errors.join("; ")}`);
    this.name = "InvalidPlaybookContentError";
  }
}

/** Thrown when the playbook.v1.0.0 kernel denies a version transition. */
export class PlaybookTransitionDeniedError extends Error {
  constructor(
    public readonly reasonCode: PlaybookReasonCode,
    public readonly fromStatus: string,
    public readonly toStatus: string,
  ) {
    super(`playbook version transition denied (${reasonCode}): ${fromStatus} → ${toStatus}`);
    this.name = "PlaybookTransitionDeniedError";
  }
}

/**
 * Thrown when the founder's actor policy (decision 2026-07-23 #2, enforced via
 * `canActOnPlaybookVersion` and the reviewer-decision floors) DENIES the acting
 * member the attempted playbook action. Nothing is written (ADR-0047).
 */
export class PlaybookActionDeniedError extends Error {
  constructor(
    public readonly reasonCode: PlaybookReasonCode,
    public readonly action: PlaybookGovernedAction,
    public readonly actorMemberId: string,
  ) {
    super(`playbook action denied (${reasonCode}): ${action} by member ${actorMemberId}`);
    this.name = "PlaybookActionDeniedError";
  }
}

/**
 * Thrown when a caller targets `superseded` directly. Supersession happens
 * ONLY through publishing a newer version (the store-parity rule, ADR-0043/
 * ADR-0047) — there is no direct un-publish surface.
 */
export class PlaybookDirectSupersessionError extends Error {
  constructor(public readonly versionId: string) {
    super(`direct supersession is not a transition surface (version ${versionId}) — publish a newer version instead`);
    this.name = "PlaybookDirectSupersessionError";
  }
}

/**
 * Thrown when a stored `review_history` value is not the append-only array
 * this module always writes (corruption tripwire — fail closed, write nothing)
 * or when an append did not extend the array by exactly one entry.
 */
export class PlaybookReviewHistoryCorruptionError extends Error {
  constructor(
    public readonly versionId: string,
    public readonly reason: "not_an_array" | "append_length_mismatch",
  ) {
    super(`playbook review history integrity violation (${reason}): version ${versionId}`);
    this.name = "PlaybookReviewHistoryCorruptionError";
  }
}

/**
 * Thrown when approval/publication is DENIED because content still carries
 * `discovery_required` fields (`contentBlocksApproval` non-empty) — the
 * anti-invention control: an unresolved question about the founder's actual
 * process can never be presented to staff as settled doctrine (ADR-0038).
 */
export class PlaybookApprovalBlockedError extends Error {
  constructor(public readonly blockedFields: readonly PlaybookContentFieldKey[]) {
    super(`playbook approval blocked by discovery_required fields: ${blockedFields.join(", ")}`);
    this.name = "PlaybookApprovalBlockedError";
  }
}

/** Thrown when a workflow-discovery item id is unknown or belongs to another org. */
export class WorkflowDiscoveryNotFoundError extends Error {
  constructor(public readonly itemId: string) {
    super(`workflow discovery item not found: ${itemId}`);
    this.name = "WorkflowDiscoveryNotFoundError";
  }
}

/** Thrown when the playbook.v1.0.0 discovery machine denies a transition. */
export class WorkflowDiscoveryTransitionDeniedError extends Error {
  constructor(
    public readonly reasonCode: WorkflowDiscoveryReasonCode,
    public readonly fromStatus: string,
    public readonly toStatus: string,
  ) {
    super(`workflow discovery transition denied (${reasonCode}): ${fromStatus} → ${toStatus}`);
    this.name = "WorkflowDiscoveryTransitionDeniedError";
  }
}

/** Thrown when a discovery transition lacks its required bookkeeping input. */
export class WorkflowDiscoveryInputError extends Error {
  constructor(public readonly reason: "missing_answer" | "missing_converted_version") {
    super(`workflow discovery transition input error: ${reason}`);
    this.name = "WorkflowDiscoveryInputError";
  }
}

// --- Shared helpers ---------------------------------------------------------

/**
 * Postgres unique-violation (SQLSTATE 23505) detector. Drizzle wraps the driver
 * error and attaches the original (which carries `code`) as `.cause`, so
 * inspect BOTH the error and its cause, by code and by message (node-postgres
 * and PGlite differ in shape) — the invitation-repository idiom.
 */
function isUniqueViolation(err: unknown): boolean {
  for (const candidate of [err, (err as { cause?: unknown } | null)?.cause]) {
    if (!candidate) continue;
    if ((candidate as { code?: string }).code === "23505") return true;
    const message = candidate instanceof Error ? candidate.message : String(candidate);
    if (/duplicate key|unique constraint|23505/i.test(message)) return true;
  }
  return false;
}

/** Verify `clientId` is visible under the current org context (RLS-scoped). */
async function assertClientInOrg(tx: TenantScopedDb, clientId: string): Promise<void> {
  const rows = await tx.select({ id: clients.id }).from(clients).where(eq(clients.id, clientId)).limit(1);
  if (!rows[0]) throw new ReviewClientNotInOrganizationError(clientId);
}

/** Verify `memberId` is an organization member visible under the current org context (RLS-scoped). */
async function assertMemberInOrg(tx: TenantScopedDb, memberId: string): Promise<void> {
  const rows = await tx
    .select({ id: organizationMembers.id })
    .from(organizationMembers)
    .where(eq(organizationMembers.id, memberId))
    .limit(1);
  if (!rows[0]) throw new MemberNotInOrganizationError(memberId);
}

/** Verify `aiRunId` is visible under the current org context (ai_runs is org-scoped + RLS'd). */
async function assertAiRunInOrg(tx: TenantScopedDb, aiRunId: string): Promise<void> {
  const rows = await tx.select({ id: aiRuns.id }).from(aiRuns).where(eq(aiRuns.id, aiRunId)).limit(1);
  if (!rows[0]) throw new AiRunNotInOrganizationError(aiRunId);
}

/** Verify `playbookId` is visible under the current org context (RLS-scoped). */
async function assertPlaybookInOrg(tx: TenantScopedDb, playbookId: string): Promise<void> {
  const rows = await tx
    .select({ id: playbooks.id })
    .from(playbooks)
    .where(eq(playbooks.id, playbookId))
    .limit(1);
  if (!rows[0]) throw new PlaybookNotFoundError(playbookId);
}

/** Verify `reviewItemId` is visible under the current org context (RLS-scoped). */
async function assertReviewItemInOrg(tx: TenantScopedDb, reviewItemId: string): Promise<void> {
  const rows = await tx
    .select({ id: reviewItems.id })
    .from(reviewItems)
    .where(eq(reviewItems.id, reviewItemId))
    .limit(1);
  if (!rows[0]) throw new ReviewItemNotFoundError(reviewItemId);
}

function isoOrNull(value: Date | null): string | null {
  return value === null ? null : value.toISOString();
}

/** sha256 hex digest shape: exactly 64 lowercase hex characters. */
const SHA256_HEX = /^[0-9a-f]{64}$/;

// --- Review items -----------------------------------------------------------

/** A source-fact reference: identifier + freshness timestamp ONLY, never a value. */
export interface SourceFactSnapshot {
  factId: string;
  asOf: string;
}

/** One recorded field modification — digests only, never content. */
export interface ModificationDigest {
  field: string;
  beforeSha256: string;
  afterSha256: string;
}

export interface ReviewItemRecord {
  id: string;
  organizationId: string;
  clientId: string | null;
  artifactType: ReviewArtifactType;
  artifactId: string;
  artifactVersion: string;
  /** sha256 hex digest of the reviewed artifact content — digest only, never the body. */
  artifactDigest: string;
  workflowType: ReviewArtifactType;
  sourceFactSnapshots: SourceFactSnapshot[];
  ruleVersionsUsed: string[];
  aiRunId: string | null;
  aiModel: string | null;
  aiPromptVersion: string | null;
  /** Numeric string ("0.850") or null for deterministic/manual artifacts. */
  confidence: string | null;
  riskClassification: ReviewRiskClass;
  requiredReviewerRole: ReviewerRole;
  state: ReviewItemState;
  assignedReviewerMemberId: string | null;
  reviewedByMemberId: string | null;
  reviewedAt: string | null;
  latestDecision: ReviewDecision | null;
  latestDecisionReasonCode: string | null;
  modificationsDigest: ModificationDigest[];
  publishedResultRef: string | null;
  publishedAt: string | null;
  playbookId: string | null;
  playbookVersion: string | null;
  previousReviewItemId: string | null;
  supersededByReviewItemId: string | null;
  clientActionRef: string | null;
  clientActionStatus: string | null;
  outcome: string | null;
  outcomeRecordedAt: string | null;
  createdByMemberId: string | null;
  submittedAt: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface CreateReviewItemInput {
  clientId?: string | null;
  artifactType: ReviewArtifactType;
  artifactId: string;
  /** REQUIRED (migration 0010): the reviewed artifact version — non-empty trimmed. */
  artifactVersion: string;
  /** REQUIRED (migration 0010): sha256 hex digest of the reviewed content (64 lowercase hex). */
  artifactDigest: string;
  /**
   * The workflow this review belongs to (founder 5-tuple). Defaults to
   * `artifactType` here at the call-site type level — never silently in SQL.
   */
  workflowType?: ReviewArtifactType;
  sourceFactSnapshots?: SourceFactSnapshot[];
  ruleVersionsUsed?: string[];
  aiRunId?: string | null;
  aiModel?: string | null;
  aiPromptVersion?: string | null;
  confidence?: string | null;
  riskClassification: ReviewRiskClass;
  requiredReviewerRole: ReviewerRole;
  /**
   * Initial state: `draft` (default) for staff-authored artifacts, or
   * `awaiting_review` for gated AI output landing directly in the queue
   * (design brief §3) — never any later state.
   */
  state?: "draft" | "awaiting_review";
  playbookId?: string | null;
  playbookVersion?: string | null;
  previousReviewItemId?: string | null;
  /** Null = orchestrator/system-created. */
  createdByMemberId?: string | null;
}

/** Bookkeeping accompanying a kernel-approved transition (all optional). */
export interface ReviewItemTransitionPatch {
  reviewedByMemberId?: string | null;
  latestDecision?: ReviewDecision;
  latestDecisionReasonCode?: string;
  modificationsDigest?: ModificationDigest[];
  publishedResultRef?: string;
  supersededByReviewItemId?: string;
  /** The raised floor an allowed `escalated` decision carries (state stays awaiting_review). */
  requiredReviewerRole?: ReviewerRole;
  /**
   * REQUIRED when toState = "published" (stale-artifact invariant): the
   * artifact's CURRENT version, compared against the reviewed one. Mismatch
   * or omission → `StaleReviewItemError`; the item is NOT published.
   */
  currentArtifactVersion?: string;
  /** REQUIRED when toState = "published": the artifact's CURRENT sha256 digest. */
  currentArtifactDigest?: string;
}

export interface ListReviewItemsFilter {
  state?: ReviewItemState;
  artifactType?: ReviewArtifactType;
}

type ReviewItemRow = typeof reviewItems.$inferSelect;

function toReviewItem(row: ReviewItemRow): ReviewItemRecord {
  return {
    id: row.id,
    organizationId: row.organizationId,
    clientId: row.clientId,
    // The tuple() enum helper widens pgEnum columns to string — narrow back to
    // the kernel unions here (the messaging-repository idiom).
    artifactType: row.artifactType as ReviewArtifactType,
    artifactId: row.artifactId,
    artifactVersion: row.artifactVersion,
    artifactDigest: row.artifactDigest,
    workflowType: row.workflowType as ReviewArtifactType,
    sourceFactSnapshots: row.sourceFactSnapshots as SourceFactSnapshot[],
    ruleVersionsUsed: row.ruleVersionsUsed as string[],
    aiRunId: row.aiRunId,
    aiModel: row.aiModel,
    aiPromptVersion: row.aiPromptVersion,
    confidence: row.confidence,
    riskClassification: row.riskClassification as ReviewRiskClass,
    requiredReviewerRole: row.requiredReviewerRole as ReviewerRole,
    state: row.state as ReviewItemState,
    assignedReviewerMemberId: row.assignedReviewerMemberId,
    reviewedByMemberId: row.reviewedByMemberId,
    reviewedAt: isoOrNull(row.reviewedAt),
    latestDecision: row.latestDecision as ReviewDecision | null,
    latestDecisionReasonCode: row.latestDecisionReasonCode,
    modificationsDigest: row.modificationsDigest as ModificationDigest[],
    publishedResultRef: row.publishedResultRef,
    publishedAt: isoOrNull(row.publishedAt),
    playbookId: row.playbookId,
    playbookVersion: row.playbookVersion,
    previousReviewItemId: row.previousReviewItemId,
    supersededByReviewItemId: row.supersededByReviewItemId,
    clientActionRef: row.clientActionRef,
    clientActionStatus: row.clientActionStatus,
    outcome: row.outcome,
    outcomeRecordedAt: isoOrNull(row.outcomeRecordedAt),
    createdByMemberId: row.createdByMemberId,
    submittedAt: isoOrNull(row.submittedAt),
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  };
}

export class DrizzleReviewItemRepository {
  constructor(private readonly db: TenantScopedDb) {}

  /**
   * Create a review item in `draft` (or directly in `awaiting_review` for
   * gated AI output). A second OPEN item for the same artifact violates
   * uq_review_items_open and surfaces as OpenReviewItemExistsError —
   * replacements supersede, they never coexist.
   */
  async create(organizationId: string, input: CreateReviewItemInput, now: Date): Promise<ReviewItemRecord> {
    const state = input.state ?? "draft";
    // F4: the TS union allows only the two birth states — enforce at RUNTIME
    // too, so a cast can never mint an item directly in a later state.
    if (state !== "draft" && state !== "awaiting_review") {
      throw new InvalidInitialReviewStateError(state);
    }
    // Migration-0010 requirements: a non-empty trimmed artifact version and a
    // well-formed sha256 hex digest — the stale-artifact invariant's anchors.
    const artifactVersion = input.artifactVersion?.trim() ?? "";
    if (artifactVersion.length === 0) throw new InvalidReviewArtifactRefError("empty_artifact_version");
    if (typeof input.artifactDigest !== "string" || !SHA256_HEX.test(input.artifactDigest)) {
      throw new InvalidReviewArtifactRefError("invalid_artifact_digest");
    }
    // Call-site-level default only — never silently in SQL.
    const workflowType = input.workflowType ?? input.artifactType;
    return withOrgContext(this.db, organizationId, async (tx) => {
      // FK validation bypasses RLS — every caller-supplied cross-table
      // reference must be verified visible in THIS org before it is written.
      if (input.clientId != null) await assertClientInOrg(tx, input.clientId);
      if (input.playbookId != null) await assertPlaybookInOrg(tx, input.playbookId);
      if (input.previousReviewItemId != null) await assertReviewItemInOrg(tx, input.previousReviewItemId);
      if (input.aiRunId != null) await assertAiRunInOrg(tx, input.aiRunId);
      if (input.createdByMemberId != null) await assertMemberInOrg(tx, input.createdByMemberId);
      try {
        const inserted = await tx
          .insert(reviewItems)
          .values({
            organizationId,
            clientId: input.clientId ?? null,
            artifactType: input.artifactType,
            artifactId: input.artifactId,
            artifactVersion,
            artifactDigest: input.artifactDigest,
            workflowType,
            sourceFactSnapshots: input.sourceFactSnapshots ?? [],
            ruleVersionsUsed: input.ruleVersionsUsed ?? [],
            aiRunId: input.aiRunId ?? null,
            aiModel: input.aiModel ?? null,
            aiPromptVersion: input.aiPromptVersion ?? null,
            confidence: input.confidence ?? null,
            riskClassification: input.riskClassification,
            requiredReviewerRole: input.requiredReviewerRole,
            state,
            playbookId: input.playbookId ?? null,
            playbookVersion: input.playbookVersion ?? null,
            previousReviewItemId: input.previousReviewItemId ?? null,
            createdByMemberId: input.createdByMemberId ?? null,
            // Direct-to-queue creation IS the submission (fresh metric anchor).
            submittedAt: state === "awaiting_review" ? now : null,
            createdAt: now,
            updatedAt: now,
          })
          .returning();
        return toReviewItem(inserted[0]!);
      } catch (err) {
        if (isUniqueViolation(err)) {
          throw new OpenReviewItemExistsError(input.artifactType, input.artifactId, artifactVersion, workflowType);
        }
        throw err;
      }
    });
  }

  async getById(organizationId: string, reviewItemId: string): Promise<ReviewItemRecord | null> {
    return withOrgContext(this.db, organizationId, async (tx) => {
      const rows = await tx.select().from(reviewItems).where(eq(reviewItems.id, reviewItemId)).limit(1);
      return rows[0] ? toReviewItem(rows[0]) : null;
    });
  }

  /** Queue listing — the (organization_id, artifact_type, state) index shape. */
  async listByOrg(organizationId: string, filter?: ListReviewItemsFilter): Promise<ReviewItemRecord[]> {
    return withOrgContext(this.db, organizationId, async (tx) => {
      const conditions = [
        filter?.artifactType ? eq(reviewItems.artifactType, filter.artifactType) : undefined,
        filter?.state ? eq(reviewItems.state, filter.state) : undefined,
      ].filter((c) => c !== undefined);
      const rows = await tx
        .select()
        .from(reviewItems)
        .where(conditions.length > 0 ? and(...conditions) : undefined)
        .orderBy(desc(reviewItems.createdAt));
      return rows.map(toReviewItem);
    });
  }

  /**
   * PERSIST a kernel-approved transition. The caller (store, PR-5) has already
   * run `reviewItemTransition`/`applyReviewDecision` — this method never
   * re-decides legality; it writes the new state plus the transition's
   * bookkeeping: `submitted_at` on FIRST entering awaiting_review (an
   * escalation's same-state persist leaves the review-time metric anchor
   * untouched — F2), reviewer stamps on decisions, `published_at` on publish,
   * the superseded-by link on supersession, and the raised reviewer floor on
   * escalation. Caller-supplied cross-table references in the patch are
   * verified org-visible before writing (F1).
   */
  async saveTransition(
    organizationId: string,
    reviewItemId: string,
    toState: ReviewItemState,
    now: Date,
    patch?: ReviewItemTransitionPatch,
  ): Promise<ReviewItemRecord> {
    return withOrgContext(this.db, organizationId, async (tx) => {
      const head = await loadReviewItemHead(tx, reviewItemId);
      const set = await buildTransitionSet(tx, reviewItemId, toState, head, now, patch);
      const updated = await tx
        .update(reviewItems)
        .set(set)
        .where(eq(reviewItems.id, reviewItemId))
        .returning();
      if (!updated[0]) throw new ReviewItemNotFoundError(reviewItemId);
      return toReviewItem(updated[0]);
    });
  }

  /**
   * THE store entry point for review decisions (PR-5 must use it): appends the
   * `review_decisions` row AND moves the `review_items` head in ONE
   * `withOrgContext` transaction — decision log and denormalized head commit
   * or roll back together, so they can never drift (F3). State bookkeeping is
   * `saveTransition`'s exactly; `latest_decision`/`latest_decision_reason_code`
   * and `reviewed_by` come FROM the decision record (the input type omits them
   * from the patch so the head cannot disagree with the log). Legality is the
   * caller's job (`applyReviewDecision`), as everywhere in this module.
   */
  async recordDecisionAndTransition(
    organizationId: string,
    input: RecordDecisionAndTransitionInput,
    now: Date,
  ): Promise<{ decision: ReviewDecisionRecordRow; item: ReviewItemRecord }> {
    return withOrgContext(this.db, organizationId, async (tx) => {
      const head = await loadReviewItemHead(tx, input.reviewItemId);
      const decision = await insertDecisionRow(tx, organizationId, input, now);
      const set = await buildTransitionSet(tx, input.reviewItemId, input.toState, head, now, {
        ...input.headPatch,
        reviewedByMemberId: input.decidedByMemberId,
        latestDecision: input.decision,
        latestDecisionReasonCode: input.reasonCode,
      });
      const updated = await tx
        .update(reviewItems)
        .set(set)
        .where(eq(reviewItems.id, input.reviewItemId))
        .returning();
      if (!updated[0]) throw new ReviewItemNotFoundError(input.reviewItemId);
      return { decision, item: toReviewItem(updated[0]) };
    });
  }
}

/** Load the head fields a transition needs; typed not-found when RLS-invisible. */
async function loadReviewItemHead(
  tx: TenantScopedDb,
  reviewItemId: string,
): Promise<{ submittedAt: Date | null; artifactVersion: string; artifactDigest: string }> {
  const rows = await tx
    .select({
      submittedAt: reviewItems.submittedAt,
      artifactVersion: reviewItems.artifactVersion,
      artifactDigest: reviewItems.artifactDigest,
    })
    .from(reviewItems)
    .where(eq(reviewItems.id, reviewItemId))
    .limit(1);
  if (!rows[0]) throw new ReviewItemNotFoundError(reviewItemId);
  return rows[0];
}

/**
 * The ONE place transition bookkeeping is computed (`saveTransition` and
 * `recordDecisionAndTransition` share it). Verifies every caller-supplied
 * cross-table reference in the patch org-visible before it is written (F1),
 * stamps `submitted_at` ONLY when the item has never been submitted (F2), and
 * enforces the STALE-ARTIFACT publication invariant: publishing requires the
 * caller-supplied CURRENT artifact version + digest to match the reviewed
 * ones exactly — a changed (or unstated) artifact throws
 * `StaleReviewItemError` and nothing is written. New review required.
 */
async function buildTransitionSet(
  tx: TenantScopedDb,
  reviewItemId: string,
  toState: ReviewItemState,
  head: { submittedAt: Date | null; artifactVersion: string; artifactDigest: string },
  now: Date,
  patch?: ReviewItemTransitionPatch,
): Promise<Partial<typeof reviewItems.$inferInsert>> {
  const set: Partial<typeof reviewItems.$inferInsert> = {
    state: toState,
    updatedAt: now,
  };
  // F2: first entry into awaiting_review ONLY — an escalation re-persisting
  // awaiting_review must not move the review-time metric anchor.
  if (toState === "awaiting_review" && head.submittedAt === null) set.submittedAt = now;
  if (toState === "approved" || toState === "rejected" || toState === "deferred") {
    set.reviewedAt = now;
    if (patch?.reviewedByMemberId !== undefined) {
      if (patch.reviewedByMemberId !== null) await assertMemberInOrg(tx, patch.reviewedByMemberId);
      set.reviewedByMemberId = patch.reviewedByMemberId;
    }
  }
  if (toState === "published") {
    // Stale-artifact invariant (fail closed): publication without the current
    // version + digest, or against a changed artifact, does not exist.
    if (
      patch?.currentArtifactVersion !== head.artifactVersion ||
      patch?.currentArtifactDigest !== head.artifactDigest
    ) {
      throw new StaleReviewItemError(
        reviewItemId,
        { artifactVersion: head.artifactVersion, artifactDigest: head.artifactDigest },
        {
          artifactVersion: patch?.currentArtifactVersion ?? null,
          artifactDigest: patch?.currentArtifactDigest ?? null,
        },
      );
    }
    set.publishedAt = now;
    if (patch?.publishedResultRef !== undefined) set.publishedResultRef = patch.publishedResultRef;
  }
  if (toState === "superseded" && patch?.supersededByReviewItemId !== undefined) {
    await assertReviewItemInOrg(tx, patch.supersededByReviewItemId);
    set.supersededByReviewItemId = patch.supersededByReviewItemId;
  }
  if (patch?.latestDecision !== undefined) set.latestDecision = patch.latestDecision;
  if (patch?.latestDecisionReasonCode !== undefined) {
    set.latestDecisionReasonCode = patch.latestDecisionReasonCode;
  }
  if (patch?.modificationsDigest !== undefined) set.modificationsDigest = patch.modificationsDigest;
  if (patch?.requiredReviewerRole !== undefined) set.requiredReviewerRole = patch.requiredReviewerRole;
  return set;
}

// --- Review decisions (append-only) -----------------------------------------

export interface ReviewDecisionRecordRow {
  id: string;
  organizationId: string;
  reviewItemId: string;
  decision: ReviewDecision;
  reasonCode: string;
  ruleVersion: string;
  decidedByMemberId: string;
  clientStageAtDecision: string | null;
  workflowType: ReviewArtifactType;
  aiRunId: string | null;
  agentVersion: string | null;
  editedFields: string[];
  finalOutputSha256: string | null;
  escalatedToRole: ReviewerRole | null;
  detail: string | null;
  decidedAt: string;
}

export interface AppendReviewDecisionInput {
  reviewItemId: string;
  decision: ReviewDecision;
  /** Structured RVD_* code from REVIEW_DECISION_REASON_CODES. */
  reasonCode: string;
  ruleVersion: string;
  decidedByMemberId: string;
  clientStageAtDecision?: string | null;
  workflowType: ReviewArtifactType;
  aiRunId?: string | null;
  agentVersion?: string | null;
  /** Edited field NAMES only — never values. */
  editedFields?: string[];
  /** SHA-256 hex digest only. */
  finalOutputSha256?: string | null;
  escalatedToRole?: ReviewerRole | null;
  detail?: string | null;
}

/**
 * Input for `recordDecisionAndTransition` (F3): the decision record fields
 * plus the kernel-approved target state and any remaining head bookkeeping.
 * `reviewedByMemberId`/`latestDecision`/`latestDecisionReasonCode` are
 * deliberately EXCLUDED from the patch — they always come from the decision
 * record itself, so the head can never disagree with the append-only log.
 */
export interface RecordDecisionAndTransitionInput extends AppendReviewDecisionInput {
  /** The state `applyReviewDecision` returned (awaiting_review for escalations). */
  toState: ReviewItemState;
  headPatch?: Omit<
    ReviewItemTransitionPatch,
    "reviewedByMemberId" | "latestDecision" | "latestDecisionReasonCode"
  >;
}

type ReviewDecisionRow = typeof reviewDecisions.$inferSelect;

function toDecision(row: ReviewDecisionRow): ReviewDecisionRecordRow {
  return {
    id: row.id,
    organizationId: row.organizationId,
    reviewItemId: row.reviewItemId,
    decision: row.decision as ReviewDecision,
    reasonCode: row.reasonCode,
    ruleVersion: row.ruleVersion,
    decidedByMemberId: row.decidedByMemberId,
    clientStageAtDecision: row.clientStageAtDecision,
    workflowType: row.workflowType as ReviewArtifactType,
    aiRunId: row.aiRunId,
    agentVersion: row.agentVersion,
    editedFields: row.editedFields as string[],
    finalOutputSha256: row.finalOutputSha256,
    escalatedToRole: row.escalatedToRole as ReviewerRole | null,
    detail: row.detail,
    decidedAt: row.decidedAt.toISOString(),
  };
}

/**
 * Guarded insert into the append-only decision log, shared by `append` and
 * `recordDecisionAndTransition` (F3) — every caller-supplied cross-table
 * reference (decider member, ai_run) is verified org-visible first (F1); the
 * review item itself is guarded by each caller.
 */
async function insertDecisionRow(
  tx: TenantScopedDb,
  organizationId: string,
  input: AppendReviewDecisionInput,
  now: Date,
): Promise<ReviewDecisionRecordRow> {
  await assertMemberInOrg(tx, input.decidedByMemberId);
  if (input.aiRunId != null) await assertAiRunInOrg(tx, input.aiRunId);
  const inserted = await tx
    .insert(reviewDecisions)
    .values({
      organizationId,
      reviewItemId: input.reviewItemId,
      decision: input.decision,
      reasonCode: input.reasonCode,
      ruleVersion: input.ruleVersion,
      decidedByMemberId: input.decidedByMemberId,
      clientStageAtDecision:
        (input.clientStageAtDecision as ReviewDecisionRow["clientStageAtDecision"]) ?? null,
      workflowType: input.workflowType,
      aiRunId: input.aiRunId ?? null,
      agentVersion: input.agentVersion ?? null,
      editedFields: input.editedFields ?? [],
      finalOutputSha256: input.finalOutputSha256 ?? null,
      escalatedToRole: input.escalatedToRole ?? null,
      detail: input.detail ?? null,
      decidedAt: now,
    })
    .returning();
  return toDecision(inserted[0]!);
}

/**
 * APPEND-ONLY decision log. This class exposes `append` and `listByItem` and
 * NOTHING else — no update, no delete, structurally (the review-persistence
 * test asserts the surface). The feedback record the moat depends on cannot
 * be rewritten after the fact. NOTE: for an actual review decision the store
 * (PR-5) must use `DrizzleReviewItemRepository.recordDecisionAndTransition`,
 * which appends the SAME row atomically with the head move; bare `append` is
 * for non-transition paths (e.g. log backfill/import).
 */
export class DrizzleReviewDecisionRepository {
  constructor(private readonly db: TenantScopedDb) {}

  async append(
    organizationId: string,
    input: AppendReviewDecisionInput,
    now: Date,
  ): Promise<ReviewDecisionRecordRow> {
    return withOrgContext(this.db, organizationId, async (tx) => {
      // The item FK bypasses RLS — verify the decided item is in THIS org.
      await assertReviewItemInOrg(tx, input.reviewItemId);
      return insertDecisionRow(tx, organizationId, input, now);
    });
  }

  async listByItem(organizationId: string, reviewItemId: string): Promise<ReviewDecisionRecordRow[]> {
    return withOrgContext(this.db, organizationId, async (tx) => {
      const rows = await tx
        .select()
        .from(reviewDecisions)
        .where(eq(reviewDecisions.reviewItemId, reviewItemId))
        .orderBy(asc(reviewDecisions.decidedAt));
      return rows.map(toDecision);
    });
  }
}

// --- Playbooks --------------------------------------------------------------

export interface PlaybookRecord {
  id: string;
  organizationId: string;
  playbookKey: string;
  name: string;
  currentVersionId: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface PlaybookVersionRecord {
  id: string;
  organizationId: string;
  playbookId: string;
  version: string;
  status: PlaybookVersionStatus;
  effectiveDate: string | null;
  authorMemberId: string;
  approverMemberId: string | null;
  approvedAt: string | null;
  /** Publisher identity (migration 0011) — stamped from the ACTING member on publish. */
  publishedByMemberId: string | null;
  /**
   * Append-only executed-transition log (migration 0011) — the ONE contract
   * shape shared with the store's `PlaybookVersion.reviewHistory` (ADR-0047).
   * The founder's owner override is VISIBLE here. Ids/codes only.
   */
  reviewHistory: PlaybookVersionReviewEvent[];
  content: PlaybookContent;
  createdAt: string;
  updatedAt: string;
}

export interface CreatePlaybookInput {
  playbookKey: string;
  name: string;
}

export interface SaveDraftVersionInput {
  playbookId: string;
  /** Plain semver, e.g. "1.0.0". */
  version: string;
  content: PlaybookContent;
  authorMemberId: string;
}

/**
 * The governed action a version transition maps to: the kernel's
 * `PlaybookAction` for submit/approve/publish, plus the reviewer-decision and
 * withdrawal surfaces the store enforces by role floor (ADR-0043 semantics,
 * now durable).
 */
export type PlaybookGovernedAction = PlaybookAction | "reject" | "defer" | "withdraw";

/**
 * The ACTING organization member for a playbook version transition
 * (server-resolved session identity — never client-supplied).
 *
 * There is deliberately NO `isAuthor` claim: authorship is DERIVED inside the
 * repository by comparing `memberId` to the stored `author_member_id` in the
 * same transaction, so a caller can never launder the founder's separation
 * rules by mislabeling itself (`isAuthor?: never` makes the claim a compile
 * error; the runtime derivation ignores any casted extra property).
 */
export interface PlaybookTransitionActor {
  /** Organization-member id — verified org-visible in the transition transaction. */
  memberId: string;
  /**
   * The actor's membership role. Bridged onto the kernel's `ReviewerRole`
   * vocabulary via `reviewerRoleForMemberRole` (the ADR-0043 §6-trap bridge):
   * anything outside staff/organization_admin/organization_owner — client,
   * partner_viewer, the auth layer's `staff_advisor`, garbage — maps to null
   * and is denied `PB_NO_MEMBERSHIP`.
   */
  role: string;
  isAuthor?: never;
}

export interface TransitionVersionOptions {
  /**
   * The documented single-operator owner override (founder decision
   * 2026-07-23 #2). Valid ONLY for an organization_owner, ONLY when the
   * organization's `allow_single_operator_playbook_override` policy flag —
   * read inside the same transaction — permits it, AND the override carries a
   * non-empty reason AND attests the content is not regulated professional
   * advice. A used override is recorded in the version's review history.
   */
  ownerOverride?: PlaybookOwnerOverride | null;
}

type PlaybookRow = typeof playbooks.$inferSelect;
type PlaybookVersionRow = typeof playbookVersions.$inferSelect;

function toPlaybook(row: PlaybookRow): PlaybookRecord {
  return {
    id: row.id,
    organizationId: row.organizationId,
    playbookKey: row.playbookKey,
    name: row.name,
    currentVersionId: row.currentVersionId,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  };
}

function toVersion(row: PlaybookVersionRow): PlaybookVersionRecord {
  return {
    id: row.id,
    organizationId: row.organizationId,
    playbookId: row.playbookId,
    version: row.version,
    status: row.status as PlaybookVersionStatus,
    effectiveDate: isoOrNull(row.effectiveDate),
    authorMemberId: row.authorMemberId,
    approverMemberId: row.approverMemberId,
    approvedAt: isoOrNull(row.approvedAt),
    publishedByMemberId: row.publishedByMemberId,
    reviewHistory: assertHistoryArray(row.id, row.reviewHistory),
    content: row.content as PlaybookContent,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  };
}

/** Fail closed on a review_history value this module could never have written. */
function assertHistoryArray(versionId: string, value: unknown): PlaybookVersionReviewEvent[] {
  if (!Array.isArray(value)) throw new PlaybookReviewHistoryCorruptionError(versionId, "not_an_array");
  return value as PlaybookVersionReviewEvent[];
}

/**
 * APPEND-ONLY in code: always read-modify-append the array loaded in the SAME
 * transaction — never replace — with a runtime tripwire that the new array is
 * exactly one entry longer than the old one.
 */
function appendReviewHistory(
  versionId: string,
  stored: unknown,
  entry: PlaybookVersionReviewEvent,
): PlaybookVersionReviewEvent[] {
  const history = assertHistoryArray(versionId, stored);
  const previousLength = history.length;
  const next = [...history, entry];
  if (next.length !== previousLength + 1) {
    throw new PlaybookReviewHistoryCorruptionError(versionId, "append_length_mismatch");
  }
  return next;
}

export class DrizzlePlaybookRepository {
  constructor(private readonly db: TenantScopedDb) {}

  async createPlaybook(organizationId: string, input: CreatePlaybookInput, now: Date): Promise<PlaybookRecord> {
    return withOrgContext(this.db, organizationId, async (tx) => {
      try {
        const inserted = await tx
          .insert(playbooks)
          .values({
            organizationId,
            playbookKey: input.playbookKey,
            name: input.name,
            createdAt: now,
            updatedAt: now,
          })
          .returning();
        return toPlaybook(inserted[0]!);
      } catch (err) {
        if (isUniqueViolation(err)) throw new PlaybookKeyExistsError(input.playbookKey);
        throw err;
      }
    });
  }

  async getByKey(organizationId: string, playbookKey: string): Promise<PlaybookRecord | null> {
    return withOrgContext(this.db, organizationId, async (tx) => {
      const rows = await tx
        .select()
        .from(playbooks)
        .where(eq(playbooks.playbookKey, playbookKey))
        .limit(1);
      return rows[0] ? toPlaybook(rows[0]) : null;
    });
  }

  async getVersionById(organizationId: string, versionId: string): Promise<PlaybookVersionRecord | null> {
    return withOrgContext(this.db, organizationId, async (tx) => {
      const rows = await tx
        .select()
        .from(playbookVersions)
        .where(eq(playbookVersions.id, versionId))
        .limit(1);
      return rows[0] ? toVersion(rows[0]) : null;
    });
  }

  async listVersions(organizationId: string, playbookId: string): Promise<PlaybookVersionRecord[]> {
    return withOrgContext(this.db, organizationId, async (tx) => {
      const rows = await tx
        .select()
        .from(playbookVersions)
        .where(eq(playbookVersions.playbookId, playbookId))
        .orderBy(asc(playbookVersions.createdAt));
      return rows.map(toVersion);
    });
  }

  /**
   * Save a new DRAFT version. Content is validated structurally
   * (`validatePlaybookContent`) and rejected on any error — invalid content
   * never reaches the table. Drafts may freely carry `discovery_required`
   * fields; those block approval, not drafting.
   */
  async saveDraftVersion(
    organizationId: string,
    input: SaveDraftVersionInput,
    now: Date,
  ): Promise<PlaybookVersionRecord> {
    const errors = validatePlaybookContent(input.content);
    if (errors.length > 0) throw new InvalidPlaybookContentError(errors);

    return withOrgContext(this.db, organizationId, async (tx) => {
      // FK validation bypasses RLS — verify the parent playbook and the
      // author member are in THIS org.
      await assertPlaybookInOrg(tx, input.playbookId);
      await assertMemberInOrg(tx, input.authorMemberId);

      try {
        const inserted = await tx
          .insert(playbookVersions)
          .values({
            organizationId,
            playbookId: input.playbookId,
            version: input.version,
            status: "draft",
            authorMemberId: input.authorMemberId,
            content: input.content,
            // Birth entry — store parity (ADR-0047): the shared store records
            // a "saved" review-history entry when a draft version is created.
            reviewHistory: [
              {
                action: "saved",
                actorMemberId: input.authorMemberId,
                reasonCode: "PB_ACTION_ALLOWED",
                ownerOverride: null,
                occurredAt: now.toISOString(),
              } satisfies PlaybookVersionReviewEvent,
            ],
            createdAt: now,
            updatedAt: now,
          })
          .returning();
        return toVersion(inserted[0]!);
      } catch (err) {
        if (isUniqueViolation(err)) throw new PlaybookVersionExistsError(input.playbookId, input.version);
        throw err;
      }
    });
  }

  /**
   * Transition a version through the playbook.v1.0.0 machine UNDER the
   * founder's actor policy (decision 2026-07-23 #2 — ADR-0047 closes the
   * ADR-0043 known gap: enforcement now exists at the durable layer too).
   * This is the enforcement boundary (ADR-0038 made real):
   *  (a) legality comes from `playbookVersionTransition` — an illegal move is
   *      denied with the kernel's reason code, never performed;
   *  (b) WHO may act is decided by `canActOnPlaybookVersion` for
   *      submit/approve/publish — role floors, author/publisher separation,
   *      high-impact author/approver separation (`isHighImpactPlaybookContent`
   *      on the stored content), and the documented single-operator owner
   *      override gated by the org policy flag read INSIDE this transaction.
   *      Reject/defer are reviewer decisions (organization_admin+); withdraw
   *      is the author or organization_admin+. `isAuthor` is DERIVED here by
   *      comparing the actor to the stored `author_member_id` — never a
   *      caller claim. A denial throws a typed error and writes NOTHING;
   *  (c) `approved`/`published` are DENIED while `contentBlocksApproval` is
   *      non-empty — a version with any `discovery_required` field can never
   *      present an unresolved question as settled process;
   *  (d) direct `superseded` is NOT a surface — supersession happens only
   *      through publishing a newer version (store parity);
   *  (e) approval stamps `approver_member_id`/`approved_at` and publication
   *      stamps `published_by_member_id` FROM THE ACTOR — never optional,
   *      never anonymous;
   *  (f) every executed transition APPENDS one `{action, actorMemberId,
   *      reasonCode, ownerOverride, occurredAt}` entry to the version's
   *      `review_history` (read-modify-append in the SAME transaction —
   *      append-only in code, guarded), so a used owner override is VISIBLE
   *      in review history, per the founder directive;
   *  (g) publishing is ATOMIC: superseding the currently published version
   *      (with its own "superseded" history entry) and moving the playbook's
   *      `current_version_id` head happen in the SAME `withOrgContext`
   *      transaction as the publish itself — a failure anywhere rolls back
   *      everything.
   */
  async transitionVersion(
    organizationId: string,
    versionId: string,
    toStatus: PlaybookVersionStatus,
    now: Date,
    actor: PlaybookTransitionActor,
    options?: TransitionVersionOptions,
  ): Promise<PlaybookVersionRecord> {
    return withOrgContext(this.db, organizationId, async (tx) => {
      const rows = await tx
        .select()
        .from(playbookVersions)
        .where(eq(playbookVersions.id, versionId))
        .limit(1);
      const current = rows[0];
      if (!current) throw new PlaybookVersionNotFoundError(versionId);

      // The member FK bypasses RLS — verify the ACTOR is in THIS org before
      // any authority decision or write (the F1 idiom).
      await assertMemberInOrg(tx, actor.memberId);

      // (d) Direct supersession is not a transition surface.
      if (toStatus === "superseded") throw new PlaybookDirectSupersessionError(versionId);

      const transition = playbookVersionTransition(current.status, toStatus);
      if (!transition.allowed) {
        throw new PlaybookTransitionDeniedError(transition.reasonCode, current.status, toStatus);
      }

      // (b) Founder actor policy. isAuthor is DERIVED from the stored row.
      const actorRole = reviewerRoleForMemberRole(actor.role);
      const isAuthor = current.authorMemberId === actor.memberId;
      const ownerOverride = options?.ownerOverride ?? null;
      const kernelAction: PlaybookAction | null =
        toStatus === "awaiting_review"
          ? "submit"
          : toStatus === "approved"
            ? "approve"
            : toStatus === "published"
              ? "publish"
              : null;
      let historyReasonCode: string = transition.reasonCode;
      let usedOwnerOverride = false;
      if (kernelAction !== null) {
        const policy = canActOnPlaybookVersion({
          action: kernelAction,
          actorRole,
          actorIsAuthor: isAuthor,
          highImpact: isHighImpactPlaybookContent(current.content as PlaybookContent),
          ownerOverride,
          // The org policy flag is read INSIDE this transaction — never a
          // caller claim (organizations is a tenant root, not RLS-scoped).
          orgPolicyPermitsOverride: await this.orgPermitsOwnerOverride(tx, organizationId),
        });
        if (!policy.allowed) {
          throw new PlaybookActionDeniedError(policy.reasonCode, kernelAction, actor.memberId);
        }
        usedOwnerOverride = policy.usedOwnerOverride;
        if (usedOwnerOverride) historyReasonCode = "PB_OWNER_OVERRIDE";
      } else {
        // reject/defer are reviewer decisions ("Organization Admin may review
        // and approve"); withdraw = author or organization_admin+ (ADR-0043).
        const isAdminPlus = actorRole === "organization_admin" || actorRole === "organization_owner";
        const governedAction: PlaybookGovernedAction =
          toStatus === "rejected" ? "reject" : toStatus === "deferred" ? "defer" : "withdraw";
        const allowed = toStatus === "withdrawn" ? isAuthor || isAdminPlus : isAdminPlus;
        if (!allowed) {
          throw new PlaybookActionDeniedError(
            actorRole === null ? "PB_NO_MEMBERSHIP" : "PB_ROLE_INSUFFICIENT",
            governedAction,
            actor.memberId,
          );
        }
      }

      // (c) ADR-0038/0041 boundary — never weakened.
      if (toStatus === "approved" || toStatus === "published") {
        const blocked = contentBlocksApproval(current.content as PlaybookContent);
        if (blocked.length > 0) throw new PlaybookApprovalBlockedError(blocked);
      }

      const set: Partial<typeof playbookVersions.$inferInsert> = {
        status: toStatus,
        updatedAt: now,
      };
      if (toStatus === "approved") {
        // (e) The approver IS the actor — no longer optional or anonymous.
        set.approvedAt = now;
        set.approverMemberId = actor.memberId;
      }
      if (toStatus === "published") {
        // A published version must carry an effective date; stamp when unset.
        if (current.effectiveDate === null) set.effectiveDate = now;
        // (e) The publisher IS the actor.
        set.publishedByMemberId = actor.memberId;
        // Supersede the currently published version (at most one, by this
        // flow), appending its own history entry (read-modify-append).
        const priorPublished = await tx
          .select({ id: playbookVersions.id, reviewHistory: playbookVersions.reviewHistory })
          .from(playbookVersions)
          .where(
            and(
              eq(playbookVersions.playbookId, current.playbookId),
              eq(playbookVersions.status, "published"),
            ),
          );
        for (const prior of priorPublished) {
          await tx
            .update(playbookVersions)
            .set({
              status: "superseded",
              reviewHistory: appendReviewHistory(prior.id, prior.reviewHistory, {
                action: "superseded",
                actorMemberId: actor.memberId,
                reasonCode: "PB_SUPERSEDED",
                ownerOverride: null,
                occurredAt: now.toISOString(),
              }),
              updatedAt: now,
            })
            .where(eq(playbookVersions.id, prior.id));
        }
      }

      // (f) Append the executed transition to the version's review history —
      // the owner override is VISIBLE here (founder decision, verbatim). The
      // cast mirrors the store's: "draft" is never a transition target (the
      // kernel has no edge into it) and "superseded" was rejected above.
      const historyAction: PlaybookVersionReviewEvent["action"] =
        toStatus === "awaiting_review"
          ? "submitted"
          : (toStatus as PlaybookVersionReviewEvent["action"]);
      set.reviewHistory = appendReviewHistory(versionId, current.reviewHistory, {
        action: historyAction,
        actorMemberId: actor.memberId,
        reasonCode: historyReasonCode,
        ownerOverride: usedOwnerOverride && ownerOverride ? { reason: ownerOverride.reason } : null,
        occurredAt: now.toISOString(),
      });

      const updated = await tx
        .update(playbookVersions)
        .set(set)
        .where(eq(playbookVersions.id, versionId))
        .returning();

      if (toStatus === "published") {
        // (g) Move the head in the SAME transaction — publish + supersede +
        // head move commit or roll back as one unit.
        await tx
          .update(playbooks)
          .set({ currentVersionId: versionId, updatedAt: now })
          .where(eq(playbooks.id, current.playbookId));
      }

      return toVersion(updated[0]!);
    });
  }

  /**
   * Read the organization's single-operator override policy flag inside the
   * transition transaction (migration 0011). Fail closed: an unknown org —
   * impossible under a server-resolved organizationId — reads as false.
   */
  private async orgPermitsOwnerOverride(tx: TenantScopedDb, organizationId: string): Promise<boolean> {
    const rows = await tx
      .select({ allow: organizations.allowSingleOperatorPlaybookOverride })
      .from(organizations)
      .where(eq(organizations.id, organizationId))
      .limit(1);
    return rows[0]?.allow ?? false;
  }
}

// --- Workflow discovery -----------------------------------------------------

export interface WorkflowDiscoveryRecord {
  id: string;
  organizationId: string;
  playbookId: string | null;
  checkpointRef: string | null;
  question: string;
  context: string;
  status: WorkflowDiscoveryStatus;
  raisedByMemberId: string | null;
  answer: string | null;
  answeredByMemberId: string | null;
  answeredAt: string | null;
  convertedPlaybookVersionId: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface RaiseDiscoveryItemInput {
  playbookId?: string | null;
  checkpointRef?: string | null;
  question: string;
  context?: string;
  /** Null = system/seed-raised. */
  raisedByMemberId?: string | null;
}

export interface DiscoveryTransitionOptions {
  answer?: string;
  answeredByMemberId?: string | null;
  convertedPlaybookVersionId?: string;
}

type DiscoveryRow = typeof workflowDiscoveryItems.$inferSelect;

function toDiscovery(row: DiscoveryRow): WorkflowDiscoveryRecord {
  return {
    id: row.id,
    organizationId: row.organizationId,
    playbookId: row.playbookId,
    checkpointRef: row.checkpointRef,
    question: row.question,
    context: row.context,
    status: row.status as WorkflowDiscoveryStatus,
    raisedByMemberId: row.raisedByMemberId,
    answer: row.answer,
    answeredByMemberId: row.answeredByMemberId,
    answeredAt: isoOrNull(row.answeredAt),
    convertedPlaybookVersionId: row.convertedPlaybookVersionId,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  };
}

export class DrizzleWorkflowDiscoveryRepository {
  constructor(private readonly db: TenantScopedDb) {}

  async raise(
    organizationId: string,
    input: RaiseDiscoveryItemInput,
    now: Date,
  ): Promise<WorkflowDiscoveryRecord> {
    return withOrgContext(this.db, organizationId, async (tx) => {
      // FK validation bypasses RLS — verify a referenced playbook and the
      // raising member are in THIS org.
      if (input.playbookId != null) await assertPlaybookInOrg(tx, input.playbookId);
      if (input.raisedByMemberId != null) await assertMemberInOrg(tx, input.raisedByMemberId);
      const inserted = await tx
        .insert(workflowDiscoveryItems)
        .values({
          organizationId,
          playbookId: input.playbookId ?? null,
          checkpointRef: input.checkpointRef ?? null,
          question: input.question,
          context: input.context ?? "",
          status: "open",
          raisedByMemberId: input.raisedByMemberId ?? null,
          createdAt: now,
          updatedAt: now,
        })
        .returning();
      return toDiscovery(inserted[0]!);
    });
  }

  async getById(organizationId: string, itemId: string): Promise<WorkflowDiscoveryRecord | null> {
    return withOrgContext(this.db, organizationId, async (tx) => {
      const rows = await tx
        .select()
        .from(workflowDiscoveryItems)
        .where(eq(workflowDiscoveryItems.id, itemId))
        .limit(1);
      return rows[0] ? toDiscovery(rows[0]) : null;
    });
  }

  async listByOrg(
    organizationId: string,
    status?: WorkflowDiscoveryStatus,
  ): Promise<WorkflowDiscoveryRecord[]> {
    return withOrgContext(this.db, organizationId, async (tx) => {
      const rows = await tx
        .select()
        .from(workflowDiscoveryItems)
        .where(status ? eq(workflowDiscoveryItems.status, status) : undefined)
        .orderBy(desc(workflowDiscoveryItems.createdAt));
      return rows.map(toDiscovery);
    });
  }

  /**
   * Transition through the playbook.v1.0.0 discovery machine
   * (open → answered → converted; dismissed/reopen). Bookkeeping is
   * status-driven: `answered` REQUIRES an answer (+ answered-by/at stamps);
   * `converted` REQUIRES the playbook version that absorbed the answer
   * (verified org-visible — the FK bypasses RLS).
   */
  async transition(
    organizationId: string,
    itemId: string,
    toStatus: WorkflowDiscoveryStatus,
    now: Date,
    options?: DiscoveryTransitionOptions,
  ): Promise<WorkflowDiscoveryRecord> {
    return withOrgContext(this.db, organizationId, async (tx) => {
      const rows = await tx
        .select()
        .from(workflowDiscoveryItems)
        .where(eq(workflowDiscoveryItems.id, itemId))
        .limit(1);
      const current = rows[0];
      if (!current) throw new WorkflowDiscoveryNotFoundError(itemId);

      const transition = workflowDiscoveryTransition(current.status, toStatus);
      if (!transition.allowed) {
        throw new WorkflowDiscoveryTransitionDeniedError(transition.reasonCode, current.status, toStatus);
      }

      const set: Partial<typeof workflowDiscoveryItems.$inferInsert> = {
        status: toStatus,
        updatedAt: now,
      };
      if (toStatus === "answered") {
        if (options?.answer === undefined || options.answer.trim().length === 0) {
          throw new WorkflowDiscoveryInputError("missing_answer");
        }
        // The member FK bypasses RLS — verify the answering member is in THIS org.
        if (options.answeredByMemberId != null) await assertMemberInOrg(tx, options.answeredByMemberId);
        set.answer = options.answer;
        set.answeredByMemberId = options.answeredByMemberId ?? null;
        set.answeredAt = now;
      }
      if (toStatus === "converted") {
        if (options?.convertedPlaybookVersionId === undefined) {
          throw new WorkflowDiscoveryInputError("missing_converted_version");
        }
        const version = await tx
          .select({ id: playbookVersions.id })
          .from(playbookVersions)
          .where(eq(playbookVersions.id, options.convertedPlaybookVersionId))
          .limit(1);
        if (!version[0]) throw new PlaybookVersionNotFoundError(options.convertedPlaybookVersionId);
        set.convertedPlaybookVersionId = options.convertedPlaybookVersionId;
      }

      const updated = await tx
        .update(workflowDiscoveryItems)
        .set(set)
        .where(eq(workflowDiscoveryItems.id, itemId))
        .returning();
      return toDiscovery(updated[0]!);
    });
  }
}
