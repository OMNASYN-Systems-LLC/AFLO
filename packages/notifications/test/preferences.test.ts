import { describe, expect, it } from "vitest";
import {
  isChannelEnabled,
  resolveDelivery,
  type ConsentRecord,
  type NotificationPreferenceRecord,
} from "../src";

const consent: ConsentRecord[] = [
  { userId: "u1", consentType: "communication", granted: true, recordedAt: "2026-01-01T00:00:00.000Z" },
];

describe("isChannelEnabled", () => {
  it("uses the type's default routing when no preference exists", () => {
    // appointment_scheduled defaults to in_app + email + sms.
    expect(isChannelEnabled([], "u1", "appointment_scheduled", "sms")).toBe(true);
    // task_assigned defaults to in_app only.
    expect(isChannelEnabled([], "u1", "task_assigned", "email")).toBe(false);
    expect(isChannelEnabled([], "u1", "task_assigned", "in_app")).toBe(true);
  });

  it("honors the latest preference record (revocable, latest-wins)", () => {
    const prefs: NotificationPreferenceRecord[] = [
      { userId: "u1", notificationType: "appointment_scheduled", channel: "sms", enabled: false, recordedAt: "2026-02-01T00:00:00.000Z" },
      { userId: "u1", notificationType: "appointment_scheduled", channel: "sms", enabled: true, recordedAt: "2026-05-01T00:00:00.000Z" },
    ];
    expect(isChannelEnabled(prefs, "u1", "appointment_scheduled", "sms")).toBe(true);
    const disabled = [prefs[0]!, { ...prefs[1]!, enabled: false, recordedAt: "2026-06-01T00:00:00.000Z" }];
    expect(isChannelEnabled(disabled, "u1", "appointment_scheduled", "sms")).toBe(false);
  });

  it("can enable a non-default channel via an explicit preference", () => {
    const prefs: NotificationPreferenceRecord[] = [
      { userId: "u1", notificationType: "task_assigned", channel: "email", enabled: true, recordedAt: "2026-03-01T00:00:00.000Z" },
    ];
    expect(isChannelEnabled(prefs, "u1", "task_assigned", "email")).toBe(true);
  });

  it("rejects invalid timestamps (fail closed)", () => {
    expect(() =>
      isChannelEnabled(
        [{ userId: "u1", notificationType: "task_assigned", channel: "in_app", enabled: true, recordedAt: "later" }],
        "u1",
        "task_assigned",
        "in_app",
      ),
    ).toThrow(/invalid timestamp/);
  });
});

describe("resolveDelivery — enforced before send", () => {
  it("sends on all default channels when consent is active and nothing disabled", () => {
    const out = resolveDelivery("appointment_scheduled", "u1", [], consent);
    expect(out.map((d) => d.channel)).toEqual(["in_app", "email", "sms"]);
    expect(out.every((d) => d.willSend)).toBe(true);
  });

  it("withholds external channels without communication consent, but keeps in-app", () => {
    const out = resolveDelivery("appointment_scheduled", "u1", [], []);
    const byChannel = Object.fromEntries(out.map((d) => [d.channel, d]));
    expect(byChannel.in_app).toMatchObject({ willSend: true, reason: null });
    expect(byChannel.email).toMatchObject({ willSend: false, reason: "NO_COMMUNICATION_CONSENT" });
    expect(byChannel.sms).toMatchObject({ willSend: false, reason: "NO_COMMUNICATION_CONSENT" });
  });

  it("withholds a channel the user disabled, recording the reason", () => {
    const prefs: NotificationPreferenceRecord[] = [
      { userId: "u1", notificationType: "appointment_scheduled", channel: "sms", enabled: false, recordedAt: "2026-05-01T00:00:00.000Z" },
    ];
    const out = resolveDelivery("appointment_scheduled", "u1", prefs, consent);
    const sms = out.find((d) => d.channel === "sms")!;
    expect(sms).toMatchObject({ willSend: false, reason: "CHANNEL_DISABLED" });
    // The other channels still send.
    expect(out.find((d) => d.channel === "email")?.willSend).toBe(true);
  });
});
