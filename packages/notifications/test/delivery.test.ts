import { describe, expect, it } from "vitest";
import { deliveryTransition, NOTIFICATION_RULES_VERSION } from "../src";

describe("deliveryTransition", () => {
  it("allows the provider lifecycle with naming reason codes", () => {
    expect(deliveryTransition("queued", "sent")).toMatchObject({
      allowed: true,
      reasonCode: "DL_SENT",
      ruleVersion: NOTIFICATION_RULES_VERSION,
    });
    expect(deliveryTransition("sent", "delivered").reasonCode).toBe("DL_DELIVERED");
    expect(deliveryTransition("sent", "bounced").reasonCode).toBe("DL_BOUNCED");
    expect(deliveryTransition("queued", "failed").reasonCode).toBe("DL_FAILED");
    expect(deliveryTransition("failed", "queued").reasonCode).toBe("DL_RETRIED");
  });

  it("keeps suppressed and delivered/bounced terminal", () => {
    for (const to of ["queued", "sent", "delivered"]) {
      expect(deliveryTransition("suppressed", to).allowed).toBe(false);
      expect(deliveryTransition("delivered", to).allowed).toBe(false);
    }
    expect(deliveryTransition("bounced", "queued").allowed).toBe(false);
  });

  it("denies skipping the sent step and unknown/same statuses", () => {
    expect(deliveryTransition("queued", "delivered").reasonCode).toBe("DL_ILLEGAL_TRANSITION");
    expect(deliveryTransition("queued", "queued").reasonCode).toBe("DL_SAME_STATUS");
    expect(deliveryTransition("queued", "opened").reasonCode).toBe("DL_UNKNOWN_STATUS");
  });
});
