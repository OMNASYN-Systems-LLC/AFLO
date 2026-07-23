/**
 * Next.js instrumentation — runs once per server instance at startup, before
 * the app serves any request. (It does NOT run during `next build`; nothing
 * demo-gated executes at build time either — every page reading `lib/data.ts`
 * is `force-dynamic`.)
 *
 * This is the fail-closed boot gate (production-conversion Phase 2, ADR-0017,
 * flipped to explicit demo opt-in by ADR-0048): it asserts the runtime
 * configuration and REFUSES TO START when anything is misconfigured —
 *
 *   - production (`APP_ENV=production`) with a demo/mock fallback selected, a
 *     required secret missing, or a preview database (ADR-0017);
 *   - development/preview with an UNRESOLVED runtime axis — no explicit
 *     `APP_ENV=demo` opt-in and no explicit `AUTH_MODE=clerk` +
 *     `REPOSITORY_MODE=postgres` selection. This is the PR #97 LOW-5 fix: a
 *     deployment that intended production but forgot `APP_ENV=production`
 *     and/or one of the mode variables used to land silently on the
 *     demo/synthetic runtime; now it refuses to serve (ADR-0048);
 *   - demo (`APP_ENV=demo`) with a contradictory real selection;
 *   - TEST MODE in a served process (PR #99 review M2): `next start` only
 *     DEFAULTS `NODE_ENV` when it is unset — a pre-set `NODE_ENV=test` (or
 *     `APP_ENV=test`) survives into the server and would silently permit the
 *     demo/synthetic runtime. Test mode is for vitest, which never runs this
 *     `register()`; a process that answers requests must never be in it.
 *
 * The demo prototype therefore REQUIRES the explicit `APP_ENV=demo` opt-in:
 * local `pnpm dev` gets it from the committed `apps/web/.env.development`,
 * Playwright sets it in its webServer env, and the Vercel prototype
 * deployments must set it in the dashboard (see docs/deployment/DEPLOYMENT.md
 * §2). Vitest (which never boots a server) is the only context that runs with
 * nothing configured.
 */
export async function register(): Promise<void> {
  // Only the Node.js server runtime evaluates the contract (not the edge runtime).
  // NOTE: the whole request surface is node today (no edge routes, no middleware).
  // If an edge route or `middleware.ts` is ever added, it runs its own `register()`
  // with NEXT_RUNTIME="edge" and would bypass this gate — such a route must not
  // touch demo/mock providers, or the gate must be extended to the edge runtime.
  if (process.env.NEXT_RUNTIME !== "nodejs") return;

  const { assertRuntimeReady, resolveRuntimeMode, RuntimeConfigError } = await import("@aflo/shared");

  // M2: a SERVED process must never run in test mode — test mode's demo
  // permission exists for vitest only, and vitest never executes register().
  if (resolveRuntimeMode(process.env) === "test") {
    const err = new RuntimeConfigError("test", [
      "A served process must never run in test mode — NODE_ENV=test/APP_ENV=test would permit the demo/synthetic runtime without the explicit APP_ENV=demo opt-in (ADR-0048). Unset it, or select APP_ENV=demo or the real runtime explicitly.",
    ]);
    console.error(`[aflo] FATAL: refusing to start — ${err.message}`);
    throw err;
  }

  try {
    const { mode } = assertRuntimeReady(process.env);
    console.log(`[aflo] runtime configuration OK — mode=${mode}`);
  } catch (err) {
    if (err instanceof RuntimeConfigError) {
      // Fail closed: log the aggregated problems (env-var names only, no values)
      // and rethrow so the misconfigured deployment refuses to serve.
      console.error(`[aflo] FATAL: refusing to start — ${err.message}`);
    }
    throw err;
  }
}
