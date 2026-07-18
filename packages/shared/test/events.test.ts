import { describe, expect, it } from "vitest";
import {
  AGGREGATE_TYPES,
  createEvent,
  deserializeEvent,
  EVENT_AGGREGATE,
  EVENT_TYPES,
  EVENT_VERSIONS,
  serializeEvent,
  validateEvent,
  type DomainEvent,
} from "../src/events";

const BASE = {
  organizationId: "org-golden-key",
  actorId: "s-mercer",
  eventId: "11111111-1111-4111-8111-111111111111",
  occurredAt: "2026-07-18T12:00:00.000Z",
} as const;

function leadCreated() {
  return createEvent({
    ...BASE,
    eventType: "LeadCreated",
    aggregateId: "l-cole",
    payload: { leadId: "l-cole", pipelineStatus: "new_lead", source: "referral" },
  });
}

describe("event catalog", () => {
  it("defines all 25 charter lifecycle events exactly once", () => {
    expect(EVENT_TYPES).toHaveLength(25);
    expect(new Set(EVENT_TYPES).size).toBe(25);
  });

  it("maps every event to a known aggregate type and version 1", () => {
    for (const type of EVENT_TYPES) {
      expect(AGGREGATE_TYPES).toContain(EVENT_AGGREGATE[type]);
      expect(EVENT_VERSIONS[type]).toBe(1);
    }
  });
});

describe("createEvent", () => {
  it("builds a valid envelope with derived aggregate type and version", () => {
    const e = leadCreated();
    expect(e.aggregateType).toBe("lead");
    expect(e.eventVersion).toBe(1);
    expect(e.organizationId).toBe("org-golden-key");
    expect(validateEvent(e)).toEqual([]);
  });

  it("defaults correlationId to its own eventId for chain roots", () => {
    const e = leadCreated();
    expect(e.correlationId).toBe(e.eventId);
    expect(e.causationId).toBeNull();
  });

  it("threads correlation and causation for downstream events", () => {
    const root = leadCreated();
    const next = createEvent({
      ...BASE,
      eventId: "22222222-2222-4222-8222-222222222222",
      eventType: "LeadStatusChanged",
      aggregateId: "l-cole",
      correlationId: root.correlationId,
      causationId: root.eventId,
      payload: { leadId: "l-cole", fromStatus: "new_lead", toStatus: "contacted", reasonCode: "PL_OK" },
    });
    expect(next.correlationId).toBe(root.eventId);
    expect(next.causationId).toBe(root.eventId);
  });

  it("defaults actorId to null for system-initiated events", () => {
    const e = createEvent({
      eventType: "EngagementRiskDetected",
      organizationId: "org-golden-key",
      aggregateId: "c-ngo",
      eventId: "33333333-3333-4333-8333-333333333333",
      occurredAt: BASE.occurredAt,
      payload: {
        clientId: "c-ngo",
        engagementStatus: "dormant",
        daysSinceLastActivity: 72,
        ruleVersion: "engagement.v1.0.0",
      },
    });
    expect(e.actorId).toBeNull();
  });

  it("rejects a tenant-less event (fail closed)", () => {
    expect(() =>
      createEvent({
        ...BASE,
        organizationId: "",
        eventType: "LeadCreated",
        aggregateId: "l-x",
        payload: { leadId: "l-x", pipelineStatus: "new_lead", source: null },
      }),
    ).toThrow(/organizationId is required/);
  });
});

describe("validateEvent", () => {
  it("flags unknown types, wrong aggregate, bad version, and bad timestamps", () => {
    const good = leadCreated();
    expect(validateEvent({ ...good, eventType: "Nope" as never })).toContainEqual(
      expect.stringContaining("unknown eventType"),
    );
    expect(validateEvent({ ...good, aggregateType: "client" })).toContainEqual(
      expect.stringContaining('invalid for LeadCreated'),
    );
    expect(validateEvent({ ...good, eventVersion: 2 })).toContainEqual(
      expect.stringContaining("does not match current schema version"),
    );
    expect(validateEvent({ ...good, occurredAt: "yesterday" })).toContainEqual(
      expect.stringContaining("not a valid ISO datetime"),
    );
  });
});

describe("serialization round-trip", () => {
  it("round-trips an event losslessly", () => {
    const e = leadCreated();
    const back = deserializeEvent(serializeEvent(e));
    expect(back).toEqual(e);
  });

  it("serializes with deterministic key order (stable idempotency hashing)", () => {
    const e = leadCreated();
    expect(serializeEvent(e)).toBe(serializeEvent({ ...e }));
  });

  it("rejects malformed JSON and structurally invalid events", () => {
    expect(() => deserializeEvent("{not json")).toThrow(/not valid JSON/);
    const bad: DomainEvent = { ...leadCreated(), organizationId: "" };
    expect(() => deserializeEvent(JSON.stringify(bad))).toThrow(/organizationId is required/);
  });
});
