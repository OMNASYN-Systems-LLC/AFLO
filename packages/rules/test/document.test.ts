import { describe, expect, it } from "vitest";
import {
  DOCUMENT_RULES_VERSION,
  documentTransition,
  documentTransitionsFrom,
} from "../src/document";

describe("documentTransition", () => {
  it("allows the review path with naming reason codes", () => {
    expect(documentTransition("requested", "uploaded")).toMatchObject({
      allowed: true,
      reasonCode: "DOC_UPLOADED",
      ruleVersion: DOCUMENT_RULES_VERSION,
    });
    expect(documentTransition("uploaded", "in_review").reasonCode).toBe("DOC_REVIEW_STARTED");
    expect(documentTransition("in_review", "approved").reasonCode).toBe("DOC_APPROVED");
    expect(documentTransition("in_review", "needs_attention").reasonCode).toBe("DOC_FLAGGED");
    expect(documentTransition("needs_attention", "uploaded").reasonCode).toBe("DOC_RESUBMITTED");
  });

  it("denies skipping review and any move out of approved", () => {
    expect(documentTransition("requested", "approved")).toMatchObject({
      allowed: false,
      reasonCode: "DOC_ILLEGAL_TRANSITION",
    });
    expect(documentTransition("uploaded", "approved").allowed).toBe(false);
    expect(documentTransition("approved", "in_review").allowed).toBe(false);
    expect(documentTransition("approved", "needs_attention").allowed).toBe(false);
  });

  it("denies same-status and unknown statuses", () => {
    expect(documentTransition("uploaded", "uploaded").reasonCode).toBe("DOC_SAME_STATUS");
    expect(documentTransition("uploaded", "shredded").reasonCode).toBe("DOC_UNKNOWN_STATUS");
  });

  it("exposes only legal targets for UI action rendering", () => {
    expect(documentTransitionsFrom("in_review").sort()).toEqual(["approved", "needs_attention"]);
    expect(documentTransitionsFrom("approved")).toEqual([]);
  });
});
