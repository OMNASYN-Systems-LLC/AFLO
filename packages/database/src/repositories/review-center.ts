import { and, asc, desc, eq } from "drizzle-orm";
import {
  contentBlocksApproval,
  playbookVersionTransition,
  validatePlaybookContent,
  workflowDiscoveryTransition,
  type PlaybookContent,
  type PlaybookContentFieldKey,
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
import {
  clients,
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
 *  - Playbook-version legality IS enforced here (`transitionVersion` consults
 *    `playbookVersionTransition` and `contentBlocksApproval`), because
 *    publish/supersede/current-head must be one atomic unit and this is the
 *    single write path for versions — the ADR-0038 enforcement boundary made
 *    real: a version with any `discovery_required` field can NEVER be
 *    approved or published, so invented process can never become doctrine.
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

/** Thrown when an artifact already has an OPEN review item (uq_review_items_open). */
export class OpenReviewItemExistsError extends Error {
  constructor(
    public readonly artifactType: string,
    public readonly artifactId: string,
  ) {
    super(`artifact already has an open review item: ${artifactType}/${artifactId}`);
    this.name = "OpenReviewItemExistsError";
  }
}

/** Thrown when a referenced client is not in the current org (FK bypasses RLS — guard here). */
export class ReviewClientNotInOrganizationError extends Error {
  constructor(public readonly clientId: string) {
    super(`client not found in organization: ${clientId}`);
    this.name = "ReviewClientNotInOrganizationError";
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

function isoOrNull(value: Date | null): string | null {
  return value === null ? null : value.toISOString();
}

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
    return withOrgContext(this.db, organizationId, async (tx) => {
      // The client FK bypasses RLS — verify a referenced client is in THIS org.
      if (input.clientId != null) await assertClientInOrg(tx, input.clientId);
      const state = input.state ?? "draft";
      try {
        const inserted = await tx
          .insert(reviewItems)
          .values({
            organizationId,
            clientId: input.clientId ?? null,
            artifactType: input.artifactType,
            artifactId: input.artifactId,
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
        if (isUniqueViolation(err)) throw new OpenReviewItemExistsError(input.artifactType, input.artifactId);
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
   * bookkeeping: `submitted_at` on entering awaiting_review, reviewer stamps
   * on decisions, `published_at` on publish, the superseded-by link on
   * supersession, and the raised reviewer floor on escalation.
   */
  async saveTransition(
    organizationId: string,
    reviewItemId: string,
    toState: ReviewItemState,
    now: Date,
    patch?: ReviewItemTransitionPatch,
  ): Promise<ReviewItemRecord> {
    return withOrgContext(this.db, organizationId, async (tx) => {
      const set: Partial<typeof reviewItems.$inferInsert> = {
        state: toState,
        updatedAt: now,
      };
      if (toState === "awaiting_review") set.submittedAt = now;
      if (toState === "approved" || toState === "rejected" || toState === "deferred") {
        set.reviewedAt = now;
        if (patch?.reviewedByMemberId !== undefined) set.reviewedByMemberId = patch.reviewedByMemberId;
      }
      if (toState === "published") {
        set.publishedAt = now;
        if (patch?.publishedResultRef !== undefined) set.publishedResultRef = patch.publishedResultRef;
      }
      if (toState === "superseded" && patch?.supersededByReviewItemId !== undefined) {
        set.supersededByReviewItemId = patch.supersededByReviewItemId;
      }
      if (patch?.latestDecision !== undefined) set.latestDecision = patch.latestDecision;
      if (patch?.latestDecisionReasonCode !== undefined) {
        set.latestDecisionReasonCode = patch.latestDecisionReasonCode;
      }
      if (patch?.modificationsDigest !== undefined) set.modificationsDigest = patch.modificationsDigest;
      if (patch?.requiredReviewerRole !== undefined) set.requiredReviewerRole = patch.requiredReviewerRole;

      const updated = await tx
        .update(reviewItems)
        .set(set)
        .where(eq(reviewItems.id, reviewItemId))
        .returning();
      if (!updated[0]) throw new ReviewItemNotFoundError(reviewItemId);
      return toReviewItem(updated[0]);
    });
  }
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
 * APPEND-ONLY decision log. This class exposes `append` and `listByItem` and
 * NOTHING else — no update, no delete, structurally (the review-persistence
 * test asserts the surface). The feedback record the moat depends on cannot
 * be rewritten after the fact.
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
      const item = await tx
        .select({ id: reviewItems.id })
        .from(reviewItems)
        .where(eq(reviewItems.id, input.reviewItemId))
        .limit(1);
      if (!item[0]) throw new ReviewItemNotFoundError(input.reviewItemId);

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
    content: row.content as PlaybookContent,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  };
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
      // The playbook FK bypasses RLS — verify the parent is in THIS org.
      const parent = await tx
        .select({ id: playbooks.id })
        .from(playbooks)
        .where(eq(playbooks.id, input.playbookId))
        .limit(1);
      if (!parent[0]) throw new PlaybookNotFoundError(input.playbookId);

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
   * Transition a version through the playbook.v1.0.0 machine. This is the
   * enforcement boundary (ADR-0038 made real):
   *  (a) legality comes from `playbookVersionTransition` — an illegal move is
   *      denied with the kernel's reason code, never performed;
   *  (b) `approved`/`published` are DENIED while `contentBlocksApproval` is
   *      non-empty — a version with any `discovery_required` field can never
   *      present an unresolved question as settled process;
   *  (c) publishing is ATOMIC: superseding the currently published version and
   *      moving the playbook's `current_version_id` head happen in the SAME
   *      `withOrgContext` transaction as the publish itself — a failure
   *      anywhere rolls back everything.
   */
  async transitionVersion(
    organizationId: string,
    versionId: string,
    toStatus: PlaybookVersionStatus,
    now: Date,
    options?: { approverMemberId?: string },
  ): Promise<PlaybookVersionRecord> {
    return withOrgContext(this.db, organizationId, async (tx) => {
      const rows = await tx
        .select()
        .from(playbookVersions)
        .where(eq(playbookVersions.id, versionId))
        .limit(1);
      const current = rows[0];
      if (!current) throw new PlaybookVersionNotFoundError(versionId);

      const transition = playbookVersionTransition(current.status, toStatus);
      if (!transition.allowed) {
        throw new PlaybookTransitionDeniedError(transition.reasonCode, current.status, toStatus);
      }

      if (toStatus === "approved" || toStatus === "published") {
        const blocked = contentBlocksApproval(current.content as PlaybookContent);
        if (blocked.length > 0) throw new PlaybookApprovalBlockedError(blocked);
      }

      const set: Partial<typeof playbookVersions.$inferInsert> = {
        status: toStatus,
        updatedAt: now,
      };
      if (toStatus === "approved") {
        set.approvedAt = now;
        if (options?.approverMemberId !== undefined) set.approverMemberId = options.approverMemberId;
      }
      if (toStatus === "published") {
        // A published version must carry an effective date; stamp when unset.
        if (current.effectiveDate === null) set.effectiveDate = now;
        // Supersede the currently published version (at most one, by this flow).
        await tx
          .update(playbookVersions)
          .set({ status: "superseded", updatedAt: now })
          .where(
            and(
              eq(playbookVersions.playbookId, current.playbookId),
              eq(playbookVersions.status, "published"),
            ),
          );
      }

      const updated = await tx
        .update(playbookVersions)
        .set(set)
        .where(eq(playbookVersions.id, versionId))
        .returning();

      if (toStatus === "published") {
        // Move the head in the SAME transaction — publish + supersede + head
        // move commit or roll back as one unit.
        await tx
          .update(playbooks)
          .set({ currentVersionId: versionId, updatedAt: now })
          .where(eq(playbooks.id, current.playbookId));
      }

      return toVersion(updated[0]!);
    });
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
      // The playbook FK bypasses RLS — verify a referenced playbook is in THIS org.
      if (input.playbookId != null) {
        const parent = await tx
          .select({ id: playbooks.id })
          .from(playbooks)
          .where(eq(playbooks.id, input.playbookId))
          .limit(1);
        if (!parent[0]) throw new PlaybookNotFoundError(input.playbookId);
      }
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
