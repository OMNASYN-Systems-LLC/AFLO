import { createHmac } from "node:crypto";

import { describe, expect, it } from "vitest";

import {
  InMemoryWebhookDedupe,
  parseWebhookEvent,
  verifyWebhook,
  WebhookVerificationError,
  type WebhookEventRecord,
  type WebhookHeaders,
} from "../src/webhook";

const SECRET = `whsec_${Buffer.from("golden-key-test-signing-key-000000").toString("base64")}`;
const NOW = 1_700_000_000; // fixed test clock, Unix seconds

function sign(payload: string, id: string, ts: number, secret = SECRET): string {
  const key = Buffer.from(secret.slice("whsec_".length), "base64");
  const sig = createHmac("sha256", key).update(`${id}.${ts}.${payload}`, "utf8").digest("base64");
  return `v1,${sig}`;
}

function headers(payload: string, opts: { id?: string; ts?: number; signature?: string } = {}): WebhookHeaders {
  const id = opts.id ?? "msg_1";
  const ts = opts.ts ?? NOW;
  return {
    "svix-id": id,
    "svix-timestamp": String(ts),
    "svix-signature": opts.signature ?? sign(payload, id, ts),
  };
}

const EVENT = JSON.stringify({ type: "user.created", data: { id: "user_abc", email_addresses: [] } });

function verify(payload: string, h: WebhookHeaders, extra: { nowSeconds?: number; secret?: string } = {}) {
  return verifyWebhook({ payload, headers: h, secret: extra.secret ?? SECRET, nowSeconds: extra.nowSeconds ?? NOW });
}

function reason(fn: () => unknown): string {
  try {
    fn();
  } catch (err) {
    if (err instanceof WebhookVerificationError) return err.reason;
    throw err;
  }
  throw new Error("expected WebhookVerificationError, none thrown");
}

describe("verifyWebhook — accepts a genuine signature", () => {
  it("verifies a correctly signed payload and returns the parsed event", () => {
    const result = verify(EVENT, headers(EVENT));
    expect(result.id).toBe("msg_1");
    expect(result.timestamp).toBe(NOW);
    expect(result.event).toEqual({ type: "user.created", data: { id: "user_abc", email_addresses: [] } });
  });

  it("accepts a timestamp within tolerance and one of several signatures", () => {
    expect(verify(EVENT, headers(EVENT, { ts: NOW - 200 }), { nowSeconds: NOW }).id).toBe("msg_1");
    const good = sign(EVENT, "msg_1", NOW).split(",")[1];
    const multi = `v1,ZmFrZQ== v1,${good}`; // one bogus + the real one
    expect(verify(EVENT, headers(EVENT, { signature: multi })).id).toBe("msg_1");
  });
});

describe("verifyWebhook — fails closed", () => {
  it("rejects a tampered body", () => {
    const h = headers(EVENT); // signed over EVENT
    expect(reason(() => verify(`${EVENT} `, h))).toBe("signature_mismatch");
  });

  it("rejects a signature made with the wrong secret", () => {
    const otherSecret = `whsec_${Buffer.from("a-different-signing-key-99999999").toString("base64")}`;
    const h = headers(EVENT, { signature: sign(EVENT, "msg_1", NOW, otherSecret) });
    expect(reason(() => verify(EVENT, h))).toBe("signature_mismatch");
  });

  it("rejects missing headers", () => {
    expect(reason(() => verify(EVENT, { "svix-id": null, "svix-timestamp": String(NOW), "svix-signature": "v1,x" }))).toBe(
      "missing_headers",
    );
    expect(reason(() => verify(EVENT, { "svix-id": "msg_1", "svix-timestamp": "", "svix-signature": "v1,x" }))).toBe(
      "missing_headers",
    );
  });

  it("rejects a non-integer or out-of-tolerance timestamp", () => {
    expect(reason(() => verify(EVENT, { ...headers(EVENT), "svix-timestamp": "notanumber" }))).toBe("invalid_timestamp");
    // Non-canonical numeric forms are rejected outright (not left to signature mismatch).
    for (const bad of ["1.7e9", "+1700000000", " 1700000000 ", "0x65517d00"]) {
      expect(reason(() => verify(EVENT, { ...headers(EVENT), "svix-timestamp": bad }))).toBe("invalid_timestamp");
    }
    expect(reason(() => verify(EVENT, headers(EVENT, { ts: NOW - 400 })))).toBe("timestamp_out_of_tolerance");
    expect(reason(() => verify(EVENT, headers(EVENT, { ts: NOW + 400 })))).toBe("timestamp_out_of_tolerance");
  });

  it("rejects when no v1 signature is present", () => {
    expect(reason(() => verify(EVENT, headers(EVENT, { signature: "v2,abc" })))).toBe("no_signatures");
    expect(reason(() => verify(EVENT, headers(EVENT, { signature: "garbage" })))).toBe("no_signatures");
  });

  it("rejects a malformed secret", () => {
    expect(reason(() => verify(EVENT, headers(EVENT), { secret: "whsec_" }))).toBe("malformed_secret");
  });
});

describe("parseWebhookEvent", () => {
  it("parses each handled event type", () => {
    for (const type of [
      "user.created",
      "user.updated",
      "user.deleted",
      "organization.created",
      "organization.updated",
      "organizationMembership.created",
      "organizationMembership.updated",
      "organizationMembership.deleted",
    ]) {
      const evt = parseWebhookEvent(JSON.stringify({ type, data: { id: "x" } }));
      expect(evt.type).toBe(type);
    }
  });

  it("surfaces an unknown type as unhandled, never throwing", () => {
    const evt = parseWebhookEvent(JSON.stringify({ type: "session.created", data: { id: "s" } }));
    expect(evt).toEqual({ type: "unhandled", rawType: "session.created", data: { id: "s" } });
  });

  it("treats non-JSON or shapeless payloads as unhandled", () => {
    expect(parseWebhookEvent("not json").type).toBe("unhandled");
    expect(parseWebhookEvent(JSON.stringify({ noType: true })).type).toBe("unhandled");
  });
});

describe("idempotency", () => {
  it("processes a given svix-id only once", () => {
    const store = new InMemoryWebhookDedupe();
    const rec: WebhookEventRecord = { id: "msg_42", type: "user.created", receivedAtIso: "2026-07-19T00:00:00Z", status: "processed" };
    expect(store.has("msg_42")).toBe(false);
    store.mark(rec);
    expect(store.has("msg_42")).toBe(true); // a redelivery with the same id is skipped
    store.mark(rec); // marking again is a no-op on count
    expect(store.size).toBe(1);
    expect(store.get("msg_42")?.status).toBe("processed");
  });
});
