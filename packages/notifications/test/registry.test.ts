import { describe, expect, it } from "vitest";
import {
  DELIVERY_STATUS_COUNT,
  DELIVERY_STATUSES,
  NOTIFICATION_RULE,
  NOTIFICATION_RULES_VERSION,
  NOTIFICATION_TYPE_COUNT,
  NOTIFICATION_TYPES,
} from "../src";

describe("notification rule registry", () => {
  it("stays in lockstep with the implementation version", () => {
    expect(NOTIFICATION_RULE.version).toBe(NOTIFICATION_RULES_VERSION);
    expect(NOTIFICATION_RULE.changeHistory.at(-1)?.version).toBe(NOTIFICATION_RULES_VERSION);
  });

  it("carries complete metadata", () => {
    expect(NOTIFICATION_RULE.id).toMatch(/^[a-z_]+\.[a-z_]+$/);
    expect(NOTIFICATION_RULE.description.length).toBeGreaterThan(20);
    expect(NOTIFICATION_RULE.inputs.length).toBeGreaterThan(0);
    expect(NOTIFICATION_RULE.reasonCodes).toContain("NO_COMMUNICATION_CONSENT");
    expect(NOTIFICATION_RULE.reasonCodes).toContain("DL_ILLEGAL_TRANSITION");
  });

  it("counts match the exported catalogs (addition trips this test)", () => {
    expect(NOTIFICATION_TYPE_COUNT).toBe(NOTIFICATION_TYPES.length);
    expect(DELIVERY_STATUS_COUNT).toBe(DELIVERY_STATUSES.length);
    expect(NOTIFICATION_TYPE_COUNT).toBe(5);
    expect(DELIVERY_STATUS_COUNT).toBe(6);
  });
});
