# @aflo/academy

**ΛFLO Wealth Academy** (technical: AFLO) — the *Wealth Unlockers curriculum*.

## What lives here

- **`catalog`** — the versioned content model (courses → modules → lessons, plus ebooks/workshops). Lessons carry a `contentVersion` (recorded on every assignment) and reference external media by a **signed-playback key**, never a raw URL. No proprietary video is stored.
- **`assignment`** — `education.v1.0.0`: the deterministic **trigger → lesson** mapping (`selectEducation`) with a reason code, and `scoreKnowledgeCheck` (deterministic pass threshold, fail-closed on bad input).
- **`library`** — Golden Key's staff-authored starter catalog.

## Boundaries

- Academy **completion is educational only** — it never determines eligibility for any regulated product (charter).
- The trigger→lesson mapping is deterministic and staff-reviewable; AI may later *suggest* content but never overrides it.
