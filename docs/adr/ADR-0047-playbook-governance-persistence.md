# ADR-0047: Durable playbook governance — actor authority + review history at the persistence layer (migration 0011)

## Status

**Accepted** — 2026-07-23 (founder CONTINUOUS EXECUTION AUTHORIZATION
2026-07-23, Workstream A persistence slice — closes the ADR-0043 committed
known gap)

## Context

ADR-0043 wired founder decision 2026-07-23 #2 (playbook author/approver
separation + the documented single-operator owner override) into the SHARED
STORE only and recorded the durable gap verbatim: the `playbook_versions`
schema had no publisher-identity column and no review-history/override
record, and `DrizzlePlaybookRepository.transitionVersion` took NO actor and
called NO `canActOnPlaybookVersion` — so at the durable layer any caller
could approve or publish any version anonymously, and the founder's
requirement that a used override be "visible in review history" had nowhere
durable to live. ADR-0043 committed this follow-up slice and stated its
specification: "the store's semantics are the specification it implements."
This ADR implements exactly that.

## Decision

### Migration 0011 (`0011_playbook_governance.sql`) — forward-only, additive

- `playbook_versions.published_by_member_id` uuid NULL, FK →
  `organization_members(id)` ON DELETE SET NULL (mirrors
  `approver_member_id`).
- `playbook_versions.review_history` jsonb NOT NULL DEFAULT `'[]'` — the
  append-only executed-transition log.
- `organizations.allow_single_operator_playbook_override` boolean NOT NULL
  DEFAULT **false** — the org policy flag gating the documented owner
  override; the column did not exist durably before this migration. The
  default matches the `@aflo/shared` `Organization` default, including the
  Golden Key seed (both layers fail closed).
