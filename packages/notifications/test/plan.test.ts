import { describe, expect, it } from "vitest";
import {
  MockNotificationProvider,
  planNotification,
  type ConsentRecord,
} from "../src";

const consented: ConsentRecord[] = [
  { userId: "u-bell", consentType: "communication", granted: true, recordedAt: "2026-01-01T00:00:00.000Z" },
];
const revoked: ConsentRecord[] = [
  { userId: "u-bell", consentType: "communication", granted: true, recordedAt: "2026-01-01T00:00:00.000Z" },
  { userId: "u-bell", consentType: "communication", granted: false, recordedAt: "2026-06-01T00:00:00.000Z" },
];

describe("planNotification", () => {
  it("queues a rendered message when consent is active", () => {
    const planned = planNotification({
      type: "roadmap_published",
      recipientUserId: "u-bell",
      vars: { firstName: "Marcus", roadmapTitle: "Recovery" },
      consentRecords: consented,
    });
    expect(planned.status).toBe("queued");
    expect(planned.suppressionReason).toBeNull();
    expect(planned.message?.subject).toBe("Your roadmap is ready");
  });

  it("suppresses (no content) when consent is absent or revoked", () => {
    const noConsent = planNotification({
      type: "roadmap_published",
      recipientUserId: "u-bell",
      vars: { firstName: "Marcus", roadmapTitle: "Recovery" },
      consentRecords: [],
    });
    expect(noConsent).toMatchObject({ status: "suppressed", suppressionReason: "NO_COMMUNICATION_CONSENT", message: null });

    const afterRevoke = planNotification({
      type: "report_published",
      recipientUserId: "u-bell",
      vars: { firstName: "Marcus", quarter: "2026-Q2" },
      consentRecords: revoked,
    });
    expect(afterRevoke.status).toBe("suppressed");
    expect(afterRevoke.message).toBeNull();
  });
});

describe("MockNotificationProvider", () => {
  it("records sends and returns a deterministic receipt, never sending externally", async () => {
    const provider = new MockNotificationProvider();
    const planned = planNotification({
      type: "appointment_scheduled",
      recipientUserId: "u-bell",
      vars: { firstName: "Marcus", when: "Tue 4pm", advisorName: "Andre" },
      consentRecords: consented,
    });
    expect(planned.status).toBe("queued");
    const receipt = await provider.send({ recipientUserId: "u-bell", message: planned.message! });
    expect(receipt).toMatchObject({ ok: true, providerMessageId: "mock-1", error: null });
    expect(provider.sent).toHaveLength(1);
    expect(provider.name).toBe("mock");
  });
});
