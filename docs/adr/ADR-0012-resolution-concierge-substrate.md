# ADR-0012: Financial Resolution Concierge — Deterministic Substrate

## Status

**Accepted** — 2026-07-19 (founder strategic reframing: ΛFLO as a governed Financial Resolution Concierge / Finance 5.0 loop — understand → diagnose → organize → educate → resolve → verify → route → track → adapt)

## Context

The founder reframed ΛFLO as a governed **Financial Resolution Concierge**, not a chatbot: a deterministic loop that understands a client's situation, diagnoses readiness, organizes obligations, educates, and routes to licensed providers — with AI only ever explaining, never deciding. Architecture Rule 2 and the charter are explicit that stages are set by **versioned deterministic rules**, not free-form LLM output.

Much of the loop already exists as deterministic kernels: `readiness.v1.0.0` (diagnose), `engagement.v1.0.0`, `intake.v1.0.0`, `education.v1.0.0`, `roadmap.v1.0.0`, `partner.v1.0.0`. Two things were missing:

1. **The "understand" primitive.** Nothing computed, at the grain of the readiness inputs, *what verified facts we have vs. what is still needed to diagnose*. `intake.v1.0.0` measures section-level completeness; `runReadinessAssessment` simply refuses (and audits) when profiles are absent. Neither answers "which of the seven diagnosis inputs are captured, and does that block the diagnosis?"
2. **A governed, compact readout** that ties understand + diagnose + organize together as the **input contract** the future orchestration loop consumes — distinct from the staff `ClientDetail` (a UI aggregate of everything) and the client `PortalView` (a published-only projection).

## Decision

**1. Add `resolution.v1.0.0` to `@aflo/rules`** — a pure, dependency-free kernel implementing the deterministic **understand** primitive `readinessInputCompleteness(presence)`. Over the seven readiness inputs it reports captured, missing, **blocking-missing**, `canDiagnose`, and `completionPct`. Only the credit score is optional (thin-file clients remain assessable); the other six are required and mirror the store's assessment precondition (both profiles present). It fails closed — a presence flag that is not exactly `true` counts as missing — and it registers in the rule registry (lockstep-tested) with the canonical nine-stage loop vocabulary.

**2. Add a compact read-model to `@aflo/shared/domain`** — `ResolutionReadout` and the pure `buildResolutionReadout(input)`, which **composes already-verified facts and never recomputes them**: it reuses the *recorded* readiness assessment for the diagnosis, the caller's engagement assessment, and the utilization/DTI kernels for the organize snapshot. It carries rule-version **provenance** and is deliberately smaller and more decision-oriented than `ClientDetail`. `toReadinessInputPresence` adapts the two profiles into the kernel's input.

**3. Deterministic, read-only, no new facts.** No AI, no mutation, no new events, no new sensitive data. It composes existing outputs, so it cannot introduce or contradict a fact. Store/UI wiring is a deliberate follow-up — this slice is a pure, unit-tested library.

## Consequences

Positive: the loop's "understand" stage is now a first-class, versioned, tested primitive; a governed readout exists as the orchestration loop's input contract, with provenance, distinct from the UI aggregate; because it composes recorded facts, the deterministic/AI boundary (Rules 2–4) is preserved structurally — the readout can never become a place where a fact is invented.

Negative / accepted: `ResolutionReadout` overlaps in *content* with `ClientDetail` (both surface stage, engagement, goals, documents). The overlap is intentional — they are different read-models for different consumers (a compact loop contract vs. a staff UI). The risk is drift if both are hand-maintained; mitigated by composing the same kernels and keeping the readout minimal. The later loop stages (resolve, verify, route, track, adapt) are **not** implemented here; they compose other kernels and land in later slices. The readout is not yet wired into the store/UI.

## Alternatives Considered

1. **Extend `ClientDetail` instead of a new read-model** — rejected: `ClientDetail` is a staff-UI aggregate; loading it with a loop-input contract and completeness semantics would couple the orchestration substrate to a presentation shape and grow an already-large object.
2. **Put completeness in `@aflo/shared` as domain logic (not a versioned rule)** — rejected: completeness is deterministic policy that must be versioned and registry-tracked like the other kernels (charter: stages/decisions are versioned rules). It lives in `@aflo/rules`; only the profile→presence adapter and the record composition live in shared.
3. **Have the readout re-run the readiness diagnosis from current facts** — rejected: that would create a second diagnosis path that could disagree with the recorded, review-gated assessment. The readout mirrors the recorded assessment verbatim (a live preview already exists separately in `ClientDetail.assessment`).
4. **Model the whole nine-stage loop now** — rejected: only understand/diagnose/organize have deterministic substrates ready; building speculative machinery for resolve/route/etc. before their kernels exist violates smallest-complete-slice.
