import { resolveRuntimeConfig } from "@aflo/shared";

/**
 * Production-readiness endpoint (production-conversion directive, Phase 2).
 *
 * Reports ONLY non-sensitive status — the runtime mode plus a boolean per
 * integration (database / auth / storage / email / worker / observability
 * configured) and the selected provider modes. It never exposes a secret value.
 * `status` is "ok" unless the runtime contract found a fail-closed violation —
 * production misconfiguration (ADR-0017) or an unresolved/contradictory
 * runtime axis outside the explicit demo opt-in (ADR-0048).
 *
 * This route only REPORTS; it does not fail closed. Boot-time enforcement
 * lives in `instrumentation.ts` (`assertRuntimeReady`), which refuses to start
 * a misconfigured deployment — so in practice this route only ever renders
 * "degraded" in contexts that bypassed boot (none today).
 */
export const dynamic = "force-dynamic";

export function GET() {
  const { mode, ok, readiness } = resolveRuntimeConfig(process.env);
  return Response.json(
    { status: ok ? "ok" : "degraded", mode, ok, readiness },
    { status: ok ? 200 : 503, headers: { "cache-control": "no-store" } },
  );
}
