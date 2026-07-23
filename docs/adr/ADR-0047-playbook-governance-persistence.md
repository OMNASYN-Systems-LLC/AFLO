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
member: `actor: { memberId, role }` (server-resolved session identity), plus
optional `options.ownerOverride: PlaybookOwnerOverride | null`. Inside ONE
`withOrgContext` transaction:

1. **Actor org-visibility** — the member FK bypasses RLS, so the actor's
   membership is verified visible in THIS org first (the PR #92 F1 idiom);
   a cross-org memberId throws `MemberNotInOrganizationError`, nothing
   written.
2. **`isAuthor` is DERIVED, never claimed** — the repository compares
   `actor.memberId` to the stored `author_member_id`; the actor type carries
   `isAuthor?: never` so the claim is a compile error, and a smuggled cast
   is ignored (test-proven).
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
   founder's "visible in review history", durable. The publish path also
   appends the prior published version's `superseded` entry atomically with
   the supersede + head move. Denials append nothing — history records
   executed transitions; denial audit rows are the audit-layer follow-up.
8. `saveDraftVersion` births `review_history` with the store-parity `saved`
   entry (author as actor, `PB_ACTION_ALLOWED`).

### One contract (store parity)

`PlaybookVersionReviewEvent` (`@aflo/shared` domain types) is THE shape both
layers write — the store to `PlaybookVersion.reviewHistory`, the repository
to the `review_history` jsonb — and the repository imports the type directly
(`@aflo/database` already depends on `@aflo/shared`). The one mismatch was
the actor key: the store wrote `actorStaffId`; the durable layer speaks
member ids. The store field is RENAMED to `actorMemberId` (the store's staff
ids ARE its member ids), writes updated, and the exact five-key entry shape
is test-pinned in both packages. No other store change.

## Consequences

- **Founder decision 2026-07-23 #2 is now enforced at BOTH layers** — the
  shared store (ADR-0043) and the durable Drizzle repository (this ADR) run
  the same kernel (`canActOnPlaybookVersion`) over the same derived facts;
  the ADR-0043 known gap ("Founder decision 2's enforcement is STORE-LEVEL
  ONLY today") is CLOSED.
- **Tests: 365 database (+20), 307 shared (+1), 151 rules (unchanged).**
  New PGlite (non-superuser) coverage: migration 0011 applies on top of
  0000–0010; snapshot chain extended to 0011; author-publish denied
  (`PB_AUTHOR_PUBLISHER_SEPARATION`) with no row change; staff-approve
  denied; admin-approve allowed + approver stamped; owner-publish allowed +
  publisher stamped + history entry with reason code; high-impact
  author-self-approve denied; owner override without the org flag denied
  (`PB_OVERRIDE_NOT_PERMITTED`), blank-reason denied
  (`PB_OVERRIDE_REASON_REQUIRED`); complete override succeeds with the
  override object VISIBLE in `review_history` on approve AND publish;
  forged `isAuthor` impossible; non-reviewer vocabularies denied
  (`PB_NO_MEMBERSHIP`); cross-org actor denied with nothing written;
  reject/defer/withdraw floors; direct supersession rejected; superseded
  prior version's history entry; append-only ordering end to end; the
  shared contract-shape pin. Existing `contentBlocksApproval` and
  publish-atomicity tests updated to the actor signature and still pass.
- Breaking signature: `transitionVersion(org, versionId, toStatus, now,
  actor, options?)`. No production caller existed outside tests (the web
  Review Center runs on the store; the repository swap is credential-gated),
  so no seam changes.
- Live Neon apply stays credential-gated (`db:migrate`); everything here is
  PGlite-proven on the exact production SQL.
- Deliberately OUT of scope (unchanged commitments): audit_events rows for
  durable playbook denials/overrides (the store audits today; the durable
  audit writer is a later slice), and `saveDraftVersion` actor policy (it
  takes the author as before; drafting floors bind at the store/session
  layer until the durable actor surface widens).
