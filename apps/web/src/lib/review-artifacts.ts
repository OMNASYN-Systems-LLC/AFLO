import { createHash } from "node:crypto";
import type { ReviewItem } from "@aflo/shared";

/**
 * Demo artifact source for the Human Review Center (server-only — node:crypto).
 *
 * A ReviewItem references its artifact by id + version + sha256 digest, never
 * the body (ADR-0043). Publication must state the artifact's CURRENT version
 * and digest so the store can enforce the founder's stale-artifact invariant
 * (decision 4: artifact changes → prior approval cannot publish the changed
 * content → new review required). In the credential-free demo runtime the
 * artifact registry is synthetic: the canonical digest of an artifact at a
 * version is the sha256 of `AFLO-SYNTHETIC-ARTIFACT::<artifactId>::v<version>`
 * — exactly the scheme the @aflo/shared seed data uses (test-asserted there),
 * so recomputing here reproduces the seeded digests bit-for-bit.
 *
 * This module is the ONLY place the demo answers "what is the artifact's
 * current version?" — the UI never invents versions or digests inline.
 */

/**
 * The demo's revised-artifact scenario (founder decision 4 made visible):
 * artifacts listed here were revised AFTER their review item was created, so
 * the artifact's CURRENT version is ahead of the reviewed one and any prior
 * approval is stale — publication is denied by the store until a fresh review
 * of the new version exists (supersession path).
 *
 * `qr-solomon-q2`: Renee Solomon's Q2 report artifact moved to v3 after its
 * v2 review was approved with edits — the seeded `rvi-solomon-report` item is
 * therefore stale-on-publish, demonstrating the denial end to end.
 */
const DEMO_REVISED_ARTIFACT_VERSIONS: Readonly<Record<string, string>> = {
  "qr-solomon-q2": "3",
};

/** sha256 hex of the canonical synthetic artifact string (the seed scheme). */
export function canonicalSyntheticArtifactDigest(artifactId: string, version: string): string {
  return createHash("sha256")
    .update(`AFLO-SYNTHETIC-ARTIFACT::${artifactId}::v${version}`)
    .digest("hex");
}

export interface CurrentArtifactState {
  version: string;
  digest: string;
  /** True when the artifact moved on since the review captured version+digest. */
  changedSinceReview: boolean;
}

/** The artifact's CURRENT version + digest, per the demo artifact registry. */
export function currentArtifactStateFor(
  item: Pick<ReviewItem, "artifactId" | "artifactVersion" | "artifactDigest">,
): CurrentArtifactState {
  const version = DEMO_REVISED_ARTIFACT_VERSIONS[item.artifactId] ?? item.artifactVersion;
  const digest = canonicalSyntheticArtifactDigest(item.artifactId, version);
  return {
    version,
    digest,
    changedSinceReview: version !== item.artifactVersion || digest !== item.artifactDigest,
  };
}
