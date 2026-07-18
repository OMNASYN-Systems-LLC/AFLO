import { canonicalize, type JsonValue } from "./canonical";
import { SECURITY_RULES_VERSION, SIGNING_ALGORITHM, sha256Hex, sign, verify } from "./signing";

/**
 * Cryptographically verifiable handoff packages (security.v1.0.0).
 *
 * A handoff package binds a canonical payload of VERIFIED facts to an
 * asymmetric signature, with a recipient scope, a consent scope, an
 * expiration, and a revocation hook. Verification checks the digest, the
 * signature, expiration, and revocation.
 *
 * Deliberately NOT called "audit-proof", "legally verified", "underwriting
 * approved", or "zero-knowledge" — none of those have been independently
 * reviewed (charter). It is a tamper-evident, signed data package.
 */

export const HANDOFF_SCHEMA_VERSION = "handoff.v1";

/**
 * The verified-facts payload carried by a handoff package. A `type` (not an
 * interface) so it structurally satisfies `JsonValue` for canonicalization.
 *
 * `afloReadinessStage` is the ΛFLO deterministic lifecycle stage — explicitly
 * NOT a credit-bureau score (`readinessIsBureauScore` is always false). No raw
 * SSN, bank-account, or credit-report data ever appears here.
 */
export type HandoffFacts = {
  subjectName: string;
  issuingOrganization: string;
  afloReadinessStage: string;
  afloReadinessStageLabel: string;
  readinessIsBureauScore: false;
  readinessRuleVersion: string;
  readinessAssessedAt: string;
  primaryGoal: { title: string; category: string } | null;
  verifiedDocumentCount: number;
  latestPublishedReportQuarter: string | null;
};

export interface HandoffPackage {
  id: string;
  schemaVersion: string;
  organizationId: string;
  clientId: string;
  /** Who may consume this package (e.g. a partner CPA org id or role). */
  recipientScope: string;
  /** The consent record id authorizing this share. */
  consentScope: string;
  /** Canonical payload of verified facts (the signed content). */
  payload: JsonValue;
  /** SHA-256 of the canonical payload (integrity check; not the signature). */
  payloadDigest: string;
  /** Base64 Ed25519 signature over the canonical payload. */
  signature: string;
  keyId: string;
  algorithm: string;
  issuedAt: string; // ISO datetime
  expiresAt: string; // ISO datetime
  revokedAt: string | null;
  ruleVersion: string;
}

export interface AssembleHandoffInput {
  id: string;
  organizationId: string;
  clientId: string;
  recipientScope: string;
  consentScope: string;
  payload: JsonValue;
  issuedAt: string;
  expiresAt: string;
  keyId: string;
  privateKeyPem: string;
}

/** Build and sign a handoff package from a verified-facts payload. */
export function assembleHandoffPackage(input: AssembleHandoffInput): HandoffPackage {
  const canonical = canonicalize(input.payload);
  return {
    id: input.id,
    schemaVersion: HANDOFF_SCHEMA_VERSION,
    organizationId: input.organizationId,
    clientId: input.clientId,
    recipientScope: input.recipientScope,
    consentScope: input.consentScope,
    payload: input.payload,
    payloadDigest: sha256Hex(canonical),
    signature: sign(canonical, input.privateKeyPem),
    keyId: input.keyId,
    algorithm: SIGNING_ALGORITHM,
    issuedAt: input.issuedAt,
    expiresAt: input.expiresAt,
    revokedAt: null,
    ruleVersion: SECURITY_RULES_VERSION,
  };
}

export type HandoffVerdict =
  | "VALID"
  | "DIGEST_MISMATCH"
  | "SIGNATURE_INVALID"
  | "EXPIRED"
  | "REVOKED"
  | "UNKNOWN_KEY";

export interface HandoffVerification {
  ok: boolean;
  verdict: HandoffVerdict;
}

/**
 * Verify a handoff package against a public-key resolver (keyId → PEM) and a
 * verification time. Fails closed: tamper, bad signature, expiry, revocation,
 * or an unknown key all yield ok:false with a specific verdict.
 */
export function verifyHandoffPackage(
  pkg: HandoffPackage,
  resolvePublicKey: (keyId: string) => string | null,
  now: Date,
): HandoffVerification {
  if (pkg.revokedAt !== null) return { ok: false, verdict: "REVOKED" };

  const canonical = canonicalize(pkg.payload);
  if (sha256Hex(canonical) !== pkg.payloadDigest) return { ok: false, verdict: "DIGEST_MISMATCH" };

  const publicKeyPem = resolvePublicKey(pkg.keyId);
  if (!publicKeyPem) return { ok: false, verdict: "UNKNOWN_KEY" };
  if (!verify(canonical, pkg.signature, publicKeyPem)) return { ok: false, verdict: "SIGNATURE_INVALID" };

  // Expiry checked after integrity so tampering is reported over staleness.
  if (Date.parse(pkg.expiresAt) <= now.getTime()) return { ok: false, verdict: "EXPIRED" };

  return { ok: true, verdict: "VALID" };
}

/**
 * Client acknowledgment of a handoff package. Records identity, package
 * binding, and the payload digest acknowledged — never a raw auth token.
 */
export interface ClientAcknowledgment {
  userId: string;
  organizationId: string;
  packageId: string;
  packageSchemaVersion: string;
  payloadDigest: string;
  acknowledgedAt: string;
  sessionId: string;
  consentVersion: string;
  correlationId: string;
}

/**
 * Professional sign-off on a handoff package. Records the reviewer, the
 * package binding, the digest reviewed, and the signing key id — never a raw
 * authentication token or a browser fingerprint.
 */
export interface ProfessionalSignOff {
  reviewerId: string;
  reviewerRole: string;
  reviewerOrganizationId: string;
  packageId: string;
  packageSchemaVersion: string;
  payloadDigest: string;
  reviewStatus: "approved" | "changes_requested" | "rejected";
  reviewNotes: string | null;
  signatureKeyId: string;
  signedAt: string;
  correlationId: string;
}
