/**
 * Typed failures for the integrations boundary (integrations.v1.0.0).
 *
 * These exist so that a regulated code path CANNOT silently reach an external
 * provider that AFLO has not contracted. Every guarded path throws one of
 * these instead of fabricating data, implying a partnership, or invoking an
 * integration that does not yet exist. They are the fail-CLOSED signal.
 */

/**
 * Thrown when code asks the registry to enable/use a vendor that is not in a
 * `production` + enabled state. This is the default outcome for every vendor
 * in V1 — no external vendor is contracted or enabled.
 */
export class VendorNotEnabledError extends Error {
  constructor(
    public readonly vendorId: string,
    public readonly status: string,
  ) {
    super(
      `vendor "${vendorId}" is not enabled (status: ${status}). No external vendor may be used ` +
        `until a reviewed agreement, sandbox credentials, and compliance sign-off exist.`,
    );
    this.name = "VendorNotEnabledError";
  }
}

/**
 * Thrown by a provider adapter (e.g. the Experian credit-data adapter) when it
 * is invoked while not contracted. The adapter conforms to the AFLO-owned
 * provider interface but refuses to execute — it holds NO real credentials,
 * makes NO network call, and returns NO fabricated data.
 */
export class ProviderNotContractedError extends Error {
  constructor(
    public readonly vendorId: string,
    public readonly capability: string,
  ) {
    super(
      `provider "${vendorId}" cannot perform "${capability}": no executed agreement or ` +
        `compliance review is in place. This adapter is a disabled discovery skeleton.`,
    );
    this.name = "ProviderNotContractedError";
  }
}
