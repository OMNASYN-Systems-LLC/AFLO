import { describe, expect, it } from "vitest";
import {
  getTemplate,
  NOTIFICATION_TYPES,
  renderNotification,
} from "../src";

describe("template registry", () => {
  it("every notification type requires communication consent on the email channel", () => {
    for (const type of NOTIFICATION_TYPES) {
      const t = getTemplate(type);
      expect(t.channel).toBe("email");
      expect(t.requiresConsent).toBe("communication");
    }
  });

  it("renders deterministic content from typed variables", () => {
    const msg = renderNotification("appointment_scheduled", {
      firstName: "Marcus",
      when: "Tuesday at 4:00 PM",
      advisorName: "Andre Boyd",
    });
    expect(msg.subject).toBe("Your appointment is confirmed");
    expect(msg.body).toContain("Marcus");
    expect(msg.body).toContain("Andre Boyd");
    expect(msg.body).toContain("Tuesday at 4:00 PM");
    // Stable across calls.
    expect(renderNotification("appointment_scheduled", {
      firstName: "Marcus",
      when: "Tuesday at 4:00 PM",
      advisorName: "Andre Boyd",
    })).toEqual(msg);
  });

  it("interpolates the quarter into the report subject", () => {
    const msg = renderNotification("report_published", { firstName: "Renee", quarter: "2026-Q2" });
    expect(msg.subject).toBe("Your 2026-Q2 progress report is available");
  });

  it("fails closed on a missing or blank variable — never a half-populated message", () => {
    expect(() =>
      renderNotification("task_assigned", { firstName: "", taskTitle: "Upload statement", dueDate: "Jul 30" }),
    ).toThrow(/"firstName" is required/);
    expect(() =>
      renderNotification("document_requested", { firstName: "Tanya", documentName: "   " }),
    ).toThrow(/"documentName" is required/);
  });
});
