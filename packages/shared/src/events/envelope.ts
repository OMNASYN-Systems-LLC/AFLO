import { AGGREGATE_TYPES, EVENT_AGGREGATE, EVENT_TYPES, EVENT_VERSIONS, type AggregateType, type EventType } from "./catalog";
import type { EventPayloadMap } from "./payloads";

/**
 * The domain event envelope every AFLO event carries (charter event model).
 * Envelopes are immutable business facts; they are persisted to the outbox
 * in the same transaction as the state change they describe.
 */
export interface DomainEvent<T extends EventType = EventType> {
  /** UUID of this event — also the outbox idempotency anchor. */
  eventId: string;
  eventType: T;
  /** Schema version of the payload (EVENT_VERSIONS[eventType] at creation). */
  eventVersion: number;
  organizationId: string;
  aggregateType: AggregateType;
  aggregateId: string;
  /** organization_members id, users id for platform actors, or null for system-initiated. */
  actorId: string | null;
  occurredAt: string; // ISO datetime
  /** Groups every event in one causal chain (e.g. one user action). Roots use their own eventId. */
  correlationId: string;
  /** eventId of the direct cause; null for chain roots. */
  causationId: string | null;
  payload: EventPayloadMap[T];
}

export interface CreateEventInput<T extends EventType> {
  eventType: T;
  organizationId: string;
  aggregateId: string;
  payload: EventPayloadMap[T];
  actorId?: string | null;
  /** Omit for a chain root (defaults to this event's own id). */
  correlationId?: string;
  causationId?: string | null;
  /** Injectable for deterministic tests; defaults to crypto.randomUUID(). */
  eventId?: string;
  /** Injectable for deterministic tests; defaults to now. */
  occurredAt?: string;
}

/**
 * Create a validated domain event. The aggregate type is derived from the
 * catalog — callers cannot attach an event to the wrong aggregate kind.
 * Throws on structural invalidity (fail closed; never emit a malformed fact).
 */
export function createEvent<T extends EventType>(input: CreateEventInput<T>): DomainEvent<T> {
  const eventId = input.eventId ?? crypto.randomUUID();
  const event: DomainEvent<T> = {
    eventId,
    eventType: input.eventType,
    eventVersion: EVENT_VERSIONS[input.eventType],
    organizationId: input.organizationId,
    aggregateType: EVENT_AGGREGATE[input.eventType],
    aggregateId: input.aggregateId,
    actorId: input.actorId ?? null,
    occurredAt: input.occurredAt ?? new Date().toISOString(),
    correlationId: input.correlationId ?? eventId,
    causationId: input.causationId ?? null,
    payload: input.payload,
  };
  const errors = validateEvent(event);
  if (errors.length > 0) {
    throw new TypeError(`createEvent: invalid ${input.eventType} event: ${errors.join("; ")}`);
  }
  return event;
}

/** Structural validation. Returns human-readable problems; empty = valid. */
export function validateEvent(event: DomainEvent): string[] {
  const errors: string[] = [];
  if (!event.eventId) errors.push("eventId is required");
  if (!(EVENT_TYPES as readonly string[]).includes(event.eventType)) {
    errors.push(`unknown eventType "${event.eventType}"`);
  } else {
    if (event.eventVersion !== EVENT_VERSIONS[event.eventType]) {
      errors.push(
        `eventVersion ${event.eventVersion} does not match current schema version ${EVENT_VERSIONS[event.eventType]}`,
      );
    }
    if (event.aggregateType !== EVENT_AGGREGATE[event.eventType]) {
      errors.push(
        `aggregateType "${event.aggregateType}" invalid for ${event.eventType} (expected "${EVENT_AGGREGATE[event.eventType]}")`,
      );
    }
  }
  if (!(AGGREGATE_TYPES as readonly string[]).includes(event.aggregateType)) {
    errors.push(`unknown aggregateType "${event.aggregateType}"`);
  }
  if (!event.organizationId) errors.push("organizationId is required (tenant scoping)");
  if (!event.aggregateId) errors.push("aggregateId is required");
  if (!event.correlationId) errors.push("correlationId is required");
  if (event.actorId !== null && !event.actorId) errors.push("actorId must be a non-empty id or null");
  if (Number.isNaN(Date.parse(event.occurredAt))) errors.push(`occurredAt "${event.occurredAt}" is not a valid ISO datetime`);
  if (event.payload === null || typeof event.payload !== "object") errors.push("payload must be an object");
  return errors;
}

/**
 * Serialize for outbox storage (deterministic key order at every depth for
 * stable idempotency hashing and diffs). A replacer key-array would drop
 * nested payload keys — sort recursively instead.
 */
export function serializeEvent(event: DomainEvent): string {
  return JSON.stringify(sortKeysDeep(event));
}

function sortKeysDeep(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(sortKeysDeep);
  if (value !== null && typeof value === "object") {
    return Object.fromEntries(
      Object.entries(value as Record<string, unknown>)
        .sort(([a], [b]) => a.localeCompare(b))
        .map(([k, v]) => [k, sortKeysDeep(v)]),
    );
  }
  return value;
}

/** Parse + validate an event from outbox storage; throws on invalid input. */
export function deserializeEvent(json: string): DomainEvent {
  let parsed: unknown;
  try {
    parsed = JSON.parse(json);
  } catch {
    throw new TypeError("deserializeEvent: not valid JSON");
  }
  const event = parsed as DomainEvent;
  const errors = validateEvent(event);
  if (errors.length > 0) {
    throw new TypeError(`deserializeEvent: invalid event: ${errors.join("; ")}`);
  }
  return event;
}
