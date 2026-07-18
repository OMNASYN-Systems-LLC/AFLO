import { describe, expect, it } from "vitest";
import { ACTION_RULES_VERSION, actionTransition } from "../src/action";

describe("actionTransition", () => {
  it("allows the working path with naming reason codes", () => {
    expect(actionTransition("todo", "in_progress")).toMatchObject({
      allowed: true,
      reasonCode: "AC_STARTED",
      ruleVersion: ACTION_RULES_VERSION,
    });
    expect(actionTransition("in_progress", "done").reasonCode).toBe("AC_COMPLETED");
    expect(actionTransition("todo", "done").reasonCode).toBe("AC_COMPLETED");
    expect(actionTransition("in_progress", "todo").reasonCode).toBe("AC_PAUSED");
  });

  it("flags reopening a completed action distinctly", () => {
    expect(actionTransition("done", "todo").reasonCode).toBe("AC_REOPENED");
    expect(actionTransition("done", "in_progress").reasonCode).toBe("AC_REOPENED");
  });

  it("denies same-status and unknown statuses", () => {
    expect(actionTransition("todo", "todo")).toMatchObject({
      allowed: false,
      reasonCode: "AC_SAME_STATUS",
    });
    expect(actionTransition("todo", "cancelled").reasonCode).toBe("AC_UNKNOWN_STATUS");
    expect(actionTransition("blocked", "done").reasonCode).toBe("AC_UNKNOWN_STATUS");
  });
});
