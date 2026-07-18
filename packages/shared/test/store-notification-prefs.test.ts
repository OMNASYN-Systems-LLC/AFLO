import { describe, expect, it } from "vitest";
import { AfloStore } from "../src/store";
import { syntheticDatabase } from "../src/data/synthetic";

const ORG = syntheticDatabase.organization.id;
const NOW = new Date("2026-07-18T12:00:00.000Z");

function makeStore() {
  return new AfloStore(syntheticDatabase, () => NOW);
}

describe("notification preferences — enforced before send", () => {
  it("honors a seeded channel opt-out (Grant disabled appointment SMS)", () => {
    const store = makeStore();
    store.scheduleAppointment({
      organizationId: ORG,
      clientId: "c-grant",
      purpose: "Refinance review",
      scheduledAt: "2026-07-25T15:00:00.000Z",
      channel: "video",
      actorStaffId: "s-mercer",
    });
    const comms = store.communicationsFor(ORG, "c-grant");
    const byChannel = Object.fromEntries(comms.map((c) => [c.channel, c]));
    // appointment_scheduled routes to in_app + email + sms; Grant disabled sms.
    expect(byChannel.in_app?.status).toBe("sent");
    expect(byChannel.email?.status).toBe("sent");
    expect(byChannel.sms).toMatchObject({ status: "suppressed", suppressionReason: "CHANNEL_DISABLED" });
  });

  it("a staff-set preference takes effect on the next send", () => {
    const store = makeStore();
    // Disable email for document requests for Tanya Okafor (consented).
    const res = store.setNotificationPreference({
      organizationId: ORG,
      clientId: "c-okafor",
      notificationType: "document_requested",
      channel: "email",
      enabled: false,
      actorStaffId: "s-mercer",
    });
    expect(res.ok).toBe(true);
    expect(store.auditFor(ORG).at(-1)?.action).toBe("notification_preference.set");

    store.requestDocument({
      organizationId: ORG,
      clientId: "c-okafor",
      name: "Statement",
      docType: "bank_statement",
      actorStaffId: "s-mercer",
    });
    const email = store.communicationsFor(ORG, "c-okafor").find((c) => c.channel === "email");
    expect(email).toMatchObject({ status: "suppressed", suppressionReason: "CHANNEL_DISABLED" });
    // In-app still delivered.
    expect(store.communicationsFor(ORG, "c-okafor").find((c) => c.channel === "in_app")?.status).toBe("sent");
  });

  it("re-enabling a channel restores delivery (latest-wins, revocable)", () => {
    const store = makeStore();
    store.setNotificationPreference({ organizationId: ORG, clientId: "c-grant", notificationType: "appointment_scheduled", channel: "sms", enabled: true, actorStaffId: "s-mercer" });
    store.scheduleAppointment({ organizationId: ORG, clientId: "c-grant", purpose: "x", scheduledAt: "2026-07-26T15:00:00.000Z", channel: "phone", actorStaffId: "s-mercer" });
    expect(store.communicationsFor(ORG, "c-grant").find((c) => c.channel === "sms")?.status).toBe("sent");
  });

  it("enforces tenant and actor isolation", () => {
    const store = makeStore();
    expect(
      store.setNotificationPreference({ organizationId: "org-other", clientId: "c-grant", notificationType: "task_assigned", channel: "email", enabled: true, actorStaffId: "s-mercer" }),
    ).toMatchObject({ ok: false, denialCode: "CLIENT_NOT_FOUND" });
    expect(
      store.setNotificationPreference({ organizationId: ORG, clientId: "c-grant", notificationType: "task_assigned", channel: "email", enabled: true, actorStaffId: "s-intruder" }),
    ).toMatchObject({ ok: false, denialCode: "ACTOR_NOT_IN_ORG" });
  });

  it("never mutates the module-level seed", () => {
    const store = makeStore();
    store.setNotificationPreference({ organizationId: ORG, clientId: "c-grant", notificationType: "task_assigned", channel: "email", enabled: true, actorStaffId: "s-mercer" });
    expect(syntheticDatabase.notificationPreferences).toHaveLength(1);
  });
});
