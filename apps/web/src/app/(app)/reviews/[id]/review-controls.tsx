"use client";

import { useActionState, useState } from "react";
import type { ReviewActionState } from "@/lib/review-format";
import {
  assignReviewerAction,
  publishReviewItemAction,
  recordReviewDecisionAction,
} from "../actions";

/**
 * Review Center forms. These render whatever the STORE returned — the store is
 * the single authority for role floors, self-review separation, assignment
 * narrowing, publication floors, and the stale-artifact invariant. The only
 * client-side logic here is UX assistance (filtering reason codes to the ones
 * declared valid for the chosen decision, requiring edited-field names for
 * approve-with-edits); the store re-validates everything and its denial is
 * what gets rendered (ADR-0045).
 */

const IDLE: ReviewActionState = { status: "idle" };

const inputClass =
  "w-full rounded-md border border-line bg-card px-2.5 py-1.5 text-sm text-ink";
const labelClass =
  "mb-1 block text-[11px] font-medium uppercase tracking-[0.14em] text-ink-soft";
const buttonClass =
  "rounded-md bg-emerald px-3.5 py-2 text-xs font-medium text-ivory-ink transition-colors hover:bg-emerald-deep disabled:cursor-not-allowed disabled:opacity-60";

function ResultNotice({ state }: { state: ReviewActionState }) {
  if (state.status === "idle") return null;
  if (state.status === "success") {
    return (
      <p
        role="status"
        className="rounded-md bg-status-good-tint px-3 py-2 text-sm text-emerald-deep"
      >
        {state.message}
      </p>
    );
  }
  // The stale-artifact denial gets a distinct rendering: the approval stands,
  // but the artifact moved on — a new review is the only path forward.
  if (state.stale) {
    return (
      <div
        role="alert"
        className="rounded-md border-l-4 border-status-risk bg-status-risk-tint px-3 py-2.5"
      >
        <p className="text-sm font-medium text-status-risk">
          Artifact changed since approval — new review required.
        </p>
        <p className="mt-1 text-xs text-ink-soft">
          The prior approval cannot publish the changed content. The item stays approved but
          unpublished; supersede it and review the new artifact version.
        </p>
        <p className="mt-1 font-mono text-[11px] text-ink-faint">RVC_STALE_ARTIFACT</p>
      </div>
    );
  }
  return (
    <div role="alert" className="rounded-md bg-status-risk-tint px-3 py-2.5">
      <p className="text-sm font-medium text-status-risk">Denied — {state.message}</p>
      {state.inputErrors.length > 0 ? (
        <ul className="mt-1 list-disc pl-4 text-xs text-ink-soft">
          {state.inputErrors.map((err) => (
            <li key={err}>{err}</li>
          ))}
        </ul>
      ) : null}
      {state.code ? (
        <p className="mt-1 font-mono text-[11px] text-ink-faint">{state.code}</p>
      ) : null}
    </div>
  );
}

export interface DecisionOption {
  decision: string;
  label: string;
}

export interface ReasonOption {
  code: string;
  description: string;
  /** The decisions this structured code is declared valid for (kernel table). */
  decisions: string[];
}

export function DecisionForm({
  reviewItemId,
  decisionOptions,
  reasonOptions,
}: {
  reviewItemId: string;
  decisionOptions: DecisionOption[];
  reasonOptions: ReasonOption[];
}) {
  const [state, formAction, pending] = useActionState(recordReviewDecisionAction, IDLE);
  const [decision, setDecision] = useState(decisionOptions[0]?.decision ?? "");
  // UX assist only: offer the reason codes declared valid for the chosen
  // decision. The store re-validates the pairing either way.
  const validReasons = reasonOptions.filter((r) => r.decisions.includes(decision));

  return (
    <form action={formAction} className="space-y-3">
      <input type="hidden" name="reviewItemId" value={reviewItemId} />
      <label className="block">
        <span className={labelClass}>Decision</span>
        <select
          name="decision"
          value={decision}
          onChange={(e) => setDecision(e.target.value)}
          className={inputClass}
        >
          {decisionOptions.map((opt) => (
            <option key={opt.decision} value={opt.decision}>
              {opt.label}
            </option>
          ))}
        </select>
      </label>
      <label className="block">
        <span className={labelClass}>Structured reason code</span>
        <select name="decisionReasonCode" key={decision} className={inputClass}>
          {validReasons.map((r) => (
            <option key={r.code} value={r.code}>
              {r.code} — {r.description}
            </option>
          ))}
        </select>
      </label>
      {decision === "approved_with_edits" ? (
        <label className="block">
          <span className={labelClass}>Edited fields — names only, never values</span>
          <input
            name="editedFields"
            required
            maxLength={2080}
            placeholder="e.g. focusForNextQuarter, tone"
            className={inputClass}
          />
          <span className="mt-1 block text-[11px] text-ink-faint">
            Comma-separated field names — at most 32, each up to 64 characters. Content digests
            stay with the store record.
          </span>
        </label>
      ) : null}
      <label className="block">
        <span className={labelClass}>Detail (optional)</span>
        {/* UX mirror of the store's 2000-char bound — the store is the gate. */}
        <textarea name="detail" rows={2} maxLength={2000} className={inputClass} />
      </label>
      <button type="submit" disabled={pending} className={buttonClass}>
        Record decision
      </button>
      <ResultNotice state={state} />
    </form>
  );
}

export interface StaffOption {
  id: string;
  label: string;
}

export function AssignForm({
  reviewItemId,
  staffOptions,
  currentAssigneeId,
}: {
  reviewItemId: string;
  staffOptions: StaffOption[];
  currentAssigneeId: string | null;
}) {
  const [state, formAction, pending] = useActionState(assignReviewerAction, IDLE);
  return (
    <form action={formAction} className="space-y-3">
      <input type="hidden" name="reviewItemId" value={reviewItemId} />
      <label className="block">
        <span className={labelClass}>Assign reviewer</span>
        <select
          name="reviewerStaffId"
          defaultValue={currentAssigneeId ?? staffOptions[0]?.id}
          className={inputClass}
        >
          {staffOptions.map((s) => (
            <option key={s.id} value={s.id}>
              {s.label}
            </option>
          ))}
        </select>
      </label>
      <button type="submit" disabled={pending} className={buttonClass}>
        {currentAssigneeId ? "Reassign" : "Assign"}
      </button>
      <ResultNotice state={state} />
    </form>
  );
}

export function PublishControl({
  reviewItemId,
  currentVersionLabel,
}: {
  reviewItemId: string;
  /** e.g. "current artifact: v2" — provenance for the button, computed server-side. */
  currentVersionLabel: string;
}) {
  const [state, formAction, pending] = useActionState(publishReviewItemAction, IDLE);
  return (
    <form action={formAction} className="space-y-3">
      <input type="hidden" name="reviewItemId" value={reviewItemId} />
      <button type="submit" disabled={pending} className={buttonClass}>
        Publish to client
      </button>
      <p className="text-[11px] text-ink-faint">
        Publication re-checks the {currentVersionLabel} against the reviewed version and digest —
        a changed artifact is denied and needs a fresh review.
      </p>
      <ResultNotice state={state} />
    </form>
  );
}
