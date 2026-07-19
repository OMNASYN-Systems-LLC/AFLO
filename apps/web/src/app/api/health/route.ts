import { resolveRuntimeConfig } from "@aflo/shared";

/**
 * Production-readiness endpoint (production-conversion directive, Phase 2).
 *
 * Reports ONLY non-sensitive status — the runtime mode plus a boolean per
 * integration (database / auth / storage / email / worker / observability
 * configured) and the selected provider modes. It never exposes a secret value.
 * `status` is "ok" unless the runtime contract found a fail-closed violation
 * (only possible in production).
 *
 * This route only REPORTS; it does not fail closed. Boot-time enforcement
 * (calling `assertRuntimeReady` so a misconfigured production deployment refuses
 * to serve) is the sequenced follow-up — safe to add because production mode is
 * an explicit `APP_ENV=production` opt-in.
 */
export const dynamic = "force-dynamic";

export function GET() {
  const { mode, ok, readiness } = resolveRuntimeConfig(process.env);
  return Response.json(
    { status: ok ? "ok" : "degraded", mode, ok, readiness },
    { status: ok ? 200 : 503, headers: { "cache-control": "no-store" } },
  );
}
