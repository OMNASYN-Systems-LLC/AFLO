/**
 * ΛFLO display wordmark.
 *
 * The official display brand is "ΛFLO" (Greek capital lambda + FLO). It is a
 * *visual* identity only: the accessible name stays "AFLO" so screen readers,
 * search, and copy-paste get the plain-text brand (founder brand rules —
 * AFLO is the accessibility fallback). Technical identifiers (@aflo/*,
 * env vars, URLs, logs) never use the lambda.
 */
export function AfloWordmark({ className }: { className?: string }) {
  return (
    <span className={className} aria-label="AFLO">
      <span aria-hidden="true">ΛFLO</span>
    </span>
  );
}

/** "Powered by ΛFLO" lockup with an AFLO accessible fallback. */
export function PoweredByAflo({ className }: { className?: string }) {
  return (
    <span className={className}>
      Powered by <AfloWordmark />
    </span>
  );
}
