import type { RenderedMessage } from "./templates";

/**
 * Delivery provider boundary. Resend is the production provider (charter);
 * activation is founder-gated on credentials. Dev/preview always use the
 * mock provider — no external send, deterministic, fully testable.
 */

export interface DeliveryRequest {
  recipientUserId: string;
  message: RenderedMessage;
}

export interface DeliveryReceipt {
  ok: boolean;
  /** Provider message id (synthetic for the mock). */
  providerMessageId: string;
  error: string | null;
}

export interface NotificationProvider {
  readonly name: string;
  send(request: DeliveryRequest): Promise<DeliveryReceipt>;
}

/**
 * In-memory provider for the synthetic prototype: records every send and
 * returns a deterministic receipt. Never contacts an external service. The
 * Resend-backed provider implements the same interface when credentials land.
 */
export class MockNotificationProvider implements NotificationProvider {
  readonly name = "mock";
  readonly sent: DeliveryRequest[] = [];
  private counter = 0;

  async send(request: DeliveryRequest): Promise<DeliveryReceipt> {
    this.counter += 1;
    this.sent.push(request);
    return { ok: true, providerMessageId: `mock-${this.counter}`, error: null };
  }
}
