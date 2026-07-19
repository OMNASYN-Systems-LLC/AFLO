import type { OpportunityCategory, SafeOpportunitySummary } from "@aflo/opportunity-intelligence";

/**
 * A surfaced opportunity notice for one client — the store's read-model over
 * `@aflo/opportunity-intelligence`. Surface-worthiness only; never an
 * eligibility determination. Legal/claims notices (`requiresReview`) are shown
 * to STAFF but carry no `clientSafe` projection until a staff member approves —
 * the human-review gate (roadmap §4).
 */
export interface ClientOpportunity {
  noticeId: string;
  category: OpportunityCategory;
  /** Staff-facing title (not the client-facing text). */
  title: string;
  reasonCodes: string[];
  /** True for legal/claims notices — never auto-surfaced to a client. */
  requiresReview: boolean;
  /**
   * The validated, hedged client-facing projection — present ONLY when the
   * notice is not review-required (and it rendered safe). Null for
   * review-required notices, which staff must approve first.
   */
  clientSafe: SafeOpportunitySummary | null;
  /** Official source deep link (staff context). */
  sourceUrl: string;
}