- NO other DDL. No data touched, no index changes, no drops. **Snapshot
  chain intact (the PR #88 lesson): `meta/0011_snapshot.json` carries a
  fresh id with `prevId` = the 0010 snapshot's id, plus the `_journal.json`
  entry — test-guarded, and the snapshot's new columns are asserted to
  mirror the DDL.** `schema.ts` mirrors all three columns.

### Repository authority (`DrizzlePlaybookRepository.transitionVersion`)

The single write path for version transitions now REQUIRES the acting
member: `actor: { memberId }` (server-resolved session identity — IDENTITY
ONLY, see step 2), plus optional
`options.ownerOverride: PlaybookOwnerOverride | null`. Inside ONE
`withOrgContext` transaction:

1. **Actor org-visibility + row lock** — the member FK bypasses RLS, so the
   actor's membership is verified visible in THIS org first (the PR #92 F1
   idiom); a cross-org memberId throws `MemberNotInOrganizationError`,
   nothing written. The version row is loaded `SELECT … FOR UPDATE` (and the
   publish path's prior-published scan likewise), so concurrent transitions
   on one version SERIALIZE instead of losing review-history entries (review
   fix M2).
2. **`isAuthor` AND the role are DERIVED, never claimed** (review fix M1) —
   authorship by comparing `actor.memberId` to the stored
   `author_member_id`; the ROLE by reading the actor's
   `organization_members` row in the same transaction and bridging it via
   `reviewerRoleForMemberRole`. The actor type carries `role?: never` and
   `isAuthor?: never`, so both claims are compile errors, and smuggled casts
   are ignored (test-proven: a staff memberId "claiming" owner is denied
   from the STORED staff role).
3. **Kernel machine legality** (`playbookVersionTransition`) — unchanged.
4. **Actor policy — the transition → governed-action mapping:**
   - `awaiting_review` → kernel action **submit** (staff+),
   - `approved` → kernel action **approve** (organization_admin+;
     HIGH-IMPACT — `isHighImpactPlaybookContent` on the STORED content —
     requires approver ≠ author),
   - `published` → kernel action **publish** (organization_owner ONLY;
     never the author),
   all through `canActOnPlaybookVersion`, with
   `orgPolicyPermitsOverride` read from `organizations` INSIDE the same
   transaction — never a caller claim;
   - `rejected` / `deferred` → reviewer decisions, organization_admin+
     ("Organization Admin may review and approve"),
   - `withdrawn` → the author or organization_admin+,
   - `superseded` → NOT a direct surface (`PlaybookDirectSupersessionError`)
     — supersession happens only through publishing a newer version,
   exactly mirroring the store (ADR-0043). A denial throws the typed
   `PlaybookActionDeniedError` (reason code + governed action + actor) and
   NOTHING is written.
5. **`contentBlocksApproval` on approve AND publish** — the ADR-0038/0041
   anti-invention boundary, not weakened.
6. **Identity stamps from the ACTOR:** approve stamps
   `approver_member_id` + `approved_at` (no longer optional/anonymous — the
   old `options.approverMemberId` is gone); publish stamps
   `published_by_member_id`.
7. **Review history — append-only in code:** every EXECUTED transition
   appends one `{action, actorMemberId, reasonCode, ownerOverride,
   occurredAt}` entry (ids/codes only, never content) via
   read-modify-append on the array loaded in the SAME transaction — never a
   replace — with a runtime tripwire (`PlaybookReviewHistoryCorruptionError`)
   that the stored value is an array and the append extended it by exactly
   one. A used owner override records `{ reason }` in the entry — the
   founder's "visible in review history", durable. The recorded reason is
   the kernel-validated TRIMMED value, bounded at
   `PLAYBOOK_OVERRIDE_REASON_MAX_LENGTH` (500) — an over-bound reason is
   DENIED in the kernel (`PB_OVERRIDE_REASON_TOO_LONG`, review fix L1), so
   both enforcement layers inherit the bound and nothing is ever silently
   truncated. The publish path also appends the prior published version's
   `superseded` entry atomically with the supersede + head move. Denials
   append nothing — history records executed transitions; denial audit rows
   are the audit-layer follow-up.
8. **Durable audit for the org-wide-impact events** (review fix F-audit —
   the founder clause "the override is audited" now holds at this layer): an
   EXECUTED owner override inserts an `audit_events` row
   (`playbook.owner_override`, the store's action string verbatim; detail =
   compact JSON of the governed action + the kernel-clamped reason) and an
   EXECUTED publish inserts `playbook.version_published` (detail = playbook
   id, version, superseded version id) — both in the SAME `withOrgContext`
   transaction as the state change, via a direct insert on the ambient
   transaction handle (never a second transaction). The broader
   every-transition durable audit remains the documented later slice.
9. `saveDraftVersion` REQUIRES the acting member too (review fix F-draft):
   the actor IS the recorded author, its STORED role is read in the same
   transaction, and the kernel `draft` action (staff+) gates the write — a
   client or partner-viewer membership can never be recorded as a playbook
   author. The birth `review_history` entry is the store-parity `saved`
   record.

### One contract (store parity)

`PlaybookVersionReviewEvent` (`@aflo/shared` domain types) is THE shape both
layers write — the store to `PlaybookVersion.reviewHistory`, the repository
to the `review_history` jsonb — and the repository imports the type directly
(`@aflo/database` already depends on `@aflo/shared`). The one mismatch was
the actor key: the store wrote `actorStaffId`; the durable layer speaks
member ids. The store field is RENAMED to `actorMemberId` (the store's staff
ids ARE its member ids), writes updated, and the exact five-key entry shape
is test-pinned in both packages. No other store change.

## Post-review hardening (adversarial review of PR #98, same day)

The pre-merge adversarial review returned 2 MEDIUM + fidelity/LOW findings;
ALL fixed in this slice — none deferred:

1. **M1 (FIXED) — role laundering.** `transitionVersion` computed authority
   from a CALLER-CLAIMED `actor.role` while only the memberId was verified —
   a real staff memberId dressed up as `organization_owner` could publish
   durably. Fixed by removing `role` from the actor input entirely
   (`role?: never` — the claim is now structurally unrepresentable, matching
   the `isAuthor?: never` idiom) and deriving the role from the
   `organization_members` row read in the SAME transaction. Test-proven:
   a laundered cast is denied from the STORED staff role; stored
   client/partner_viewer memberships are denied `PB_NO_MEMBERSHIP`.
2. **M2 (FIXED) — concurrent lost update.** Two concurrent transitions
   could read the same `review_history` under READ COMMITTED and the second
   commit would silently drop the first's entry. Fixed: the version-row
   load and the publish path's prior-published scan are `SELECT … FOR
   UPDATE`, so transitions on one version serialize. **Runtime-proof
   caveat:** PGlite is single-connection, so a true two-transaction
   interleaving cannot execute in the credential-free suite — the lock
   clause is asserted via a drizzle query-text spy, and the runtime
   concurrency proof is a **Neon-preview acceptance item**.
3. **F-audit (FIXED) — "the override is audited," durably.** The executed
   owner override previously wrote only `review_history` at this layer.
   Now `playbook.owner_override` and `playbook.version_published`
   `audit_events` rows are inserted in the same transaction (details above).
   The fidelity ledger for the founder's audited clause now reads EXACT at
   both layers.
4. **F-draft (FIXED) — drafting floor.** `saveDraftVersion` previously
   recorded any org-visible memberId as author. Now the actor's stored role
   gates the write through the kernel `draft` action — the drafting floor
   reads EXACT at both layers.
5. **L1 (FIXED) — override-reason bound in the kernel.** Trimmed, non-empty,
   ≤500 chars (`PLAYBOOK_OVERRIDE_REASON_TOO_LONG` denial); the stored value
   is the validated trimmed reason at both layers.
6. **L2 note (moot backfill):** no backfill is needed for the 0011 columns —
   `playbook_versions` had no production write path before this workstream,
   so no rows predate the governance columns in any environment.

## Consequences

- **Founder decision 2026-07-23 #2 is now enforced at BOTH layers** — the
  shared store (ADR-0043) and the durable Drizzle repository (this ADR) run
  the same kernel (`canActOnPlaybookVersion`) over the same derived facts —
  and at both layers the audited-override clause and the drafting floor now
  hold EXACTLY; the ADR-0043 known gap ("Founder decision 2's enforcement is
  STORE-LEVEL ONLY today") is CLOSED.
- **Tests: 371 database (+26), 307 shared (+1), 151 rules (unchanged count;
  new at-bound/over-bound assertions for the L1 bound inside the override
  matrix test).**
  New PGlite (non-superuser) coverage: migration 0011 applies on top of
  0000–0010; snapshot chain extended to 0011; author-publish denied
  (`PB_AUTHOR_PUBLISHER_SEPARATION`) with no row change; staff-approve
  denied; admin-approve allowed + approver stamped; owner-publish allowed +
  publisher stamped + history entry with reason code; high-impact
  author-self-approve denied; owner override without the org flag denied
  (`PB_OVERRIDE_NOT_PERMITTED`), blank-reason denied
  (`PB_OVERRIDE_REASON_REQUIRED`), over-bound reason denied
  (`PB_OVERRIDE_REASON_TOO_LONG`); complete override succeeds with the
  TRIMMED override reason VISIBLE in `review_history` on approve AND
  publish, and audited (`playbook.owner_override` ×2 +
  `playbook.version_published`, detail JSON asserted); forged `isAuthor`
  impossible; forged ROLE impossible (M1); stored non-reviewer memberships
  denied (`PB_NO_MEMBERSHIP`); cross-org actor denied with nothing written;
  reject/defer/withdraw floors; direct supersession rejected; superseded
  prior version's history entry; append-only ordering end to end; the
  drafting floor (client/partner cannot author); the FOR UPDATE query-text
  spy; the shared contract-shape pin. Existing `contentBlocksApproval` and
  publish-atomicity tests updated to the actor signature and still pass.
- Breaking signatures: `transitionVersion(org, versionId, toStatus, now,
  actor, options?)` and `saveDraftVersion` taking `actor` instead of
  `authorMemberId`. No production caller existed outside tests (the web
  Review Center runs on the store; the repository swap is credential-gated),
  so no seam changes.
- Live Neon apply stays credential-gated (`db:migrate`); everything here is
  PGlite-proven on the exact production SQL — except the FOR UPDATE
  serialization, which is clause-asserted here and runtime-proven as a
  Neon-preview acceptance item (see Post-review hardening, M2).
- Deliberately OUT of scope (unchanged commitment): the broader
  EVERY-transition durable audit writer (each submit/reject/defer/withdraw
  plus every DENIAL as `audit_events` rows). The two org-wide-impact events
  (executed override, executed publish) are durably audited by this slice;
  the rest remains the documented later slice.
